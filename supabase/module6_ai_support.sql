-- =========================================================
-- SafeHer — Module 6: AI Support Assistant, FAQ system, and
-- confidential expert handoff (Foundational phase)
--
-- Run in the Supabase SQL editor AFTER 00_schema.sql,
-- module1_auth.sql, module1b_grants_and_survivors_rls.sql,
-- module2_case_data_rls.sql, module3_barangay_hierarchy.sql,
-- module3b_service_role_grants.sql, module4_shelter_admin.sql,
-- and module5_sos_location_accuracy.sql.
--
-- IMPORTANT — two-part file, same reason as module3/module4:
-- Postgres will not let a newly-added enum value be referenced
-- by anything else in the same transaction/script that added it.
-- Run Part A alone first, then come back and run Part B.
--
-- WHAT ALREADY EXISTED, and what this file does with it (this is
-- explicitly an incremental module, not a rebuild):
--   - chat_sessions / chat_messages already exist (00_schema.sql)
--     and were already used by the mobile app's previous minimal
--     ChatbotScreen.tsx (now replaced by SafeHerAssistantScreen.tsx)
--     and supabase/functions/safeher-chatbot. BUT they have never had
--     RLS or grants added — module1b and
--     module2's own comments flag this explicitly ("NOT covered
--     here... needs its own pass when that feature is actively
--     exercised"). Today, any query against these tables from the
--     app gets 42501 permission denied. This file is that pass —
--     it EXTENDS these two tables (new columns) rather than
--     creating a parallel support_conversations/support_messages
--     pair, per the project's own "do not duplicate existing
--     structures" rule.
--   - The suggested `support_conversations`/`support_messages`
--     concept maps onto chat_sessions/chat_messages; the suggested
--     `expert_support_requests` concept has no existing analog and
--     is genuinely new, modeled closely on shelter_requests' own
--     status-lifecycle + assignment shape.
--
-- ROLE DECISION — a new `support_expert` role (Part A) is added
-- rather than reusing an existing admin role. Reasoning: municipal_
-- /provincial_admin are administrative/case-management roles;
-- confidential survivor<->expert chat is a distinct real-world
-- persona (case worker / social worker) that should NOT inherit
-- case management, user management, or shelter management access
-- just to do support chat — that would violate the brief's
-- explicit "do not grant every administrator access to confidential
-- expert conversations" / least-privilege requirement. Mirrors the
-- existing shelter_admin precedent exactly: a standalone role, not
-- layered onto the province/municipality/barangay ladder, so it is
-- deliberately EXCLUDED from is_admin() below (redefined, not
-- extended) and from RoleTier in AuthContext.tsx.
--
-- RLS RECURSION SAFETY — every new policy below is single-hop:
-- either a direct column comparison on the row being evaluated, or
-- a helper function that touches ONLY user_profiles (current_
-- profile_id/is_provincial_admin/is_support_expert — none of which
-- ever query chat_sessions/chat_messages/expert_support_requests),
-- or (for chat_messages only) a helper that touches ONLY
-- chat_sessions, never chat_messages itself. No helper in this
-- file ever queries back into the table whose policy is calling it.
-- See the "VERIFICATION" block at the end for the recursion tests.
--
-- PRIVILEGE MODEL — chat_sessions.status / .assigned_expert_id /
-- .mode and expert_support_requests.status / .assigned_expert_id /
-- .assigned_at / .accepted_at / .closed_at are the "who owns/can
-- see this confidential conversation" fields. A single shared
-- Postgres `authenticated` role can't be trusted to self-limit
-- which of these it writes via GRANT alone (the project has hit
-- this exact trap before — see validate_shelter_update()), so:
--   - chat_sessions gets NO client-facing UPDATE grant at all.
--     Every status/assignment change is written by ONE SECURITY
--     DEFINER trigger (sync_chat_session_from_request, below),
--     fired off expert_support_requests transitions — mirrors
--     case_referrals' "ownership-apply trigger" pattern exactly.
--   - expert_support_requests DOES get a client-facing UPDATE
--     grant (assigned_expert_id/status/assigned_at/accepted_at/
--     closed_at), because two different real actors legitimately
--     need to write it directly (an authorized admin assigning, the
--     assigned expert accepting/closing) — validate_expert_
--     support_request_update() (a trigger, not RLS) is what
--     differentiates which of THOSE fields either actor may set,
--     the same column-differentiation-via-trigger technique already
--     used by validate_shelter_update()/validate_shelter_request_
--     update().
--
-- Everything below is idempotent (create or replace, drop ... if
-- exists + create, add column if not exists) and safe to re-run.
-- =========================================================


-- =========================================================
-- PART A — run this alone first, then come back and run Part B.
-- =========================================================

alter type user_role add value if not exists 'support_expert';
alter type sender_type add value if not exists 'Expert';
alter type sender_type add value if not exists 'System';
alter type notification_type add value if not exists 'Support';


-- =========================================================
-- PART B — run everything below AFTER Part A has completed.
-- =========================================================

-- ---------------------------------------------------------
-- 1. New enums.
-- ---------------------------------------------------------

-- Shared by chat_sessions.status AND expert_support_requests.status
-- (kept as ONE enum deliberately — a request's lifecycle and its
-- linked conversation's lifecycle are the same lifecycle viewed
-- from two tables, not two independent ones; sync_chat_session_
-- from_request is what keeps them identical).
do $$ begin
  create type chat_session_status as enum (
    'AI_ASSISTED', 'WAITING_FOR_EXPERT', 'EXPERT_ASSIGNED', 'EXPERT_ACTIVE', 'CLOSED'
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type chat_mode as enum ('AI', 'HUMAN');
exception when duplicate_object then null; end $$;

do $$ begin
  create type support_priority as enum ('NORMAL', 'HIGH', 'URGENT');
exception when duplicate_object then null; end $$;

-- Rule-based / AI-assisted safety classification. Deliberately NOT
-- named after "SOS" or "emergency" — this is a conservative message-
-- level read used to decide whether to show the safety panel, never
-- an official emergency determination (that's still only ever the
-- existing sos_alerts flow, triggered by the user's own action).
do $$ begin
  create type message_risk_level as enum ('NORMAL', 'SUPPORT', 'URGENT', 'EMERGENCY');
exception when duplicate_object then null; end $$;


-- ---------------------------------------------------------
-- 2. chat_sessions — extend in place.
--    (ended_at already exists — reused as "closed_at", no new
--    column needed for that.)
-- ---------------------------------------------------------
alter table public.chat_sessions add column if not exists status chat_session_status not null default 'AI_ASSISTED';
alter table public.chat_sessions add column if not exists mode chat_mode not null default 'AI';
alter table public.chat_sessions add column if not exists assigned_expert_id uuid references public.user_profiles(profile_id);

create index if not exists idx_chat_sessions_assigned_expert on public.chat_sessions(assigned_expert_id) where assigned_expert_id is not null;

-- ---------------------------------------------------------
-- 3. chat_messages — extend in place.
-- ---------------------------------------------------------
alter table public.chat_messages add column if not exists sender_profile_id uuid references public.user_profiles(profile_id);
alter table public.chat_messages add column if not exists message_metadata jsonb;
-- Only ever populated for messages the safety evaluator actually ran
-- against (the survivor's own messages) — null for AI/Expert/System
-- replies. Lets an admin/expert see WHY something was flagged without
-- re-deriving it, without treating it as an official determination.
alter table public.chat_messages add column if not exists risk_level message_risk_level;

-- ---------------------------------------------------------
-- 4. New table: expert_support_requests.
--    "User Requested Support" is a valid, sufficient reason —
--    reason is optional free text, never required.
-- ---------------------------------------------------------
create table if not exists public.expert_support_requests (
  request_id         uuid primary key default gen_random_uuid(),
  conversation_id    uuid not null references public.chat_sessions(session_id) on delete cascade,
  profile_id         uuid not null references public.user_profiles(profile_id),
  reason             text,
  priority           support_priority not null default 'NORMAL',
  status             chat_session_status not null default 'WAITING_FOR_EXPERT',
  assigned_expert_id uuid references public.user_profiles(profile_id),
  requested_at       timestamptz not null default now(),
  assigned_at        timestamptz,
  accepted_at        timestamptz,
  closed_at          timestamptz
);

create index if not exists idx_expert_requests_profile on public.expert_support_requests(profile_id);
create index if not exists idx_expert_requests_assigned on public.expert_support_requests(assigned_expert_id) where assigned_expert_id is not null;
create index if not exists idx_expert_requests_status on public.expert_support_requests(status) where status in ('WAITING_FOR_EXPERT', 'EXPERT_ASSIGNED', 'EXPERT_ACTIVE');

-- Database-level backstop (not just the mobile client's own check)
-- against two rapid "Talk to an Expert" taps racing each other into two
-- rows for the same conversation before the first one's trigger has
-- updated chat_sessions.status.
create unique index if not exists idx_expert_requests_one_active_per_conversation
  on public.expert_support_requests(conversation_id) where status != 'CLOSED';

-- ---------------------------------------------------------
-- 5. New table: faqs. Verified, admin-authored content — the AI
--    must never be treated as able to edit or invent this.
-- ---------------------------------------------------------
create table if not exists public.faqs (
  faq_id      uuid primary key default gen_random_uuid(),
  category    varchar(60) not null,
  question    text not null,
  answer      text not null,
  keywords    text[] not null default '{}',
  is_active   boolean not null default true,
  created_by  uuid references public.user_profiles(profile_id),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists idx_faqs_category on public.faqs(category) where is_active = true;

create or replace function public.set_faq_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_faqs_updated_at on public.faqs;
create trigger trg_faqs_updated_at before update on public.faqs
  for each row execute procedure public.set_faq_updated_at();


-- ---------------------------------------------------------
-- 6. Helper functions. Every one below is single-hop: it only
--    ever reads user_profiles (never chat_sessions/chat_messages/
--    expert_support_requests), except can_access_chat_session()
--    which only ever reads chat_sessions (never chat_messages).
-- ---------------------------------------------------------

-- Deliberately NOT folded into is_admin() — see the file header's
-- "ROLE DECISION" note. A support_expert is not a general admin.
create or replace function public.is_support_expert()
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.user_profiles where auth_user_id = auth.uid() and role = 'support_expert'
  );
$$;

-- Redefined (idempotent) to keep the existing admin roles exactly
-- as they were — support_expert is intentionally absent, so nothing
-- gated on is_admin() anywhere else in the schema (shelters, cases,
-- notifications, etc.) becomes reachable by a support_expert as a
-- side effect of this file.
create or replace function public.is_admin()
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.user_profiles
    where auth_user_id = auth.uid()
      and role in ('municipal_admin', 'provincial_admin', 'super_admin', 'barangay_admin', 'shelter_admin')
  );
$$;

-- Used by chat_messages' policies. Touches ONLY chat_sessions —
-- chat_sessions' own policies never touch chat_messages, so calling
-- this from chat_messages' policy cannot cycle back.
create or replace function public.can_access_chat_session(p_session_id uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.chat_sessions cs
    where cs.session_id = p_session_id
      and (
        cs.profile_id = public.current_profile_id()
        or cs.assigned_expert_id = public.current_profile_id()
        or public.is_provincial_admin()
      )
  );
$$;


-- ---------------------------------------------------------
-- 7. Triggers — integrity validation + the one and only writer
--    of chat_sessions.status/mode/assigned_expert_id.
-- ---------------------------------------------------------

-- assigned_expert_id, wherever it's set (expert_support_requests),
-- must actually belong to a support_expert profile.
create or replace function public.validate_expert_assignment()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  if new.assigned_expert_id is not null then
    if not exists (select 1 from public.user_profiles where profile_id = new.assigned_expert_id and role = 'support_expert') then
      raise exception 'assigned_expert_id must reference a support_expert profile';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_validate_expert_assignment on public.expert_support_requests;
create trigger trg_validate_expert_assignment
  before insert or update of assigned_expert_id on public.expert_support_requests
  for each row execute procedure public.validate_expert_assignment();

-- Column-differentiation for expert_support_requests' shared UPDATE
-- grant (see file header) — same technique as validate_shelter_
-- update(). Also rejects invalid status transitions outright, so a
-- malformed client request fails loudly instead of silently
-- corrupting the lifecycle.
create or replace function public.validate_expert_support_request_update()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  if new.status is distinct from old.status then
    if not (
      (old.status = 'WAITING_FOR_EXPERT' and new.status = 'EXPERT_ASSIGNED')
      or (old.status = 'EXPERT_ASSIGNED' and new.status in ('EXPERT_ACTIVE', 'CLOSED'))
      or (old.status = 'EXPERT_ACTIVE' and new.status = 'CLOSED')
    ) then
      raise exception 'Invalid expert support request status transition: % -> %', old.status, new.status;
    end if;
  end if;

  if new.status in ('EXPERT_ASSIGNED', 'EXPERT_ACTIVE') and new.assigned_expert_id is null then
    raise exception 'An expert must be assigned before status can be %', new.status;
  end if;

  if public.is_provincial_admin() then
    -- Assignment step only: an authorized admin may set assigned_expert_id
    -- and status -> EXPERT_ASSIGNED (including re-assigning before the
    -- expert has accepted). Nothing else.
    if new.status is distinct from old.status and new.status != 'EXPERT_ASSIGNED' then
      raise exception 'Administrators may only move a request to EXPERT_ASSIGNED';
    end if;
    if new.assigned_expert_id is distinct from old.assigned_expert_id and new.status != 'EXPERT_ASSIGNED' then
      raise exception 'Administrators may only change assigned_expert_id while assigning (status EXPERT_ASSIGNED)';
    end if;
  elsif old.assigned_expert_id = public.current_profile_id() then
    -- Acceptance/closure step only: the assigned expert may move
    -- EXPERT_ASSIGNED -> EXPERT_ACTIVE -> CLOSED, but never reassign
    -- the request to someone else.
    if new.assigned_expert_id is distinct from old.assigned_expert_id then
      raise exception 'An assigned expert cannot reassign a request';
    end if;
  else
    raise exception 'Not authorized to update this expert support request';
  end if;

  -- assigned_at/accepted_at/closed_at are always server-derived, never
  -- trusted from the client (the UPDATE grant lists them only so a
  -- client CAN reference the columns; their actual value is fully
  -- overridden here regardless of what was sent).
  new.assigned_at := old.assigned_at;
  new.accepted_at := old.accepted_at;
  new.closed_at := old.closed_at;
  if new.status = 'EXPERT_ASSIGNED' and old.status is distinct from new.status then
    new.assigned_at := now();
  end if;
  if new.status = 'EXPERT_ACTIVE' and old.status is distinct from new.status then
    new.accepted_at := now();
  end if;
  if new.status = 'CLOSED' and old.status is distinct from new.status then
    new.closed_at := now();
  end if;

  return new;
end;
$$;

drop trigger if exists trg_validate_expert_support_request_update on public.expert_support_requests;
create trigger trg_validate_expert_support_request_update
  before update on public.expert_support_requests
  for each row execute procedure public.validate_expert_support_request_update();

-- The one and only writer of chat_sessions.status/mode/
-- assigned_expert_id (see file header's PRIVILEGE MODEL note), the
-- survivor-facing notification, AND the visible handoff transition
-- message inserted straight into the chat thread itself (sender_type
-- 'System' — same "only this trigger can write it" guarantee as the
-- AI/System messages the Edge Function inserts, since SECURITY DEFINER
-- bypasses chat_messages' RLS the same way it bypasses chat_sessions').
-- SECURITY DEFINER so it can write columns/rows the calling client (an
-- admin or the assigned expert) has no direct grant on.
create or replace function public.sync_chat_session_from_request()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  v_notif_title text;
  v_notif_message text;
  v_transition_message text;
begin
  update public.chat_sessions
  set
    status = new.status,
    assigned_expert_id = new.assigned_expert_id,
    mode = case when new.status in ('EXPERT_ASSIGNED', 'EXPERT_ACTIVE') then 'HUMAN'::chat_mode else 'AI'::chat_mode end,
    ended_at = case when new.status = 'CLOSED' then now() else ended_at end,
    is_active = case when new.status = 'CLOSED' then false else is_active end
  where session_id = new.conversation_id;

  if new.status = 'EXPERT_ASSIGNED' and old.status is distinct from new.status then
    v_notif_title := 'A SafeHer support representative has been assigned';
    v_notif_message := 'An authorized SafeHer support expert has been assigned to your request and will join your conversation shortly.';
    v_transition_message := 'A SafeHer support representative has been assigned to your conversation and will join shortly.';
  elsif new.status = 'EXPERT_ACTIVE' and old.status is distinct from new.status then
    v_notif_title := 'You are now connected with a SafeHer support representative';
    v_notif_message := 'Your assigned SafeHer support expert has joined the conversation.';
    v_transition_message := 'You are now connected with a SafeHer support representative.';
  elsif new.status = 'CLOSED' and old.status is distinct from new.status then
    v_transition_message := 'This support conversation has been closed.';
  end if;

  if v_notif_title is not null then
    insert into public.notifications (profile_id, notification_type, title, message, is_read)
    values (new.profile_id, 'Support', v_notif_title, v_notif_message, false);
  end if;

  if v_transition_message is not null then
    insert into public.chat_messages (session_id, sender_type, sender_profile_id, message)
    values (new.conversation_id, 'System', null, v_transition_message);
  end if;

  return new;
end;
$$;

drop trigger if exists trg_sync_chat_session_from_request on public.expert_support_requests;
create trigger trg_sync_chat_session_from_request
  after update of status, assigned_expert_id on public.expert_support_requests
  for each row execute procedure public.sync_chat_session_from_request();

-- New-expert-message notification — the other survivor-facing
-- notification case (WHO/WHAT/WHEN only; never duplicates message
-- content beyond what a normal notification title already needs).
create or replace function public.notify_on_expert_message()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  v_profile_id uuid;
begin
  if new.sender_type = 'Expert' then
    select profile_id into v_profile_id from public.chat_sessions where session_id = new.session_id;
    if v_profile_id is not null then
      insert into public.notifications (profile_id, notification_type, title, message, is_read)
      values (v_profile_id, 'Support', 'New message from your SafeHer support representative', 'You have a new message in your support conversation.', false);
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_notify_on_expert_message on public.chat_messages;
create trigger trg_notify_on_expert_message
  after insert on public.chat_messages
  for each row execute procedure public.notify_on_expert_message();

-- WHO/WHAT/WHEN audit coverage for the two tables where authorization
-- and conversation ownership actually change. Deliberately NOT
-- attached to chat_messages — that would duplicate confidential
-- message content into audit_logs.new_values, which the brief
-- explicitly says to avoid.
drop trigger if exists trg_audit_expert_support_requests on public.expert_support_requests;
create trigger trg_audit_expert_support_requests after insert or update or delete on public.expert_support_requests
  for each row execute procedure public.audit_row_change('request_id');

drop trigger if exists trg_audit_chat_sessions on public.chat_sessions;
create trigger trg_audit_chat_sessions after update of status, assigned_expert_id, mode on public.chat_sessions
  for each row execute procedure public.audit_row_change('session_id');

drop trigger if exists trg_audit_faqs on public.faqs;
create trigger trg_audit_faqs after insert or update or delete on public.faqs
  for each row execute procedure public.audit_row_change('faq_id');


-- ---------------------------------------------------------
-- 8. RLS.
-- ---------------------------------------------------------

alter table public.chat_sessions enable row level security;
alter table public.chat_messages enable row level security;
alter table public.expert_support_requests enable row level security;
alter table public.faqs enable row level security;

-- chat_sessions — direct column checks + is_provincial_admin()
-- (user_profiles only). No recursion: nothing here queries
-- chat_sessions from within a helper, or queries chat_messages at all.
drop policy if exists "Participants can view own chat sessions" on public.chat_sessions;
create policy "Participants can view own chat sessions"
  on public.chat_sessions for select
  using (
    profile_id = public.current_profile_id()
    or assigned_expert_id = public.current_profile_id()
    or public.is_provincial_admin()
  );

drop policy if exists "Survivors can start chat sessions" on public.chat_sessions;
create policy "Survivors can start chat sessions"
  on public.chat_sessions for insert
  with check (profile_id = public.current_profile_id());

-- No client-facing UPDATE policy — see file header. status/mode/
-- assigned_expert_id are written only by sync_chat_session_from_
-- request(), which is SECURITY DEFINER and bypasses this entirely.

-- chat_messages — SELECT authorization is inherited from
-- chat_sessions via the single-hop helper (never queries
-- chat_messages itself, so chat_sessions' own policy calling this
-- back is impossible — chat_sessions' policy above never touches
-- chat_messages at all).
drop policy if exists "Participants can view chat messages" on public.chat_messages;
create policy "Participants can view chat messages"
  on public.chat_messages for select
  using (public.can_access_chat_session(session_id));

-- INSERT: a survivor may post as 'User' into their own session; an
-- assigned expert may post as 'Expert' into a session they're
-- currently assigned AND only while it's EXPERT_ACTIVE (never into a
-- session still waiting on assignment, and never after it's closed).
-- 'AI' and 'System' are deliberately absent here — no authenticated
-- client, survivor or expert, can insert those; only the Edge
-- Function's service-role client can (see safeher-chatbot), which is
-- exactly what makes "AI cannot be spoofed as an expert, and a
-- survivor cannot spoof the AI" a database-level guarantee, not just
-- an app-level convention.
drop policy if exists "Participants can send chat messages" on public.chat_messages;
create policy "Participants can send chat messages"
  on public.chat_messages for insert
  with check (
    (
      sender_type = 'User'
      and sender_profile_id = public.current_profile_id()
      and exists (select 1 from public.chat_sessions cs where cs.session_id = chat_messages.session_id and cs.profile_id = public.current_profile_id())
    )
    or
    (
      sender_type = 'Expert'
      and sender_profile_id = public.current_profile_id()
      and exists (
        select 1 from public.chat_sessions cs
        where cs.session_id = chat_messages.session_id
          and cs.assigned_expert_id = public.current_profile_id()
          and cs.status = 'EXPERT_ACTIVE'
      )
    )
  );

-- No update/delete policy — messages are immutable, same convention
-- as case_status_history/case_referrals.

-- expert_support_requests — direct column checks + is_provincial_
-- admin(), same single-hop safety as chat_sessions above.
drop policy if exists "Participants can view expert support requests" on public.expert_support_requests;
create policy "Participants can view expert support requests"
  on public.expert_support_requests for select
  using (
    profile_id = public.current_profile_id()
    or assigned_expert_id = public.current_profile_id()
    or public.is_provincial_admin()
  );

drop policy if exists "Survivors can request expert support" on public.expert_support_requests;
create policy "Survivors can request expert support"
  on public.expert_support_requests for insert
  with check (
    profile_id = public.current_profile_id()
    and exists (select 1 from public.chat_sessions cs where cs.session_id = conversation_id and cs.profile_id = public.current_profile_id())
  );

drop policy if exists "Admins and assigned experts can update requests" on public.expert_support_requests;
create policy "Admins and assigned experts can update requests"
  on public.expert_support_requests for update
  using (public.is_provincial_admin() or assigned_expert_id = public.current_profile_id())
  with check (public.is_provincial_admin() or assigned_expert_id = public.current_profile_id());

-- faqs — verified content. Every authenticated user reads active
-- FAQs; only provincial-tier admins manage them (least privilege —
-- see file header; this is deliberately narrower than is_admin()).
drop policy if exists "Authenticated users can view active faqs" on public.faqs;
create policy "Authenticated users can view active faqs"
  on public.faqs for select
  using (is_active = true or public.is_provincial_admin());

drop policy if exists "Provincial admins can manage faqs" on public.faqs;
create policy "Provincial admins can manage faqs"
  on public.faqs for insert
  with check (public.is_provincial_admin());

drop policy if exists "Provincial admins can update faqs" on public.faqs;
create policy "Provincial admins can update faqs"
  on public.faqs for update
  using (public.is_provincial_admin())
  with check (public.is_provincial_admin());

drop policy if exists "Provincial admins can delete faqs" on public.faqs;
create policy "Provincial admins can delete faqs"
  on public.faqs for delete
  using (public.is_provincial_admin());


-- ---------------------------------------------------------
-- 9. Grants.
-- ---------------------------------------------------------

grant select, insert on public.chat_sessions to authenticated;
-- No update grant on chat_sessions at all — see PRIVILEGE MODEL.

grant select on public.chat_messages to authenticated;
grant insert (session_id, sender_type, sender_profile_id, message, message_metadata, risk_level) on public.chat_messages to authenticated;

grant select on public.expert_support_requests to authenticated;
grant insert (conversation_id, profile_id, reason, priority) on public.expert_support_requests to authenticated;
grant update (assigned_expert_id, status, assigned_at, accepted_at, closed_at) on public.expert_support_requests to authenticated;

grant select on public.faqs to authenticated;
grant insert (category, question, answer, keywords, is_active, created_by) on public.faqs to authenticated;
grant update (category, question, answer, keywords, is_active) on public.faqs to authenticated;
grant delete on public.faqs to authenticated;


-- =========================================================
-- VERIFICATION — run these separately, after everything above,
-- to confirm the migration applied correctly. All read-only unless
-- noted.
-- =========================================================

-- 1. Confirm the new enum values exist:
--   select enumlabel from pg_enum where enumtypid = 'user_role'::regtype order by enumsortorder;
--   select enumlabel from pg_enum where enumtypid = 'sender_type'::regtype order by enumsortorder;
--   select enumlabel from pg_enum where enumtypid = 'notification_type'::regtype order by enumsortorder;

-- 2. Confirm every new/redefined policy exists:
--   select tablename, policyname, cmd from pg_policies
--   where schemaname = 'public'
--     and tablename in ('chat_sessions', 'chat_messages', 'expert_support_requests', 'faqs')
--   order by tablename, cmd;

-- 3. Confirm RLS is actually enabled on all four (expect true for all):
--   select relname, relrowsecurity from pg_class
--   where relnamespace = 'public'::regnamespace
--     and relname in ('chat_sessions', 'chat_messages', 'expert_support_requests', 'faqs');

-- 4. Confirm chat_sessions has NO client-facing UPDATE grant at all
--    (expect ZERO rows):
--   select table_name, column_name from information_schema.role_column_grants
--   where grantee = 'authenticated' and privilege_type = 'UPDATE'
--     and table_schema = 'public' and table_name = 'chat_sessions';

-- 5. Confirm 'AI'/'System' sender_type is NOT reachable via the
--    authenticated INSERT grant path — this is enforced by the RLS
--    with-check above, not the grant (the grant is table/column
--    scoped, not value-scoped) — re-read policy "Participants can
--    send chat messages" above and confirm it only ever matches
--    sender_type IN ('User','Expert').

-- 6. RLS RECURSION TEST — the specific failure mode this project has
--    hit before (42P17). Run as an authenticated survivor via the
--    client (anon key + that user's access token), not the SQL
--    editor:
--   select * from chat_sessions;
--   select * from chat_messages where session_id = '<own session>';
--   select * from expert_support_requests;
--   Expect real rows (or empty sets) — NOT "infinite recursion
--   detected in policy" and NOT an unexpected HTTP 500.

-- 7. Cross-survivor isolation test — as survivor A, attempt:
--   select * from chat_sessions where session_id = '<survivor B's session>';
--   Expect zero rows (RLS silently filters), not an error, and not
--   survivor B's data.

-- 8. Expert-scoping test — as a support_expert with no assignments:
--   select * from expert_support_requests;
--   Expect zero rows. Then, as an admin, assign one request to them
--   and repeat — expect exactly that one row.

-- 9. Self-assignment test — as a survivor, attempt:
--   update expert_support_requests set assigned_expert_id = '<own profile_id>', status = 'EXPERT_ASSIGNED' where request_id = '<own request>';
--   Expect a permission/RLS rejection (the UPDATE policy's using()
--   clause only matches is_provincial_admin() or the CURRENT
--   assigned_expert_id, never profile_id = current_profile_id()).

-- 10. Status-smuggling test — as the assigned expert on an
--     EXPERT_ASSIGNED request, attempt:
--   update expert_support_requests set status = 'CLOSED', assigned_expert_id = '<a different expert>' where request_id = '<own assignment>';
--   Expect trg_validate_expert_support_request_update to raise
--   "An assigned expert cannot reassign a request".

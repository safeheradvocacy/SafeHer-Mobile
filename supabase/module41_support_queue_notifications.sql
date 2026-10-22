-- =========================================================
-- SafeHer — Module 41: Support queue + support-expert
-- notifications (fix missing event -> notification wiring)
--
-- Run AFTER module40_survivors_address_grant_fix.sql (and therefore
-- after module6_ai_support.sql / module8_notifications_push.sql,
-- which this file extends in place).
--
-- CONTEXT — this is a bug-fix pass, not a new feature. Auditing the
-- existing expert-support workflow found that THREE of its real,
-- already-existing events never produced a notification row at all:
--   1. A survivor submits a new request (expert_support_requests
--      INSERT) -> no one in the Expert Support Queue was ever told.
--   2. A request is assigned/reassigned to a support_expert
--      (assigned_expert_id set/changed) -> sync_chat_session_from_
--      request() already notified the SURVIVOR ("an expert has been
--      assigned to you") but never notified the EXPERT themselves
--      that they'd received an assignment.
--   3. A survivor sends a chat_messages row (sender_type 'User') in
--      a conversation an expert is already assigned to -> only the
--      reverse direction (notify_on_expert_message(), Expert -> User)
--      existed.
-- All three are fixed by EXTENDING the existing trigger functions
-- (create or replace, same trigger definitions) — no parallel
-- notification system, no new trigger objects beyond one genuinely
-- new INSERT trigger for case 1 above (there was no existing AFTER
-- INSERT trigger on expert_support_requests to extend).
--
-- DATABASE CHANGE — notifications.request_id (nullable FK) is added
-- below, mirroring the exact existing precedent of notifications.
-- barangay_request_id (module31_barangay_action_requests.sql) and
-- notifications.case_id/sos_id (00_schema.sql): one nullable,
-- indexed FK column per notification-triggering table, used so the
-- client can deep-link a notification to its source record. This is
-- genuinely necessary — without it, a Support notification (the type
-- already used by both existing and new rows below) carries no
-- reference an admin page can navigate to at all, old rows included.
--
-- Idempotent (create or replace, add column/trigger if not exists)
-- and safe to re-run.
-- =========================================================

-- ---------------------------------------------------------
-- 1. notifications.request_id — same shape as barangay_request_id.
-- ---------------------------------------------------------
alter table public.notifications add column if not exists request_id uuid references public.expert_support_requests(request_id);
create index if not exists idx_notifications_request_id on public.notifications(request_id) where request_id is not null;

-- ---------------------------------------------------------
-- 2. New request submitted -> notify the Expert Support Queue's
--    managers (every active provincial_staff — the sole role holding
--    'support.manage' / the Expert Support Queue page, per
--    admin/src/lib/permissions.ts). Deliberately the SAME
--    survivor-name-free payload shape as notify_on_sos_created() —
--    no reason/priority text, just enough to route the recipient to
--    the existing queue page.
-- ---------------------------------------------------------
create or replace function public.notify_on_new_support_request()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  recipient record;
begin
  for recipient in
    select profile_id from public.user_profiles
    where is_active = true and role = 'provincial_staff'
  loop
    insert into public.notifications (profile_id, request_id, notification_type, title, message, is_read)
    values (recipient.profile_id, new.request_id, 'Support', 'New Support Request', 'A new request for human support is waiting for review.', false);
  end loop;
  return new;
end;
$$;

drop trigger if exists trg_notify_on_new_support_request on public.expert_support_requests;
create trigger trg_notify_on_new_support_request
  after insert on public.expert_support_requests
  for each row execute procedure public.notify_on_new_support_request();

-- ---------------------------------------------------------
-- 3. Assignment / reassignment -> notify the (newly) assigned
--    expert. Extends sync_chat_session_from_request() rather than a
--    second trigger, since it already fires on exactly the right
--    event (after update of status, assigned_expert_id) and already
--    owns every other notification this table's status changes
--    produce. Keyed on assigned_expert_id actually changing (not on
--    status reaching EXPERT_ASSIGNED) specifically because a
--    RE-assignment via the Queue page's "Reassign" action changes
--    assigned_expert_id while status stays EXPERT_ASSIGNED the whole
--    time (trg_validate_expert_support_request_update permits this
--    for is_provincial_admin() callers) — a status-only check would
--    silently miss every reassignment.
--
--    The PREVIOUS assignee is deliberately not notified of losing the
--    conversation — nothing in the existing workflow requires it, and
--    RLS already and automatically revokes their access the instant
--    assigned_expert_id changes (chat_sessions/chat_messages/
--    expert_support_requests all key authorization off the CURRENT
--    assigned_expert_id column this same trigger just wrote).
-- ---------------------------------------------------------
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
    insert into public.notifications (profile_id, request_id, notification_type, title, message, is_read)
    values (new.profile_id, new.request_id, 'Support', v_notif_title, v_notif_message, false);
  end if;

  if v_transition_message is not null then
    insert into public.chat_messages (session_id, sender_type, sender_profile_id, message)
    values (new.conversation_id, 'System', null, v_transition_message);
  end if;

  -- NEW — notify the expert side of an assignment/reassignment,
  -- independent of whether status itself changed this update.
  if new.assigned_expert_id is not null and new.assigned_expert_id is distinct from old.assigned_expert_id then
    insert into public.notifications (profile_id, request_id, notification_type, title, message, is_read)
    values (new.assigned_expert_id, new.request_id, 'Support', 'Conversation Assigned', 'A support conversation has been assigned to you.', false);
  end if;

  return new;
end;
$$;

-- Trigger definition itself is unchanged (same event/columns) — no
-- drop+recreate needed beyond the function body above, but re-stated
-- here for completeness/idempotency.
drop trigger if exists trg_sync_chat_session_from_request on public.expert_support_requests;
create trigger trg_sync_chat_session_from_request
  after update of status, assigned_expert_id on public.expert_support_requests
  for each row execute procedure public.sync_chat_session_from_request();

-- ---------------------------------------------------------
-- 4. Incoming survivor message -> notify the assigned expert (the
--    missing reverse direction of the existing Expert -> survivor
--    case already in this function). Only fires once a real expert is
--    assigned (EXPERT_ASSIGNED or EXPERT_ACTIVE) — a message sent
--    while still AI_ASSISTED/WAITING_FOR_EXPERT has no expert to
--    notify yet. request_id is resolved via the one-non-closed-
--    request-per-conversation invariant this table already enforces
--    (idx_expert_requests_one_active_per_conversation), so this is
--    always at most one row.
-- ---------------------------------------------------------
create or replace function public.notify_on_expert_message()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  v_profile_id uuid;
  v_assigned_expert_id uuid;
  v_status chat_session_status;
  v_request_id uuid;
begin
  if new.sender_type = 'Expert' then
    select profile_id into v_profile_id from public.chat_sessions where session_id = new.session_id;
    if v_profile_id is not null then
      insert into public.notifications (profile_id, notification_type, title, message, is_read)
      values (v_profile_id, 'Support', 'New message from your SafeHer support representative', 'You have a new message in your support conversation.', false);
    end if;

  elsif new.sender_type = 'User' then
    select assigned_expert_id, status into v_assigned_expert_id, v_status
    from public.chat_sessions where session_id = new.session_id;

    if v_assigned_expert_id is not null and v_status in ('EXPERT_ASSIGNED', 'EXPERT_ACTIVE') then
      select request_id into v_request_id
      from public.expert_support_requests
      where conversation_id = new.session_id and status != 'CLOSED'
      order by requested_at desc
      limit 1;

      insert into public.notifications (profile_id, request_id, notification_type, title, message, is_read)
      values (v_assigned_expert_id, v_request_id, 'Support', 'New Message', 'A survivor has sent a new message in a conversation you can access.', false);
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_notify_on_expert_message on public.chat_messages;
create trigger trg_notify_on_expert_message
  after insert on public.chat_messages
  for each row execute procedure public.notify_on_expert_message();


-- =========================================================
-- VERIFICATION — run separately, after applying the above.
-- =========================================================

-- 1. Confirm the new column + index exist:
--   select column_name from information_schema.columns where table_name = 'notifications' and column_name = 'request_id';
--   select indexname from pg_indexes where tablename = 'notifications' and indexname = 'idx_notifications_request_id';

-- 2. New-request fan-out test — as a survivor, insert a row into
--    expert_support_requests (or submit via the app), then as a
--    provincial_staff account:
--   select * from notifications where notification_type = 'Support' and title = 'New Support Request' order by created_at desc limit 1;
--   -- Expect one row per active provincial_staff account, request_id set, no survivor name/reason in the payload.

-- 3. Assignment test — assign that request to a support_expert via
--    the Expert Support Queue page, then as that expert:
--   select * from notifications where notification_type = 'Support' and title = 'Conversation Assigned' order by created_at desc limit 1;
--   -- Expect exactly one row, profile_id = the assigned expert, request_id set.

-- 4. Reassignment test — reassign the same still-EXPERT_ASSIGNED
--    request to a second expert, then as the second expert:
--   select * from notifications where notification_type = 'Support' and title = 'Conversation Assigned' and profile_id = '<second expert>';
--   -- Expect one new row. The first expert should receive no new row,
--   -- and (separately) should no longer be able to select this
--   -- request/session/messages at all once reassigned.

-- 5. Message test — have the survivor send a chat_messages row while
--    the request is EXPERT_ASSIGNED or EXPERT_ACTIVE, then as the
--    assigned expert:
--   select * from notifications where notification_type = 'Support' and title = 'New Message' order by created_at desc limit 1;
--   -- Expect one row, request_id set to the correct (non-closed) request.
--   -- Repeat with NO expert yet assigned (status WAITING_FOR_EXPERT) —
--   -- expect no new row at all.

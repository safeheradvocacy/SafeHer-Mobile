-- =========================================================
-- SafeSpace — Module 28: Provincial Announcements Management
-- with Live Mobile Feed
--
-- Run in the Supabase SQL editor AFTER 00_schema.sql through
-- module27_law_enforcement_case_services_access.sql.
--
-- This file is a single script — every enum below is a BRAND NEW type
-- (not a new value added to an existing one), so unlike module3/4/6/7/
-- 9/10/11/16 there is no Part A/Part B split required. Safe to run top
-- to bottom in one execution.
--
-- ROLE MODEL (per the approved design):
--   * provincial_staff is the ONLY role that can create, edit, publish,
--     schedule, unpublish, or archive announcements — enforced by the
--     new is_provincial_staff() helper below, deliberately narrower
--     than is_provincial_admin() (which already includes
--     provincial_staff for province-wide OPERATIONAL access — see
--     module11 — but also includes provincial_admin/super_admin, which
--     must NOT get publishing rights here).
--   * provincial_admin/super_admin get ZERO special access to this
--     table — not even read access beyond what any other authenticated
--     admin would get (none, since this table has no "other admin" SELECT
--     policy at all). If oversight/moderation for provincial_admin is
--     wanted later, it needs its own explicit policy — deliberately not
--     added here, per the master prompt's "do not automatically grant"
--     instruction.
--   * Every mobile survivor may read PUBLISHED, in-window announcements.
--     No other role (municipal_admin, barangay_admin, shelter_admin,
--     law_enforcement, support_expert) gets any access to this table —
--     none of them were asked for in the brief, and the mobile app is
--     the only consumer of the "read" side today.
--
-- AUDIENCE — the brief asks for a "Target Audience" field on the
-- create/edit form, but also says "support provincial-wide
-- announcements... unless an existing access policy requires a
-- narrower audience" and confirms no narrower policy exists today (the
-- mobile app has exactly one role that uses it at all — survivor; see
-- the mobile app-tour audit). announcement_audience is therefore a
-- real enum with exactly ONE value for now ('All Survivors') —
-- deliberately not a free-text or JSON "audience config" column, which
-- would be unbacked flexibility nothing in this product needs yet.
-- Extending it later is the same `alter type ... add value if not
-- exists` + Part A/B pattern already used throughout this schema.
--
-- SCOPE — deliberately NOT included in this pass, each because it is
-- explicitly optional in the brief ("if supported") and adds
-- significant surface this pass doesn't need to ship the acceptance
-- criterion:
--   * Cover image / attachment upload — no storage bucket, no column.
--     external_link (plain validated text URL) covers the "point to
--     more information" need at near-zero cost instead.
--   * Push notifications for announcements — notify_on_announcement_
--     published() below reuses the EXISTING notification_type
--     'Announcement' (already defined in 00_schema.sql!) and the
--     existing in-app notification pipeline unchanged. module8's own
--     dispatch_push_for_notification() already deliberately excludes
--     'Announcement' from its push-worthy type list ("the one existing
--     type with no individual time-sensitivity... stays in-app-only")
--     — that prior, approved decision is left untouched here. Push for
--     announcements is therefore NOT implemented, including for
--     Urgent priority, and must not be claimed as working.
--
-- Everything below is idempotent (create or replace, drop ... if
-- exists + create, add column/table if not exists) and safe to re-run.
-- =========================================================


-- ---------------------------------------------------------
-- 1. New enum types.
-- ---------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_type where typname = 'announcement_category') then
    create type public.announcement_category as enum (
      'General Announcement', 'Public Advisory', 'Service Update',
      'Program or Activity', 'Safety Information', 'Emergency Advisory', 'Other'
    );
  end if;
  if not exists (select 1 from pg_type where typname = 'announcement_priority') then
    create type public.announcement_priority as enum ('Normal', 'Important', 'Urgent');
  end if;
  if not exists (select 1 from pg_type where typname = 'announcement_status') then
    create type public.announcement_status as enum (
      'Draft', 'Scheduled', 'Published', 'Expired', 'Archived', 'Unpublished'
    );
  end if;
  if not exists (select 1 from pg_type where typname = 'announcement_audience') then
    create type public.announcement_audience as enum ('All Survivors');
  end if;
end $$;


-- ---------------------------------------------------------
-- 2. announcements
-- ---------------------------------------------------------
create table if not exists public.announcements (
  announcement_id   uuid primary key default gen_random_uuid(),
  title              varchar(150) not null check (char_length(btrim(title)) between 3 and 150),
  summary            varchar(300),
  content            text not null check (char_length(content) between 1 and 10000),
  category           announcement_category not null default 'General Announcement',
  priority           announcement_priority not null default 'Normal',
  status             announcement_status not null default 'Draft',
  target_audience    announcement_audience not null default 'All Survivors',
  -- Plain validated URL text — no HTML/script is ever stored or
  -- rendered for ANY field on this table; title/summary/content are
  -- always rendered as plain text on both apps (see AnnouncementsPage.tsx
  -- and AnnouncementsScreen.tsx), which is what actually prevents script
  -- execution — not a database-side sanitizer.
  external_link      text check (external_link is null or external_link ~* '^https://'),
  author_id          uuid not null references public.user_profiles(profile_id),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  published_at       timestamptz,
  scheduled_at       timestamptz,
  expires_at         timestamptz,
  check (expires_at is null or scheduled_at is null or expires_at > scheduled_at)
);

-- Filtering/sorting indexes (status, audience, expiration, publish
-- ordering — exactly the fields named in the brief).
create index if not exists idx_announcements_status on public.announcements(status);
create index if not exists idx_announcements_target_audience on public.announcements(target_audience);
create index if not exists idx_announcements_created_at on public.announcements(created_at desc);
create index if not exists idx_announcements_published_at on public.announcements(published_at desc);
-- Partial indexes — small and only useful while a row is actually in
-- that state, same technique as push_tokens' idx_push_tokens_profile_active.
create index if not exists idx_announcements_scheduled_due on public.announcements(scheduled_at) where status = 'Scheduled';
create index if not exists idx_announcements_expiring on public.announcements(expires_at) where status = 'Published';

alter table public.announcements enable row level security;

-- Realtime publication — REQUIRED, not optional. module17's own
-- investigation found `select * from pg_publication_tables where
-- pubname = 'supabase_realtime'` returned ZERO rows for this entire
-- project at the time: a postgres_changes subscription on a table
-- that was never added to this publication silently never fires,
-- no matter how correct the subscription code or RLS policy is.
-- module17 added law_enforcement_referrals/sos_alerts for exactly
-- this reason; announcements needs the same fix for the live mobile
-- feed (Part E of this brief) to actually work rather than merely
-- compile. notifications/chat_messages are NOT touched here — they
-- have the same unfixed gap, but that's a pre-existing, unrelated
-- issue outside this feature's scope (see the final report).
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'announcements'
  ) then
    alter publication supabase_realtime add table public.announcements;
  end if;
end $$;


-- ---------------------------------------------------------
-- 3. Authorization helper — single-hop self-read, same shape and same
--    safety reasoning as is_provincial_admin()/is_provincial_technical_
--    admin() (module11): queries user_profiles only for the CALLER's
--    own role, so per this project's established rule it needs no
--    `row_security = off` and is safe to call directly from any policy.
-- ---------------------------------------------------------
create or replace function public.is_provincial_staff()
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.user_profiles
    where auth_user_id = auth.uid() and role = 'provincial_staff'
  );
$$;


-- ---------------------------------------------------------
-- 4. RLS policies
-- ---------------------------------------------------------

-- Provincial Staff: full read of every announcement regardless of
-- status (drafts/scheduled/archived included) — they are the only
-- authors, and they need to manage the whole lifecycle from one page.
drop policy if exists "Provincial staff can view all announcements" on public.announcements;
create policy "Provincial staff can view all announcements"
  on public.announcements for select
  using (public.is_provincial_staff());

-- Mobile survivors: published, in-window, audience-eligible only. This
-- is the actual security boundary — the mobile app's own query never
-- needs a status/date filter for correctness, only for UX (e.g.
-- ordering), since RLS would hide a draft/scheduled/expired/archived/
-- unpublished row even if the client asked for it directly.
drop policy if exists "Survivors can view published announcements" on public.announcements;
create policy "Survivors can view published announcements"
  on public.announcements for select
  using (
    public.current_role() = 'survivor'
    and status = 'Published'
    and target_audience = 'All Survivors'
    and (scheduled_at is null or scheduled_at <= now())
    and (expires_at is null or expires_at > now())
  );

drop policy if exists "Provincial staff can create announcements" on public.announcements;
create policy "Provincial staff can create announcements"
  on public.announcements for insert
  with check (public.is_provincial_staff() and author_id = public.current_profile_id());

drop policy if exists "Provincial staff can update announcements" on public.announcements;
create policy "Provincial staff can update announcements"
  on public.announcements for update
  using (public.is_provincial_staff())
  with check (public.is_provincial_staff());

-- No DELETE policy/grant at all — "Archived" is how an announcement is
-- permanently retired from the active feed while staying available for
-- authorized historical access (brief: "Retained for authorized
-- historical access"). A real DELETE would contradict that.

grant select, insert on public.announcements to authenticated;
-- Column-scoped UPDATE grant — the same technique already used on
-- push_tokens (module8) and case_reports' owner_level elsewhere in this
-- schema. announcement_id/author_id/created_at/published_at are
-- deliberately EXCLUDED: a client can never move authorship, back-date
-- creation, or hand-set published_at; the trigger below (6) is the
-- only writer of published_at/updated_at.
grant update (title, summary, content, category, priority, status, target_audience, external_link, scheduled_at, expires_at)
  on public.announcements to authenticated;


-- ---------------------------------------------------------
-- 5. notifications — add the FK the brief's "notification opens the
--    relevant announcement" requirement needs. Nullable and additive,
--    exactly like case_id/sos_id already on this table; no existing
--    row or policy is touched. notification_type already has an
--    'Announcement' value (00_schema.sql, from the very start of this
--    project) — reused unchanged, not redefined.
-- ---------------------------------------------------------
alter table public.notifications add column if not exists announcement_id uuid references public.announcements(announcement_id);
create index if not exists idx_notifications_announcement_id on public.notifications(announcement_id) where announcement_id is not null;


-- ---------------------------------------------------------
-- 6. set_announcement_timestamps() — the ONE place updated_at and
--    published_at are ever written. updated_at always advances;
--    published_at is (re)stamped only on the transition INTO
--    'Published' (covers both "Publish Now" from Draft and the
--    scheduler flipping Scheduled -> Published), which is also the
--    exact edge this project's audit trail needs: the brief's "record
--    the last-updated timestamp" / "preserve the original creation
--    date and author" without ever altering created_at/author_id.
-- ---------------------------------------------------------
create or replace function public.set_announcement_timestamps()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  new.updated_at := now();
  if new.status = 'Published' and (tg_op = 'INSERT' or old.status is distinct from 'Published') then
    new.published_at := now();
  end if;
  return new;
end;
$$;

drop trigger if exists trg_set_announcement_timestamps on public.announcements;
create trigger trg_set_announcement_timestamps
  before insert or update on public.announcements
  for each row execute procedure public.set_announcement_timestamps();


-- ---------------------------------------------------------
-- 7. notify_on_announcement_published() — fan-out to every active
--    survivor, mirroring notify_on_sos_created()'s exact shape
--    (module8). Fires only on the transition INTO 'Published' (same
--    edge as the timestamp trigger above), which is what makes this
--    idempotent per announcement: a later small edit to an
--    already-published row (old.status already 'Published') never
--    re-fires it, and a Realtime event on the client side is a
--    separate, independent concern that never triggers this at all —
--    only a real status transition written to this table does.
--    Deliberately no survivor name/location/sensitive data in the
--    payload (there is none on this table to begin with).
-- ---------------------------------------------------------
create or replace function public.notify_on_announcement_published()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  recipient record;
  v_title text;
begin
  if not (new.status = 'Published' and (tg_op = 'INSERT' or old.status is distinct from 'Published')) then
    return new;
  end if;

  v_title := case new.priority
    when 'Urgent' then 'Urgent Safety Advisory'
    when 'Important' then 'Important Provincial Advisory'
    else 'New Provincial Announcement'
  end;

  for recipient in
    select profile_id from public.user_profiles
    where role = 'survivor' and is_active = true
  loop
    insert into public.notifications (profile_id, announcement_id, notification_type, title, message, is_read)
    values (recipient.profile_id, new.announcement_id, 'Announcement', v_title, left(new.title, 150), false);
  end loop;

  return new;
end;
$$;

drop trigger if exists trg_notify_on_announcement_published on public.announcements;
create trigger trg_notify_on_announcement_published
  after insert or update on public.announcements
  for each row execute procedure public.notify_on_announcement_published();


-- ---------------------------------------------------------
-- 8. Audit trail — reuses the existing generic audit_row_change
--    trigger (module3), same convention as every other tracked table.
-- ---------------------------------------------------------
drop trigger if exists trg_audit_announcements on public.announcements;
create trigger trg_audit_announcements after insert or update or delete on public.announcements
  for each row execute procedure public.audit_row_change('announcement_id');


-- ---------------------------------------------------------
-- 9. publish_due_announcements() + pg_cron schedule — real server-side
--    scheduling, reusing the pg_cron extension module16 already
--    enabled (not re-installing anything new). Runs every minute,
--    unconditionally (this is core lifecycle enforcement, not an
--    optional admin-configured preference like the backup schedule),
--    so a Scheduled announcement goes live and an expired Published
--    one is retired with no browser session open and no client-side
--    timer — directly satisfying "publication can occur without a
--    browser session being open" / "do not rely on a client-side timer".
--    SECURITY DEFINER, no parameters, callable by the cron job's
--    internal context only in practice (nothing meaningful for a
--    client to gain by calling it early — it only ever flips rows that
--    are already due).
-- ---------------------------------------------------------
create or replace function public.publish_due_announcements()
returns void
language plpgsql security definer set search_path = public
as $$
begin
  update public.announcements
  set status = 'Published'
  where status = 'Scheduled' and scheduled_at is not null and scheduled_at <= now();

  update public.announcements
  set status = 'Expired'
  where status = 'Published' and expires_at is not null and expires_at <= now();
end;
$$;

revoke all on function public.publish_due_announcements() from public;
grant execute on function public.publish_due_announcements() to postgres;

do $$
begin
  if exists (select 1 from cron.job where jobname = 'safespace-announcement-lifecycle') then
    perform cron.unschedule('safespace-announcement-lifecycle');
  end if;
  perform cron.schedule('safespace-announcement-lifecycle', '* * * * *', 'select public.publish_due_announcements();');
end $$;


-- =========================================================
-- VERIFICATION — run these separately, after everything above, to
-- confirm the migration applied correctly. All read-only unless noted.
-- =========================================================

-- 1. Confirm the table, RLS, and policies exist:
--   select relrowsecurity from pg_class where relname = 'announcements';
--   select policyname, cmd from pg_policies where tablename = 'announcements';

-- 2. Confirm column grants exclude announcement_id/author_id/created_at/published_at:
--   select column_name from information_schema.role_column_grants
--   where table_name = 'announcements' and grantee = 'authenticated' and privilege_type = 'UPDATE';
--   -- Expect exactly: title, summary, content, category, priority, status,
--   -- target_audience, external_link, scheduled_at, expires_at.

-- 3. Role scoping (run as each test profile):
--   -- as provincial_staff: expect success
--   insert into announcements (title, content, author_id) values ('Test', 'Body', current_profile_id());
--   -- as provincial_admin/super_admin/municipal_admin/barangay_admin/survivor: expect 0 rows / denied, not an error
--   select count(*) from announcements;

-- 4. Audience/lifecycle enforcement (as a survivor test profile):
--   -- A Draft, a Scheduled-in-the-future, an Expired, an Archived, and an
--   -- Unpublished row must all be invisible; only a true Published,
--   -- in-window row should appear:
--   select count(*) from announcements; -- expect exactly the eligible rows

-- 5. Cron job is real:
--   select jobname, schedule, active from cron.job where jobname = 'safespace-announcement-lifecycle';

-- 5b. Realtime publication actually includes this table (module17's bug,
--     avoided here — confirm it didn't regress):
--   select schemaname, tablename from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'announcements';
--   -- Expect exactly one row. Zero rows means the live mobile feed will
--   -- silently never receive a postgres_changes event no matter how
--   -- correct the subscription code is — re-run section 2a above.

-- 6. Notification fan-out (as the publishing provincial_staff, then as
--    a survivor): publish a test announcement, then as that survivor:
--   select * from notifications where notification_type = 'Announcement' order by created_at desc limit 1;
--   -- Expect one row, title matching the priority-based copy above,
--   -- announcement_id set. Edit the SAME announcement's content without
--   -- changing status — expect NO new notification row.

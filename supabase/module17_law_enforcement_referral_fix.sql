-- =========================================================
-- SafeHer — Module 17: Law Enforcement referral fix
--
-- Run in the Supabase SQL editor AFTER 00_schema.sql through
-- module16_technical_admin_backup.sql.
--
-- Single-part file — no new enum values, no new tables, no RLS
-- changes. Both root causes below were confirmed LIVE (real test
-- accounts, real SOS alert, real referral, real REST calls under the
-- officer's actual JWT) before writing this file — see the plan's
-- "Root cause" section for the full trace.
--
-- BUG 1 — "Leave unassigned for now" (the existing, explicit default in
-- both SosMonitoringPage.tsx and CaseDetailPage.tsx's referral modals)
-- creates a law_enforcement_referrals row with assigned_officer_id =
-- null. RLS is CORRECTLY designed so an unassigned referral is
-- invisible to every law_enforcement account (module9's deliberate
-- "assigned-only, no shared queue" model) — but no page anywhere let an
-- admin go back and assign an officer afterward, so the referral was
-- permanently stuck. This is a pure frontend gap (fixed in the admin
-- app, not here) — the existing UPDATE policy/grant on
-- law_enforcement_referrals already permits the referring admin to set
-- assigned_officer_id post-creation; verified live before writing any
-- code. No RLS/grant change is needed or made here.
--
-- BUG 2 — `select * from pg_publication_tables where pubname =
-- 'supabase_realtime'` returned ZERO rows for this entire project.
-- LawEnforcementDashboard.tsx and SosMonitoringPage.tsx both already
-- open a `postgres_changes` channel subscription, but Postgres's
-- logical replication never emits an event for a table outside the
-- publication — so those subscriptions have never actually received
-- anything; only the 60s poll fallback has ever delivered updates.
-- Fixed below by adding the two tables actually needed for this
-- pipeline to the publication. This is standard Supabase realtime
-- configuration, not new infrastructure.
--
-- Also redefines (in place — same trigger wiring, no new triggers) the
-- two law_enforcement_referrals notification functions so an SOS
-- referral and a case referral are never described with the same
-- generic "New law-enforcement referral assigned to you" text — SOS
-- assignment now reuses the existing 'SOS' notification_type (already
-- a real enum value); case assignment keeps 'Assignment'. Neither ever
-- includes survivor name/address/narrative — same minimal payload
-- shape as before.
--
-- Everything below is idempotent and safe to re-run.
-- =========================================================

-- ---------------------------------------------------------
-- 1. Realtime publication fix.
-- ---------------------------------------------------------
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'law_enforcement_referrals'
  ) then
    alter publication supabase_realtime add table public.law_enforcement_referrals;
  end if;

  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'sos_alerts'
  ) then
    alter publication supabase_realtime add table public.sos_alerts;
  end if;
end $$;

-- ---------------------------------------------------------
-- 2. Type-distinct notifications.
-- ---------------------------------------------------------
create or replace function public.notify_on_law_enforcement_referral_created()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  if new.assigned_officer_id is not null then
    if new.sos_id is not null then
      insert into public.notifications (profile_id, case_id, sos_id, notification_type, title, message, is_read)
      values (
        new.assigned_officer_id, new.case_id, new.sos_id, 'SOS',
        'Emergency SOS referred to you',
        coalesce(new.reason, 'An emergency SOS alert has been referred to you for authorized response.'),
        false
      );
    else
      insert into public.notifications (profile_id, case_id, sos_id, notification_type, title, message, is_read)
      values (
        new.assigned_officer_id, new.case_id, new.sos_id, 'Assignment',
        'New case referred to you',
        coalesce(new.reason, 'A case has been referred to you for authorized law-enforcement review.'),
        false
      );
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_notify_law_enforcement_referral_created on public.law_enforcement_referrals;
create trigger trg_notify_law_enforcement_referral_created
  after insert on public.law_enforcement_referrals
  for each row execute procedure public.notify_on_law_enforcement_referral_created();

create or replace function public.notify_on_law_enforcement_assignment()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  if new.assigned_officer_id is not null and new.assigned_officer_id is distinct from old.assigned_officer_id then
    if new.sos_id is not null then
      insert into public.notifications (profile_id, case_id, sos_id, notification_type, title, message, is_read)
      values (
        new.assigned_officer_id, new.case_id, new.sos_id, 'SOS',
        'Emergency SOS referred to you',
        coalesce(new.reason, 'An emergency SOS alert has been referred to you for authorized response.'),
        false
      );
    else
      insert into public.notifications (profile_id, case_id, sos_id, notification_type, title, message, is_read)
      values (
        new.assigned_officer_id, new.case_id, new.sos_id, 'Assignment',
        'New case referred to you',
        coalesce(new.reason, 'A case has been referred to you for authorized law-enforcement review.'),
        false
      );
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_notify_law_enforcement_assignment on public.law_enforcement_referrals;
create trigger trg_notify_law_enforcement_assignment
  after update of assigned_officer_id on public.law_enforcement_referrals
  for each row execute procedure public.notify_on_law_enforcement_assignment();


-- =========================================================
-- VERIFICATION — run these separately, after everything above. All
-- read-only unless noted.
-- =========================================================

-- 1. Confirm both tables are now in the realtime publication:
--   select schemaname, tablename from pg_publication_tables
--   where pubname = 'supabase_realtime' order by tablename;
--   Expect law_enforcement_referrals and sos_alerts present.

-- 2. Confirm type-distinct notifications — as an authorized admin,
--    insert a Pending SOS referral with assigned_officer_id set, then
--    a Pending case referral with assigned_officer_id set:
--   select notification_type, title from notifications
--   where profile_id = '<the assigned officer>' order by created_at desc limit 2;
--   Expect one 'SOS' row ("Emergency SOS referred to you") and one
--   'Assignment' row ("New case referred to you") — never both the
--   same generic text.

-- 3. Re-confirm module9's own original RLS guarantees still hold
--    unchanged (nothing in this file touches any policy):
--   -- unassigned-officer denial, cross-officer denial, recursion test —
--   -- see module9_law_enforcement.sql's own VERIFICATION section.

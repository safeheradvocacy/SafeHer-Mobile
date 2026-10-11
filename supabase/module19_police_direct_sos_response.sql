-- =========================================================
-- SafeSpace — Module 19: Direct police-officer SOS response
--
-- Run in the Supabase SQL editor AFTER 00_schema.sql through
-- module18_terms_acceptance.sql.
--
-- Single-part file — no new enum values, no new tables. Everything
-- below is idempotent (create or replace, drop policy/trigger if
-- exists + create, add column if not exists) and safe to re-run.
--
-- WHAT THIS CHANGES AND WHY — a law_enforcement officer ("Police
-- Officer" in the UI; the role string itself is unchanged) used to
-- only ever see an SOS alert after a case-management admin manually
-- created a law_enforcement_referrals row AND assigned a specific
-- officer to it (module9). That's a real emergency-response delay:
-- this file gives every active law_enforcement account direct,
-- unconditional, province-wide SELECT+UPDATE on sos_alerts instead —
-- no referral required. There is no jurisdiction/precinct/unit concept
-- for this role anywhere in the schema (confirmed by a repo-wide
-- search before writing this), so province-wide is the only
-- non-fabricated boundary available, the same reasoning module9 itself
-- used when it rejected a shared queue for the REFERRAL model.
--
-- This does NOT touch law_enforcement_referrals (table, RLS, triggers,
-- or historical rows) at all — case referrals (case_id-set rows) keep
-- working exactly as before. Only the SOS side (sos_id-set rows) stops
-- being the access-granting mechanism; nothing here deletes or
-- migrates any existing referral data.
--
-- NEW COLUMNS, NOT A NEW STATUS ENUM VALUE — sos_status stays
-- Triggered/Responding/Resolved. acknowledged_by/acknowledged_at are a
-- fact orthogonal to status ("an officer has acknowledged this"),
-- composing with the existing 3-value enum into a New -> Acknowledged
-- -> Responding -> Resolved lifecycle in the UI without inventing a
-- 4th enum value the rest of the schema doesn't know about.
--
-- THE COLUMN-GRANT TRAP (same one module5's own header already
-- documents) — `authenticated` is one shared Postgres role. Once
-- acknowledged_by/acknowledged_at are grant-listed for UPDATE, that
-- grant applies to every authenticated caller, not just police
-- officers (survivors updating their own alert's location columns,
-- or admins updating status, both already hold SOME update grant on
-- this table). The trigger below is the actual gate: it requires
-- current_role() = 'law_enforcement' before honoring any change to
-- those two columns at all, and separately requires acknowledged_by
-- (when set) to equal the caller's own profile — an officer cannot
-- acknowledge on another officer's behalf, and no one else can set it
-- at all regardless of what the shared grant technically permits.
--
-- FIXES A CONFIRMED, PRE-EXISTING, LIVE BUG WHILE IN THIS TRIGGER —
-- validate_sos_alert_update() has always gated status/resolved_at
-- changes on is_admin(), and is_admin() (module6's final definition)
-- does not include provincial_staff, even though RLS
-- (admin_can_access_profile -> is_provincial_admin(), extended for
-- provincial_staff in module11) already lets a provincial_staff admin
-- ATTEMPT the update. The result: a provincial_staff admin's "Mark
-- Responding"/"Mark Resolved" click has always silently failed at the
-- trigger, while the admin app's own error-swallowing (fixed
-- separately, in SosMonitoringPage.tsx) told the survivor it worked.
-- Fixed below by extending the trigger's admin check to
-- is_admin() OR is_provincial_admin() — not by adding provincial_staff
-- to is_admin() itself, which is a much broader gate used by many
-- unrelated tables and was never reviewed for that scope.
--
-- AUDIT — sos_alerts has never had a DB-level audit trigger (only a
-- best-effort client-side logAudit() call). Moving the real police
-- action surface onto this table is exactly the moment to close that
-- gap, with the same generic audit_row_change() function every other
-- privilege-relevant table already uses.
-- =========================================================

-- ---------------------------------------------------------
-- 1. New columns.
-- ---------------------------------------------------------
alter table public.sos_alerts
  add column if not exists acknowledged_by uuid references public.user_profiles(profile_id),
  add column if not exists acknowledged_at timestamptz;

-- ---------------------------------------------------------
-- 2. validate_sos_alert_update() — redefined in place (same trigger
--    wiring from module5, no new trigger object).
-- ---------------------------------------------------------
create or replace function public.validate_sos_alert_update()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  if public.current_role() = 'law_enforcement' then
    -- Acknowledgment is self-only — an officer cannot credit (or
    -- blame) another officer for acting on an alert.
    if new.acknowledged_by is distinct from old.acknowledged_by
       and new.acknowledged_by is not null
       and new.acknowledged_by is distinct from public.current_profile_id() then
      raise exception 'An officer can only acknowledge an SOS alert as themselves.';
    end if;

    -- Forward-only status transitions, matching SOS_STATUS_FLOW already
    -- defined client-side in both apps — never back to an earlier stage.
    if new.status is distinct from old.status then
      if not (
        (old.status = 'Triggered' and new.status in ('Responding', 'Resolved'))
        or (old.status = 'Responding' and new.status = 'Resolved')
      ) then
        raise exception 'Invalid SOS status transition.';
      end if;
    end if;

    -- Auto-attribution: moving off Triggered without an explicit
    -- acknowledgment records one now, in the same statement, so a
    -- status change by a police officer is never left un-attributed.
    if new.status is distinct from old.status and old.status = 'Triggered' and new.acknowledged_by is null then
      new.acknowledged_by := public.current_profile_id();
      new.acknowledged_at := coalesce(new.acknowledged_at, now());
    end if;

    return new;
  end if;

  -- Not a police officer: acknowledged_by/acknowledged_at are
  -- law_enforcement-only, full stop, regardless of what the shared
  -- `authenticated` column grant technically permits (see file header).
  if new.acknowledged_by is distinct from old.acknowledged_by or new.acknowledged_at is distinct from old.acknowledged_at then
    raise exception 'Only an authorized police officer can acknowledge an SOS alert.';
  end if;

  -- Existing admin path, extended to include provincial_staff (the
  -- confirmed pre-existing bug fix — see file header).
  if not (public.is_admin() or public.is_provincial_admin()) then
    if new.status is distinct from old.status or new.resolved_at is distinct from old.resolved_at then
      raise exception 'Only administrators can change an SOS alert''s status.';
    end if;
  end if;

  return new;
end;
$$;
-- Trigger wiring unchanged (already installed by module5); redefining
-- the function in place is sufficient, no drop/create needed here.

-- ---------------------------------------------------------
-- 3. RLS — new, additive policies. The existing referral-gated
--    SELECT policy from module9 ("Law enforcement can view assigned
--    sos alerts") is left in place untouched; it simply becomes
--    redundant for new alerts now that direct access covers everything
--    it covered, plus more.
-- ---------------------------------------------------------
drop policy if exists "Police officers can view all sos alerts" on public.sos_alerts;
create policy "Police officers can view all sos alerts"
  on public.sos_alerts for select
  using (public.current_role() = 'law_enforcement');

drop policy if exists "Police officers can update sos alerts" on public.sos_alerts;
create policy "Police officers can update sos alerts"
  on public.sos_alerts for update
  using (public.current_role() = 'law_enforcement')
  with check (public.current_role() = 'law_enforcement');

grant update (status, resolved_at, acknowledged_by, acknowledged_at) on public.sos_alerts to authenticated;

-- ---------------------------------------------------------
-- 4. notify_on_sos_created() — redefined in place (module8) to also
--    notify every active law_enforcement profile, same unconditional-
--    loop shape already used for provincial_admin/super_admin. Rides
--    the existing generic push-dispatch trigger for free — no Edge
--    Function change needed.
-- ---------------------------------------------------------
create or replace function public.notify_on_sos_created()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  survivor_municipality uuid;
  recipient record;
begin
  select municipality_id into survivor_municipality
  from public.user_profiles where profile_id = new.profile_id;

  for recipient in
    select profile_id from public.user_profiles
    where is_active = true
      and (
        role in ('provincial_admin', 'super_admin', 'law_enforcement')
        or (role in ('municipal_admin', 'barangay_admin') and municipality_id = survivor_municipality)
      )
  loop
    insert into public.notifications (profile_id, sos_id, notification_type, title, message, is_read)
    values (recipient.profile_id, new.sos_id, 'SOS', 'SafeHer Emergency Alert', 'An emergency alert requires your attention.', false);
  end loop;

  return new;
end;
$$;
-- Trigger wiring unchanged (already installed by module8).

-- ---------------------------------------------------------
-- 5. Audit trigger — sos_alerts has never had one; same generic
--    function every other privilege-relevant table already uses.
-- ---------------------------------------------------------
drop trigger if exists trg_audit_sos_alerts on public.sos_alerts;
create trigger trg_audit_sos_alerts
  after insert or update or delete on public.sos_alerts
  for each row execute procedure public.audit_row_change('sos_id');


-- =========================================================
-- VERIFICATION — run these separately, after everything above. All
-- read-only unless noted; live-test under real JWTs before trusting.
-- =========================================================

-- 1. Confirm the new columns exist:
--   select column_name, data_type, is_nullable from information_schema.columns
--   where table_schema = 'public' and table_name = 'sos_alerts'
--     and column_name in ('acknowledged_by','acknowledged_at');

-- 2. Confirm the new policies exist (expect 5 total on sos_alerts: the
--    3 from module2/module5/module9 plus these 2):
--   select policyname, cmd from pg_policies
--   where schemaname = 'public' and tablename = 'sos_alerts' order by cmd;

-- 3. Direct access, no referral — as a disposable law_enforcement
--    account with ZERO law_enforcement_referrals rows, create a
--    disposable SOS alert (as a disposable survivor) and confirm:
--   select sos_id, status, acknowledged_by from sos_alerts where sos_id = '<new alert>';
--   -- expect the row, NOT zero rows / NOT a permission error.

-- 4. Notification fan-out — confirm a notifications row with
--    notification_type = 'SOS' was inserted for the officer's
--    profile_id immediately on alert creation (no referral involved):
--   select notification_id, title from notifications
--   where profile_id = '<officer profile_id>' and sos_id = '<new alert>';

-- 5. Self-attribution + forward-only — as the officer, attempt:
--   update sos_alerts set status = 'Responding' where sos_id = '<new alert>';
--   -- expect success, and acknowledged_by auto-set to the officer's own profile_id.
--   update sos_alerts set status = 'Triggered' where sos_id = '<new alert>';
--   -- expect rejection ("Invalid SOS status transition").
--   update sos_alerts set acknowledged_by = '<a DIFFERENT officer's profile_id>' where sos_id = '<new alert>';
--   -- expect rejection ("can only acknowledge ... as themselves").

-- 6. Non-police cannot touch acknowledgment — as any admin role or the
--    survivor themselves, attempt to set acknowledged_by on any row:
--   update sos_alerts set acknowledged_by = '<own profile_id>' where sos_id = '<any alert>';
--   -- expect rejection ("Only an authorized police officer can acknowledge...").

-- 7. provincial_staff bug fix — as a disposable provincial_staff
--    account, attempt a status change that used to silently fail:
--   update sos_alerts set status = 'Responding' where sos_id = '<any Triggered alert>';
--   -- expect success now (previously: 0 rows affected / silent no-op).

-- 8. Case referrals unaffected — re-run module9's own verification
--    block (cross-officer denial, recursion test, unassigned-officer
--    denial) against a CASE referral; all should behave identically
--    to before this file.

-- 9. Roster size sanity check before relying on the notification
--    fan-out at scale:
--   select count(*) from user_profiles where role = 'law_enforcement' and is_active = true;

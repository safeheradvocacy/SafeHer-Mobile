-- =========================================================
-- SafeSpace — Module 25: Services Provided — scheduling, follow-up,
-- and non-delivery reason (case_services)
--
-- Run in the Supabase SQL editor AFTER module22_case_services.sql.
-- Single-part file — three new nullable columns + one widened
-- column-level grant. No new enum, no new table, no destructive
-- change. Safe to re-run (every statement is idempotent).
--
-- WHY THIS EXISTS — audited against the Services Provided master
-- prompt's field wishlist (admin/src/pages/cases/CaseDetailPage.tsx,
-- admin/src/lib/serviceTypes.ts, module22_case_services.sql): the
-- existing case_services table already covers service_type, status,
-- provider_agency, notes, and provided_at (stamped exactly once, on
-- the transition into 'Provided' — see CaseDetailPage.tsx's
-- updateServiceStatus()). It has no way to record WHEN an
-- intervention is scheduled, WHEN it should be followed up on, or
-- WHY a declined/cancelled/unable-to-provide service didn't happen.
-- Per the master prompt's own instruction ("assess whether an
-- appropriate existing field can be reused... if a schema extension
-- is needed, justify it, keep it minimal"): no existing column
-- reasonably serves these three purposes — updated_at is a generic
-- modification timestamp, not a scheduling or follow-up date, and
-- reusing it would misrepresent unrelated edits as follow-up events.
-- Three narrow, nullable, purely additive columns are the minimal
-- extension.
--
-- NOT a new assignment mechanism — per-service staff assignment was
-- considered and deliberately NOT added here: case-level
-- responsibility is already tracked by the existing case_assignments
-- table, and case_services write access is already scoped to
-- whichever tier currently owns the case (admin_can_access_case_
-- active(), module3_barangay_hierarchy.sql) — there is no reliable,
-- already-existing per-SERVICE assignment concept to extend, and the
-- master prompt explicitly says not to invent one ("only if a
-- reliable assignment mechanism exists").
--
-- ROLLBACK — if this needs to be reverted, the inverse is:
--   revoke update (scheduled_date, follow_up_date, reason_not_provided) on public.case_services from authenticated;
--   alter table public.case_services drop column if exists scheduled_date;
--   alter table public.case_services drop column if exists follow_up_date;
--   alter table public.case_services drop column if exists reason_not_provided;
-- Safe at any time — nothing else in the schema references these
-- columns (no FK, no trigger, no generated column), and the existing
-- trg_audit_case_services full-row audit trigger (module22) needs no
-- change to keep auditing them: it already logs the whole row via
-- to_jsonb(old/new), so these columns are captured automatically the
-- moment they exist, with no separate trigger update required.
-- =========================================================

alter table public.case_services add column if not exists scheduled_date date;
alter table public.case_services add column if not exists follow_up_date date;
alter table public.case_services add column if not exists reason_not_provided text;

-- Postgres column-level GRANTs are additive — this does not replace
-- module22's existing `grant update (status, provided_at,
-- provider_agency, notes) ...`, it adds three more updatable columns
-- to the same existing grant. case_id, service_type, service_id,
-- created_by, created_at stay deliberately ungrantable for UPDATE,
-- exactly as module22 already decided (case association and
-- authorship are never editable after creation).
grant update (scheduled_date, follow_up_date, reason_not_provided) on public.case_services to authenticated;


-- =========================================================
-- VERIFICATION — run separately, after the above. All read-only.
-- =========================================================

-- 1. Confirm the columns exist:
--   select column_name, data_type, is_nullable
--   from information_schema.columns
--   where table_schema = 'public' and table_name = 'case_services'
--     and column_name in ('scheduled_date', 'follow_up_date', 'reason_not_provided');
--   Expect all three, all nullable.

-- 2. Confirm the grant applied:
--   select grantee, column_name, privilege_type
--   from information_schema.column_privileges
--   where table_name = 'case_services' and grantee = 'authenticated' and privilege_type = 'UPDATE'
--   order by column_name;
--   Expect scheduled_date, follow_up_date, reason_not_provided alongside the pre-existing
--   status/provided_at/provider_agency/notes.

-- 3. Confirm the existing full-row audit trigger picks these up with
--    no change needed — update a test row's follow_up_date, then:
--   select old_values, new_values from public.audit_logs
--   where table_name = 'case_services' order by created_at desc limit 1;
--   Expect follow_up_date present in new_values.

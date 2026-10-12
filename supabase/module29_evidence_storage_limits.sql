-- =========================================================
-- SafeSpace — Module 29: Evidence storage limits
--
-- Run in the Supabase SQL editor AFTER 00_schema.sql through
-- module28_provincial_announcements.sql.
--
-- WHY — audit for the "Align Mobile Report Incident with WEDC/CNSP/
-- CICL" master prompt found that the `evidence` bucket (used by
-- ReportIncidentScreen.tsx's optional attachment) has no
-- file_size_limit or allowed_mime_types set anywhere in this project's
-- migration history — unlike identity-documents (module10, 8MB,
-- image/pdf only) and system-backups (module16), which both set these
-- explicitly. This brings evidence in line with that same, already-
-- proven limit. Idempotent: `on conflict do update` only changes the
-- bucket's metadata row — existing uploaded files are completely
-- unaffected; only uploads made AFTER this runs are checked against
-- the new limit.
--
-- No RLS/policy change — this is a Storage-layer limit, not an access
-- policy; the existing storage.objects policies for the evidence
-- bucket (module2/module3) are untouched.
-- =========================================================

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('evidence', 'evidence', false, 8388608, array['image/jpeg', 'image/png', 'image/webp', 'application/pdf'])
on conflict (id) do update set
  public = false,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;


-- =========================================================
-- VERIFICATION — read-only.
-- =========================================================

-- 1. Confirm the limit applied without touching existing files:
--   select id, public, file_size_limit, allowed_mime_types from storage.buckets where id = 'evidence';
--   select count(*) from storage.objects where bucket_id = 'evidence'; -- compare to the count before running this file; must be unchanged

-- 2. Confirm a new upload over 8MB or of an unsupported type is now
--    rejected by Storage itself (try from the mobile app or via a
--    direct REST upload) — expect a storage-layer error, not an RLS
--    error.

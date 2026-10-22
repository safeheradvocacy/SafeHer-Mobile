-- =========================================================
-- SafeSpace — Module 35: Shelter photo upload
--
-- Run in the Supabase SQL editor AFTER every prior module.
--
-- AUDIT FIRST — confirmed before writing this file:
--   * shelters has no image/photo column of any kind (00_schema.sql,
--     module4_shelter_admin.sql) — this is new, not a duplicate.
--   * shelters has no confidentiality/visibility flag at all. Its own
--     SELECT policy ("Authenticated users can view active shelters",
--     module2_case_data_rls.sql) already reads
--     `using (is_active = true or is_admin())` — any authenticated
--     app user (including every survivor on mobile) can already read
--     every active shelter's name/address/coordinates/contact info.
--     A shelter's photo is therefore the SAME sensitivity tier as the
--     rest of its already-public record — a public-read bucket matches
--     that, rather than inventing a private/signed-URL scheme for one
--     field that's less sensitive than the address/coordinates already
--     sitting next to it in the same row, openly queryable today.
--   * Every existing bucket in this project (identity-documents,
--     system-backups, evidence) is private — this is the first public
--     one, which is why it needs its own bucket rather than reusing one
--     of those (mixing a public-read use case into a private bucket
--     would need per-object policy carve-outs for no real benefit).
--   * shelter_admin's existing operational-fields-only restriction
--     (validate_shelter_update(), module4) already excludes
--     shelter_name/address/latitude/longitude/municipality_id by name
--     and allows anything else — a new `photo_path` column needs no
--     change there, only the explicit column GRANT below.
--
-- Single-part file — one new nullable column, no new table, no new
-- enum value. Idempotent (add column if not exists, drop/create
-- policy, bucket insert .. on conflict do update).
-- =========================================================

-- ---------------------------------------------------------
-- 1. shelters.photo_path — the storage object path (e.g.
--    'shelters/<shelter_id>/<timestamp>.jpg'), not a full URL. The
--    public URL is derived client-side via
--    supabase.storage.from('shelter-photos').getPublicUrl(path) in both
--    apps, the same pattern already used for user_profiles.profile_picture
--    (ProfileScreen.tsx) — except that column stores the full URL; this
--    one stores the bare path, which is what lets a bucket/project URL
--    change (unlikely, but free) without a data migration, and is what
--    storage.foldername() below needs to extract the owning shelter_id
--    from directly.
-- ---------------------------------------------------------
alter table public.shelters
  add column if not exists photo_path text;

-- Extends the single existing shelters UPDATE grant list — same
-- "authenticated is one shared Postgres role, the trigger is the real
-- gate" reasoning module4's own header already documents for this exact
-- table.
grant update (photo_path) on public.shelters to authenticated;

-- ---------------------------------------------------------
-- 2. can_manage_shelter(shelter_id) — the shelters UPDATE policy's own
--    three-way check (is_provincial_admin() OR same-municipality admin
--    OR the shelter_admin who owns this exact shelter), factored into a
--    reusable boolean so the storage.objects policies below (which
--    can't embed that OR-chain inline as readably) call one thing, and
--    so this authorization can never drift out of sync with the
--    shelters table's own UPDATE rule. Same SECURITY DEFINER STABLE,
--    single-other-table-lookup shape as admin_can_access_case().
-- ---------------------------------------------------------
create or replace function public.can_manage_shelter(p_shelter_id uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select public.is_provincial_admin()
    or public.current_shelter_id() = p_shelter_id
    or exists (
      select 1 from public.shelters sh
      where sh.shelter_id = p_shelter_id and sh.municipality_id = public.current_municipality_id()
    );
$$;

-- ---------------------------------------------------------
-- 3. shelter-photos bucket — PUBLIC (see the audit note above for why
--    that's the correct, not the lazy, choice here). 5MB limit and the
--    three formats the brief asks for; Storage itself rejects anything
--    outside file_size_limit/allowed_mime_types before any RLS policy
--    even runs, the same enforcement module29's evidence bucket
--    already relies on, so a renamed-extension file still gets checked
--    against its real declared content-type by Storage, not just this
--    app's own client-side pre-check.
-- ---------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('shelter-photos', 'shelter-photos', true, 5242880,
        array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update set
  public = true,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- Path convention: shelters/<shelter_id>/<unique filename> — folder
-- segment [1] is always the literal 'shelters', [2] is the shelter_id,
-- matching the brief's own recommended logical structure.
drop policy if exists "Authorized admins can upload shelter photos" on storage.objects;
create policy "Authorized admins can upload shelter photos"
  on storage.objects for insert
  with check (
    bucket_id = 'shelter-photos'
    and (storage.foldername(name))[1] = 'shelters'
    and public.can_manage_shelter(((storage.foldername(name))[2])::uuid)
  );

drop policy if exists "Authorized admins can replace shelter photos" on storage.objects;
create policy "Authorized admins can replace shelter photos"
  on storage.objects for update
  using (
    bucket_id = 'shelter-photos'
    and (storage.foldername(name))[1] = 'shelters'
    and public.can_manage_shelter(((storage.foldername(name))[2])::uuid)
  );

drop policy if exists "Authorized admins can remove shelter photos" on storage.objects;
create policy "Authorized admins can remove shelter photos"
  on storage.objects for delete
  using (
    bucket_id = 'shelter-photos'
    and (storage.foldername(name))[1] = 'shelters'
    and public.can_manage_shelter(((storage.foldername(name))[2])::uuid)
  );

-- Explicit SELECT policy too, even though `public: true` already serves
-- reads through the /object/public/ URL without going through RLS at
-- all — this only matters for direct storage.objects table/list access
-- (e.g. an admin's own management UI listing files), which DOES still
-- go through RLS regardless of the bucket's public flag. Open to any
-- authenticated reader, matching the shelters table's own "any
-- authenticated user may view an active shelter" SELECT policy exactly
-- — nothing here is more permissive than what's already true of the
-- rest of the shelter record.
drop policy if exists "Authenticated users can list shelter photos" on storage.objects;
create policy "Authenticated users can list shelter photos"
  on storage.objects for select
  using (bucket_id = 'shelter-photos');


-- =========================================================
-- VERIFICATION — run separately, after everything above.
-- =========================================================

-- 1. Confirm the column exists and the bucket is public with the right
--    limits:
--   select column_name, data_type from information_schema.columns
--   where table_schema = 'public' and table_name = 'shelters' and column_name = 'photo_path';
--   select id, public, file_size_limit, allowed_mime_types from storage.buckets where id = 'shelter-photos';

-- 2. As a disposable shelter_admin, upload to
--    shelters/<their own shelter_id>/test.jpg — expect success. Attempt
--    the same path under a DIFFERENT shelter_id — expect denial.

-- 3. As a disposable survivor (or any non-managing role), attempt any
--    upload/update/delete to this bucket — expect denial. Confirm a
--    plain https GET of the resulting public URL works with no auth
--    header at all (that's the point of `public: true`).

-- 4. As a provincial_admin, confirm upload/replace/remove succeeds for
--    any shelter_id's folder.

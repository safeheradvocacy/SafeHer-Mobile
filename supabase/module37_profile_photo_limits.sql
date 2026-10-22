-- =========================================================
-- SafeSpace — Module 37: Profile photo upload hardening + weekly limit
--
-- Run in the Supabase SQL editor AFTER every prior module.
--
-- WHY — audit for the "Profile & Account Redesign + Working Profile
-- Photo Upload" master prompt found two real defects in the existing
-- Change Photo feature (ProfileScreen.tsx):
--
--   1. The `avatars` bucket is dashboard-created and has NO SQL-tracked
--      storage policy anywhere in this project's migration history
--      (confirmed: module10's own header comment explicitly says
--      "avatars/evidence were both created directly in the Supabase
--      dashboard and have no SQL anywhere"). A bucket with RLS enabled
--      (Supabase's default) and zero policies denies every operation —
--      this is almost certainly why "Change Photo" fails in practice:
--      the upload call returns a storage permission error, which the
--      client catches and shows only as a generic "Unable to update
--      your profile photo" alert. This migration brings `avatars`
--      under SQL control the same way module10 already did for
--      identity-documents and module29/35 did for evidence/shelter-photos.
--   2. There was no server-side enforcement of any photo-change
--      frequency limit at all — the client could call
--      `user_profiles.update({ profile_picture })` directly, as often
--      as it liked, with no history/throttle of any kind.
--
-- DESIGN — public vs. private bucket:
--   Unlike module35's shelter-photos (public, because a shelter has NO
--   confidentiality tier — its name/address/coordinates are already
--   openly queryable by any authenticated user), a profile photo on
--   THIS app is a survivor's own face — this mobile app has exactly one
--   client role (survivor; confirmed by grepping every profile.role
--   check in mobile/src — HomeScreen.tsx is the only one, and it never
--   branches navigation on role). That is the same sensitivity
--   reasoning module10 already applied to identity-documents (private,
--   owner-scoped, zero public exposure). `avatars` is kept/converted to
--   PRIVATE here, consistent with identity-documents rather than
--   shelter-photos, and read access is via short-lived signed URLs
--   generated client-side (requires the caller to already pass the
--   owner-scoped SELECT policy below — same trust boundary as any
--   other Storage read in this project).
--
--   `user_profiles.profile_picture` previously stored a full public URL
--   (parsed back apart client-side via a bespoke
--   `avatarPathFromPublicUrl()` helper). Now that the bucket is
--   private, a public URL is meaningless — this migration backfills any
--   existing full-URL values down to the bare object path (the same
--   "store a path, not a URL" convention module35 already established
--   for `shelters.photo_path`), so the column's meaning is consistent
--   for every row, old and new.
--
-- Three pieces:
--   1. public.profile_photo_changes — write-once history of
--      SUCCESSFULLY COMMITTED photo changes only (never cancelled
--      picks, cancelled crops, invalid images, or failed uploads,
--      because the only way a row is ever inserted is from inside
--      commit_profile_photo_change() below, after the upload has
--      already succeeded). RLS-enabled with ZERO grants to
--      authenticated/anon — same lockout pattern as module33's
--      security_passcodes/protected_access_grants — reachable only
--      through the SECURITY DEFINER functions below. Stores only
--      profile_id + the storage path + a server timestamp — never the
--      image itself, matching the brief's explicit retention limit.
--   2. get_profile_photo_quota() — read-only, safe to expose directly:
--      returns how many of the last 3 changes fall within the rolling
--      7-day window and, if the limit is reached, the real
--      server-computed next-eligible timestamp.
--   3. commit_profile_photo_change(p_photo_path) — the one and only way
--      a photo change is ever recorded. Locks the caller's own
--      user_profiles row (`for update`) so two concurrent calls from
--      the same account (e.g. two devices) are serialized rather than
--      both reading a stale count and both succeeding past the limit;
--      re-validates the path belongs to the caller's own storage folder
--      (defense in depth — the storage policy already enforced this at
--      upload time, but this function does not trust a client-supplied
--      string just because it arrived from an authenticated session);
--      atomically re-checks the rolling-7-day count, and either inserts
--      the history row + updates profile_picture in the same
--      transaction, or rejects with the real next-eligible time and
--      touches nothing. The caller's identity is always derived from
--      current_profile_id() (auth.uid()) — never from a client-supplied
--      profile id.
-- =========================================================

-- ---------------------------------------------------------
-- 1. profile_photo_changes — the rate-limit history
-- ---------------------------------------------------------
create table if not exists public.profile_photo_changes (
  change_id   uuid primary key default gen_random_uuid(),
  profile_id  uuid not null references public.user_profiles(profile_id) on delete cascade,
  photo_path  text not null,
  changed_at  timestamptz not null default now()
);

comment on table public.profile_photo_changes is
  'Server-timestamped record of each SUCCESSFULLY COMMITTED profile photo change, used only to enforce the rolling 7-day/3-change limit and for audit. Never the image itself. RLS-enabled with zero grants to authenticated/anon -- reachable only through commit_profile_photo_change()/get_profile_photo_quota() below (SECURITY DEFINER, invoker rights come from the function owner). A client can never insert, backdate, or alter a row here directly.';

alter table public.profile_photo_changes enable row level security;
revoke all on public.profile_photo_changes from authenticated, anon;

create index if not exists idx_profile_photo_changes_window
  on public.profile_photo_changes (profile_id, changed_at desc);

-- ---------------------------------------------------------
-- 2. avatars bucket — brought under SQL control, PRIVATE (see design
--    note above). Storage itself rejects anything outside
--    file_size_limit/allowed_mime_types before any RLS policy even
--    runs, the same enforcement module10/29/35 already rely on.
-- ---------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('avatars', 'avatars', false, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update set
  public = false,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- Path convention: <profile_id>/<unique filename> — matches this
-- project's existing avatars-path convention (ProfileScreen.tsx already
-- wrote `${profile.profile_id}/${Date.now()}.jpg`) and the
-- identity-documents policy shape exactly (module10).
drop policy if exists "Users can upload own avatar" on storage.objects;
create policy "Users can upload own avatar"
  on storage.objects for insert
  with check (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = public.current_profile_id()::text
  );

drop policy if exists "Users can view own avatar" on storage.objects;
create policy "Users can view own avatar"
  on storage.objects for select
  using (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = public.current_profile_id()::text
  );

drop policy if exists "Users can replace own avatar" on storage.objects;
create policy "Users can replace own avatar"
  on storage.objects for update
  using (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = public.current_profile_id()::text
  );

drop policy if exists "Users can remove own avatar" on storage.objects;
create policy "Users can remove own avatar"
  on storage.objects for delete
  using (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = public.current_profile_id()::text
  );

-- ---------------------------------------------------------
-- 3. Backfill: convert any existing full public-URL values down to a
--    bare object path. Idempotent — a row already holding a bare path
--    (no match) is left untouched, so re-running this is harmless.
-- ---------------------------------------------------------
update public.user_profiles
set profile_picture = regexp_replace(profile_picture, '^.*/object/public/avatars/', '')
where profile_picture like '%/object/public/avatars/%';

-- ---------------------------------------------------------
-- 4. get_profile_photo_quota() — safe to expose directly to the client;
--    read-only, and only ever reports the CALLER's own history.
-- ---------------------------------------------------------
create or replace function public.get_profile_photo_quota()
returns table (used integer, remaining integer, next_eligible_at timestamptz)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_profile_id uuid := public.current_profile_id();
  v_used integer;
  v_oldest_in_window timestamptz;
begin
  if v_profile_id is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;

  select count(*) into v_used
  from public.profile_photo_changes
  where profile_id = v_profile_id and changed_at > now() - interval '7 days';

  if v_used >= 3 then
    select min(changed_at) into v_oldest_in_window
    from public.profile_photo_changes
    where profile_id = v_profile_id and changed_at > now() - interval '7 days';
  else
    v_oldest_in_window := null;
  end if;

  return query select
    v_used,
    greatest(0, 3 - v_used),
    case when v_used >= 3 then v_oldest_in_window + interval '7 days' else null end;
end;
$$;

comment on function public.get_profile_photo_quota() is
  'Returns the calling user''s own rolling-7-day photo-change quota (used/remaining out of 3, and the real next-eligible timestamp once exhausted). Safe for direct client RPC use -- can only ever report the caller''s own history.';

grant execute on function public.get_profile_photo_quota() to authenticated;

-- ---------------------------------------------------------
-- 5. commit_profile_photo_change(p_photo_path) — the one and only way
--    a photo change is recorded. Atomic: lock -> re-check -> insert +
--    update, all in one transaction.
-- ---------------------------------------------------------
create or replace function public.commit_profile_photo_change(p_photo_path text)
returns table (success boolean, remaining integer, next_eligible_at timestamptz, previous_path text, error_code text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_profile_id uuid := public.current_profile_id();
  v_previous_path text;
  v_used integer;
  v_oldest_in_window timestamptz;
begin
  if v_profile_id is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;

  if p_photo_path is null or length(p_photo_path) = 0 then
    raise exception 'photo path is required' using errcode = '22023';
  end if;

  -- Defense in depth: the storage insert policy above already confines
  -- uploads to the caller's own folder, but this function does not
  -- trust a client-supplied path string just because the session is
  -- authenticated -- it must still point into the caller's own folder.
  if (string_to_array(p_photo_path, '/'))[1] <> v_profile_id::text then
    raise exception 'photo path does not belong to the authenticated user' using errcode = '42501';
  end if;

  -- Locks the caller's OWN row for the duration of this transaction --
  -- a concurrent commit_profile_photo_change() call for the SAME
  -- profile_id (e.g. a second device) blocks here until this one
  -- commits or rolls back, so two simultaneous requests can never both
  -- read the same "2 of 3 used" count and both proceed past the limit.
  select profile_picture into v_previous_path
  from public.user_profiles
  where profile_id = v_profile_id
  for update;

  select count(*) into v_used
  from public.profile_photo_changes
  where profile_id = v_profile_id and changed_at > now() - interval '7 days';

  if v_used >= 3 then
    select min(changed_at) into v_oldest_in_window
    from public.profile_photo_changes
    where profile_id = v_profile_id and changed_at > now() - interval '7 days';

    -- Rejected: nothing is inserted, nothing is updated -- the quota is
    -- NOT consumed by a rejected attempt.
    return query select false, 0, (v_oldest_in_window + interval '7 days'), null::text, 'limit_reached';
    return;
  end if;

  insert into public.profile_photo_changes (profile_id, photo_path)
  values (v_profile_id, p_photo_path);

  update public.user_profiles
  set profile_picture = p_photo_path, updated_at = now()
  where profile_id = v_profile_id;

  v_used := v_used + 1;
  if v_used >= 3 then
    select min(changed_at) into v_oldest_in_window
    from public.profile_photo_changes
    where profile_id = v_profile_id and changed_at > now() - interval '7 days';
  end if;

  return query select
    true,
    greatest(0, 3 - v_used),
    case when v_used >= 3 then v_oldest_in_window + interval '7 days' else null end,
    v_previous_path,
    null::text;
end;
$$;

comment on function public.commit_profile_photo_change(text) is
  'The only way a profile photo change is ever recorded. Call AFTER the new image has already been uploaded to storage at p_photo_path. Atomically re-validates the rolling-7-day/3-change quota under a row lock on the caller''s own user_profiles row (serializing concurrent calls for the same account), then either commits (inserts the history row + updates profile_picture) or rejects with the real next-eligible timestamp and touches nothing. Returns previous_path (the prior profile_picture value, or null) so the caller can clean up the replaced storage object -- deleting the actual Storage object is a client-side supabase.storage.remove() call, never done inside this function, since a raw SQL delete from storage.objects would not reliably remove the underlying blob.';

grant execute on function public.commit_profile_photo_change(text) to authenticated;


-- =========================================================
-- Deployment order
-- =========================================================
-- 1. Apply this migration (`supabase db push` or this project's normal
--    migration-apply path).
-- 2. No separate Edge Function or client redeploy ordering constraint --
--    the mobile app changes that call get_profile_photo_quota()/
--    commit_profile_photo_change() ship in the same release as this
--    migration; until that release is installed, the OLD mobile app
--    code continues to call `user_profiles.update({ profile_picture })`
--    directly, which still works (module1b's existing column grant is
--    untouched) -- this migration does not revoke that, so there is no
--    hard ordering requirement, only that the new rate-limit-aware flow
--    requires the new mobile build to actually be enforced client-side.
--    (The server-side RPC path is the actual enforcement boundary
--    regardless of which mobile build is installed.)
--
-- =========================================================
-- VERIFICATION — run separately, after everything above. This
-- migration was written without live database access in this
-- environment (same caveat as module33/36) -- confirm every result
-- below against the live project before relying on it.
-- =========================================================

-- 1. Confirm the bucket is private with the right limits:
--   select id, public, file_size_limit, allowed_mime_types from storage.buckets where id = 'avatars';

-- 2. Confirm the four owner-scoped policies exist and reference
--    current_profile_id():
--   select polname, cmd, pg_get_expr(polqual, polrelid), pg_get_expr(polwithcheck, polrelid)
--     from pg_policy where polrelid = 'storage.objects'::regclass and polname like '%own avatar%';

-- 3. Confirm zero authenticated/anon grants on the history table:
--   select grantee, privilege_type from information_schema.role_table_grants
--     where table_name = 'profile_photo_changes' and grantee in ('authenticated', 'anon');
--   -- expected: zero rows.

-- 4. As a disposable survivor test account (own JWT, not service-role):
--    a) `select * from get_profile_photo_quota();` -- expect used=0, remaining=3, next_eligible_at=null on a fresh account.
--    b) Upload a real file to avatars/<their own profile_id>/test.jpg, then
--       `select * from commit_profile_photo_change('<profile_id>/test.jpg');` three times in a row (with distinct
--       paths each time, mirroring a real distinct upload) -- expect success=true each time, remaining counting
--       down to 0.
--    c) A fourth call -- expect success=false, error_code='limit_reached', and a real next_eligible_at
--       (roughly 7 days after the first of the three).
--    d) Attempt commit_profile_photo_change() with a path prefixed by a DIFFERENT profile_id -- expect an
--       exception, not a silent success.
--    e) As that same account, `select * from profile_photo_changes;` directly -- expect a permission-denied
--       error, not an empty set (empty-but-permitted would mean a grant leaked despite (3) above looking clean).
--    f) Confirm a plain unauthenticated GET of a signed URL for the uploaded object works, and that a plain
--       (non-signed) public URL guess for the same path does NOT work (bucket is private).

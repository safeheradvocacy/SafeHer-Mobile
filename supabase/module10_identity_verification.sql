-- =========================================================
-- SafeHer — Module 10: Identity / Phone verification
--
-- Run in the Supabase SQL editor AFTER 00_schema.sql through
-- module9_law_enforcement.sql.
--
-- IMPORTANT — two-part file, same reason as module3/4/6/7/9:
-- Postgres will not let a newly-added enum value be referenced by
-- anything else in the same transaction/script that added it.
-- Run Part A alone first, then come back and run Part B.
--
-- MODEL — three separate, independent verification concepts, never
-- collapsed into one boolean: EMAIL VERIFIED (Supabase Auth's existing
-- auth.users.email_confirmed_at — unchanged by this file), PHONE
-- VERIFIED (new user_profiles.phone_verified boolean, flipped only by
-- a successful supabase.auth.verifyOtp({type:'sms'}) client-side call —
-- no new table needed), and IDENTITY VERIFIED (new
-- user_profiles.identity_verification_status, driven by the new
-- user_verifications table + admin review below). Only IDENTITY
-- verification gates incident-report submission, per the approved
-- design — email/phone verified status is informational only for now.
--
-- SCOPE OF REVIEWERS — barangay_admin and municipal_admin both review
-- verification requests, scoped to municipality_id. There is no finer
-- barangay-level key to split by: a plain survivor profile carries no
-- barangay_id (that column only exists for barangay_admin profiles,
-- see module3), and identity verification can happen BEFORE any case
-- (and therefore any owner_barangay_id) exists. Splitting reviewers
-- more finely than municipality would require fabricating a
-- barangay-on-survivor concept that doesn't exist anywhere in this
-- schema — not done here.
--
-- RLS SAFETY — admin_can_review_verification()/is_identity_verified()
-- are single-hop helpers (they only ever query user_profiles for the
-- CALLER's own role/municipality, exactly like current_role()/
-- is_provincial_admin() elsewhere in this schema), so per this
-- project's established rule they need no `row_security = off` and are
-- safe to call directly from any other table's policy, including
-- case_reports' own INSERT policy. The two new trigger functions
-- (sync + notify) are security definer like every other trigger in
-- this schema (e.g. notify_on_sos_created) — Postgres already lets a
-- security-definer function's owner bypass RLS on the tables it
-- writes to, regardless of which role's action fired the trigger, so
-- a barangay_admin's approval can still update the survivor's
-- user_profiles row and insert a notification for them without any
-- extra grant.
--
-- Everything below is idempotent (create or replace, drop ... if
-- exists + create, add column/table if not exists) and safe to re-run.
-- =========================================================


-- =========================================================
-- PART A — run this alone first, then come back and run Part B.
-- =========================================================

alter type notification_type add value if not exists 'Verification';


-- =========================================================
-- PART B — run only after Part A has been committed on its own.
-- =========================================================

-- ---------------------------------------------------------
-- 1. New enum types.
--    identity_verification_status (4 values, lives on user_profiles —
--    includes 'unverified' for "never submitted anything").
--    verification_status (3 values, lives on each user_verifications
--    row — matches the spec's field list exactly; a row is only ever
--    created once a submission happens, so there is no 'unverified'
--    row state).
-- ---------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_type where typname = 'identity_verification_status') then
    create type identity_verification_status as enum ('unverified', 'pending', 'verified', 'rejected');
  end if;
  if not exists (select 1 from pg_type where typname = 'verification_status') then
    create type verification_status as enum ('pending', 'verified', 'rejected');
  end if;
end $$;

-- ---------------------------------------------------------
-- 2. user_profiles gains the two status columns. Neither is ever
--    added to an authenticated GRANT below — identity_verification_status
--    is settable only by the sync trigger (step 4), phone_verified only
--    by the mobile app's own phone-OTP-verify success path via a
--    column-scoped grant added in step 8.
-- ---------------------------------------------------------
alter table public.user_profiles
  add column if not exists identity_verification_status identity_verification_status not null default 'unverified',
  add column if not exists phone_verified boolean not null default false;

-- ---------------------------------------------------------
-- 3. user_verifications — one row per submission attempt, full history
--    kept (never deleted), current overall status mirrored onto
--    user_profiles by the sync trigger below.
-- ---------------------------------------------------------
create table if not exists public.user_verifications (
  verification_id  uuid primary key default gen_random_uuid(),
  profile_id        uuid not null references public.user_profiles(profile_id) on delete cascade,
  document_path     text not null,
  document_type     varchar(50) not null,
  status            verification_status not null default 'pending',
  submitted_at      timestamptz not null default now(),
  reviewed_at       timestamptz,
  reviewed_by       uuid references public.user_profiles(profile_id),
  rejection_reason  text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create index if not exists idx_user_verifications_profile on public.user_verifications(profile_id);
create index if not exists idx_user_verifications_status on public.user_verifications(status);

-- Enforces "no duplicate concurrent pending submissions" at the DB
-- level. Only blocks a second PENDING row — a resubmission after a
-- final 'verified'/'rejected' outcome is a fresh row and is unaffected.
drop index if exists one_pending_verification_per_user;
create unique index one_pending_verification_per_user on public.user_verifications(profile_id) where (status = 'pending');

alter table public.user_verifications enable row level security;

-- ---------------------------------------------------------
-- 4. Sync trigger — the ONLY code path that ever changes
--    user_profiles.identity_verification_status.
-- ---------------------------------------------------------
create or replace function public.sync_user_verification_status()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  update public.user_profiles
  set identity_verification_status = new.status::text::identity_verification_status
  where profile_id = new.profile_id;
  return new;
end;
$$;

drop trigger if exists trg_sync_user_verification_status on public.user_verifications;
create trigger trg_sync_user_verification_status
  after insert or update of status on public.user_verifications
  for each row execute procedure public.sync_user_verification_status();

-- ---------------------------------------------------------
-- 5. Notification trigger — submitted (fan out to admins in scope,
--    mirrors notify_on_sos_created's recipient shape) and
--    reviewed (notify the submitting survivor, spec's exact copy).
--    Payload is deliberately generic — no document contents, no
--    rejection reason in the SUBMITTED branch (there is none yet).
-- ---------------------------------------------------------
create or replace function public.notify_on_user_verification_change()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  submitter_municipality uuid;
  recipient record;
begin
  if tg_op = 'INSERT' then
    select municipality_id into submitter_municipality
    from public.user_profiles where profile_id = new.profile_id;

    for recipient in
      select profile_id from public.user_profiles
      where is_active = true
        and (
          role in ('provincial_admin', 'super_admin')
          or (role in ('municipal_admin', 'barangay_admin') and municipality_id = submitter_municipality)
        )
    loop
      insert into public.notifications (profile_id, notification_type, title, message, is_read)
      values (
        recipient.profile_id, 'Verification', 'New Identity Verification Request',
        'A new identity verification request is awaiting your review.', false
      );
    end loop;

  elsif tg_op = 'UPDATE' and new.status is distinct from old.status then
    if new.status = 'verified' then
      insert into public.notifications (profile_id, notification_type, title, message, is_read)
      values (
        new.profile_id, 'Verification', 'Account Verified',
        'Your SafeHer account has been verified. You can now submit incident reports.', false
      );
    elsif new.status = 'rejected' then
      insert into public.notifications (profile_id, notification_type, title, message, is_read)
      values (
        new.profile_id, 'Verification', 'Account Verification Requires Attention',
        coalesce('Your account verification was not approved. Reason: ' || new.rejection_reason,
                 'Your account verification requires attention.'),
        false
      );
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_notify_on_user_verification_change on public.user_verifications;
create trigger trg_notify_on_user_verification_change
  after insert or update of status on public.user_verifications
  for each row execute procedure public.notify_on_user_verification_change();

-- ---------------------------------------------------------
-- 6. Helper functions — single-hop (user_profiles only), see the
--    "RLS SAFETY" note at the top of this file for why neither needs
--    `set row_security = off`.
-- ---------------------------------------------------------
create or replace function public.admin_can_review_verification(p_target_profile_id uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select
    public.is_provincial_admin()
    or (
      public.current_role() in ('municipal_admin', 'barangay_admin')
      and exists (
        select 1 from public.user_profiles up
        where up.profile_id = p_target_profile_id
          and up.municipality_id = public.current_municipality_id()
      )
    );
$$;

create or replace function public.is_identity_verified()
returns boolean
language sql stable security definer set search_path = public
as $$
  select coalesce(
    (select identity_verification_status = 'verified' from public.user_profiles where auth_user_id = auth.uid()),
    false
  );
$$;

-- ---------------------------------------------------------
-- 7. RLS policies on user_verifications.
-- ---------------------------------------------------------
drop policy if exists "Users can view own verification requests" on public.user_verifications;
create policy "Users can view own verification requests"
  on public.user_verifications for select
  using (profile_id = public.current_profile_id() or public.admin_can_review_verification(profile_id));

drop policy if exists "Users can submit own verification requests" on public.user_verifications;
create policy "Users can submit own verification requests"
  on public.user_verifications for insert
  with check (profile_id = public.current_profile_id());

drop policy if exists "Admins can review verification requests in scope" on public.user_verifications;
create policy "Admins can review verification requests in scope"
  on public.user_verifications for update
  using (public.admin_can_review_verification(profile_id))
  with check (public.admin_can_review_verification(profile_id));
-- No delete policy — immutable history, matches case_referrals/shelter_referrals.

grant select, insert on public.user_verifications to authenticated;
grant update (status, reviewed_at, reviewed_by, rejection_reason) on public.user_verifications to authenticated;

-- Wire into the existing generic audit trigger (module3) — no bespoke
-- audit code needed for submit/approve/reject.
drop trigger if exists trg_audit_user_verifications on public.user_verifications;
create trigger trg_audit_user_verifications
  after insert or update or delete on public.user_verifications
  for each row execute procedure public.audit_row_change('verification_id');

-- ---------------------------------------------------------
-- 8. user_profiles: extend the existing "Admins can view profiles in
--    scope" SELECT policy with a barangay_admin branch (needed so the
--    admin verification queue's embedded user_profiles join actually
--    resolves for a barangay_admin reviewer — PostgREST embedded joins
--    are evaluated under the real caller's RLS, unlike calls made from
--    inside a security-definer helper). Matches municipal_admin's
--    existing municipality-wide shape exactly — no new access model.
--    Also grant `phone_verified` as authenticated-writable ONLY via the
--    mobile app's own OTP-verify success path (still no admin write).
-- ---------------------------------------------------------
drop policy if exists "Admins can view profiles in scope" on public.user_profiles;
create policy "Admins can view profiles in scope"
  on public.user_profiles for select
  using (
    public.is_provincial_admin()
    or (public.current_role() in ('municipal_admin', 'barangay_admin') and municipality_id = public.current_municipality_id())
  );

grant update (phone_verified) on public.user_profiles to authenticated;

-- ---------------------------------------------------------
-- 9. case_reports — the actual backend enforcement. Redefines the
--    ONE insert policy that has existed, unchanged, since module2.
-- ---------------------------------------------------------
drop policy if exists "Survivors can submit own cases" on public.case_reports;
create policy "Survivors can submit own cases"
  on public.case_reports for insert
  with check (
    survivor_id in (select survivor_id from public.survivors where profile_id = public.current_profile_id())
    and public.is_identity_verified()
  );

-- ---------------------------------------------------------
-- 10. Push-dispatch allow-list — add 'Verification' alongside the
--     existing 5 push-worthy types (redefine in place, module8).
-- ---------------------------------------------------------
create or replace function public.dispatch_push_for_notification()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  edge_url text;
  dispatch_secret text;
begin
  if new.notification_type not in ('SOS', 'Case Update', 'Referral', 'Assignment', 'Support', 'Verification') then
    return new;
  end if;

  select value into edge_url from private.app_config where key = 'push_dispatch_url';
  select value into dispatch_secret from private.app_config where key = 'push_dispatch_secret';

  if edge_url is null or dispatch_secret is null or edge_url = '' or dispatch_secret = '' then
    return new;
  end if;

  perform net.http_post(
    url := edge_url,
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-internal-secret', dispatch_secret),
    body := jsonb_build_object('notification_id', new.notification_id)
  );

  return new;
exception when others then
  raise warning 'dispatch_push_for_notification failed for notification_id=%: %', new.notification_id, sqlerrm;
  return new;
end;
$$;

-- ---------------------------------------------------------
-- 11. Storage — identity-documents bucket. The FIRST SQL-tracked
--     storage bucket + policy set in this project (avatars/evidence
--     were both created directly in the Supabase dashboard and have
--     no SQL anywhere). Server-enforced size/type limits, not just
--     client-side checks. Path convention: {profile_id}/{unique_name},
--     matching the avatars/evidence app-level convention exactly.
-- ---------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('identity-documents', 'identity-documents', false, 8388608,
        array['image/jpeg', 'image/png', 'image/webp', 'application/pdf'])
on conflict (id) do update set
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "Users can upload own verification document" on storage.objects;
create policy "Users can upload own verification document"
  on storage.objects for insert
  with check (
    bucket_id = 'identity-documents'
    and (storage.foldername(name))[1] = public.current_profile_id()::text
  );

drop policy if exists "Users can view own verification document" on storage.objects;
create policy "Users can view own verification document"
  on storage.objects for select
  using (
    bucket_id = 'identity-documents'
    and (storage.foldername(name))[1] = public.current_profile_id()::text
  );

drop policy if exists "Users can replace own verification document" on storage.objects;
create policy "Users can replace own verification document"
  on storage.objects for update
  using (bucket_id = 'identity-documents' and (storage.foldername(name))[1] = public.current_profile_id()::text)
  with check (bucket_id = 'identity-documents' and (storage.foldername(name))[1] = public.current_profile_id()::text);

drop policy if exists "Users can remove own verification document" on storage.objects;
create policy "Users can remove own verification document"
  on storage.objects for delete
  using (bucket_id = 'identity-documents' and (storage.foldername(name))[1] = public.current_profile_id()::text);

drop policy if exists "Admins can view verification documents in scope" on storage.objects;
create policy "Admins can view verification documents in scope"
  on storage.objects for select
  using (
    bucket_id = 'identity-documents'
    and exists (
      select 1 from public.user_verifications uv
      where uv.document_path = storage.objects.name
        and public.admin_can_review_verification(uv.profile_id)
    )
  );


-- =========================================================
-- VERIFICATION — run these separately, after everything above, to
-- confirm the migration applied correctly. All read-only unless noted.
-- =========================================================

-- 1. Confirm 'Verification' is a real notification_type label:
--   select enumlabel from pg_enum where enumtypid = 'notification_type'::regtype order by enumsortorder;

-- 2. Confirm user_verifications exists with RLS enabled and exactly
--    3 policies (select/insert/update, no delete):
--   select relrowsecurity from pg_class where relname = 'user_verifications';
--   select policyname, cmd from pg_policies where tablename = 'user_verifications';

-- 3. Confirm no authenticated grant exists on the sync-only columns:
--   select column_name from information_schema.role_column_grants
--   where table_name = 'user_profiles' and grantee = 'authenticated'
--     and column_name = 'identity_verification_status';
--   Expect 0 rows.

-- 4. Duplicate-pending denial — as a survivor with an existing pending
--    row, attempt a second insert:
--   insert into user_verifications (profile_id, document_path, document_type)
--   values ('<own profile_id>', 'x/y.jpg', 'National ID');
--   Expect a unique-violation error.

-- 5. Report-blocking test — as a survivor whose identity_verification_status
--    is NOT 'verified', attempt:
--   insert into case_reports (survivor_id, municipality_id, case_number, case_type, status)
--   values ('<own survivor_id>', '<own municipality_id>', 'TEST-1', 'Others', 'Pending');
--   Expect a row-level-security policy violation. Flip the profile's
--   identity_verification_status to 'verified' (service role) and retry
--   — expect success this time.

-- 6. Cross-user document denial — as survivor B, attempt:
--   select * from storage.objects where bucket_id = 'identity-documents' and name like '<survivor A profile_id>/%';
--   Expect 0 rows.

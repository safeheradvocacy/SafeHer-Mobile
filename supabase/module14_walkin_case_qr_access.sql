-- =========================================================
-- SafeHer — Module 14: Walk-In Case Management & Client QR Case Access
--
-- Run in the Supabase SQL editor AFTER 00_schema.sql through
-- module13_case_reports_saved_reports.sql.
--
-- Single-part file — unlike module3/4/6/7/9/10/11, nothing here adds a
-- new VALUE to an existing enum type (the only operation Postgres
-- forbids referencing within the same transaction that added it).
-- `case_source` is a brand-new type, and case-link status reuses the
-- existing `verification_status` enum (module10) as-is. Safe to run as
-- one script.
--
-- MODEL — three genuinely separate concepts, never collapsed:
--   1. WALK-IN CASE CREATION (case_reports gains a source_channel +
--      optional pre-account reporter fields; survivor_id becomes
--      nullable so a case can exist before any account does).
--   2. THE QR CREDENTIAL (case_access_tokens) — an opaque, unpredictable,
--      hashed bearer credential that identifies "an access workflow was
--      issued for this case." Never the case ID. Never stored raw.
--      Never proof of identity by itself.
--   3. THE AUTHORIZATION RELATIONSHIP (case_client_links) — the ONLY
--      thing that actually grants a client's account visibility into a
--      case's client-safe projection, and it can only reach 'verified'
--      via an explicit administrator review action. Reuses module10's
--      verification_status enum (pending/verified/rejected) rather than
--      inventing a competing status system, but is a SEPARATE fact from
--      user_profiles.identity_verification_status: general identity
--      verification (module10, untouched by this file) establishes "this
--      is a real, verified person"; a case_client_links row establishes
--      "this specific verified person is authorized to see this specific
--      case" — both are required, neither substitutes for the other.
--
-- SECURITY MODEL —
--   * The QR encodes only a random token (safeher://case-access/<token>).
--     Redemption (redeem_case_access_token) is the ONLY path that can
--     ever create/advance a case_client_links row, and it independently
--     re-checks authentication + is_identity_verified() itself — it
--     never trusts the client to have already done so.
--   * Scanning a valid token creates AT MOST a 'pending' link. Only an
--     administrator's own explicit UPDATE (RLS-scoped exactly like
--     user_verifications' review policy) can move it to 'verified' —
--     never inferred from name/phone/QR-possession matching.
--   * get_client_case() is the ONE narrow projection a client can ever
--     read a case through; it returns null unless a 'verified' link
--     exists for the caller. The real survivor's own existing
--     owns_case()-based access path is completely untouched.
--   * is_operational_case_admin() deliberately EXCLUDES provincial_admin/
--     super_admin (technical roles) even though is_provincial_admin()
--     (used elsewhere) includes provincial_staff — walk-in creation and
--     QR management are operational case-management actions, exactly
--     like /admin/cases itself (already role-gated the same way at the
--     route layer; this is the same boundary enforced at the database).
--
-- Everything below is idempotent (create or replace, drop ... if
-- exists + create, add column/constraint if not exists) and safe to
-- re-run.
-- =========================================================

-- ---------------------------------------------------------
-- 0. pgcrypto — needed for gen_random_bytes()/digest() (token
--    generation + hashing). gen_random_uuid(), used everywhere else in
--    this schema, is a PG13+ core builtin and is NOT proof pgcrypto is
--    already reachable — installed explicitly here, into the standard
--    Supabase `extensions` schema, and referenced fully-qualified below
--    so this works regardless of the calling function's search_path.
-- ---------------------------------------------------------
create extension if not exists pgcrypto with schema extensions;

-- ---------------------------------------------------------
-- 1. case_source — brand-new enum type (not a new value on an existing
--    type), so no Part A/B split is needed for this.
-- ---------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_type where typname = 'case_source') then
    create type public.case_source as enum ('Mobile', 'Walk-In');
  end if;
end $$;

-- ---------------------------------------------------------
-- 2. case_reports — walk-in support columns. survivor_id becomes
--    nullable: a walk-in case with no existing account yet (Scenario B)
--    has nothing to point it at until a client is later verified and
--    linked (see apply_case_client_link_verification below), and must
--    never be satisfied by fabricating a shadow auth user/profile/
--    survivor row — that would itself be the duplicate-user problem
--    this feature is required to avoid.
--
--    walkin_reporter_name/contact are ONLY meaningful pre-association
--    (Scenario B); once a real survivor_id is attached (at creation, for
--    Scenario A, or later via verification, for Scenario B) they are
--    left as a historical record of what the admin was told in person,
--    never re-derived from or synced against the linked account.
-- ---------------------------------------------------------
alter table public.case_reports
  add column if not exists source_channel public.case_source not null default 'Mobile',
  add column if not exists walkin_reporter_name varchar(200),
  add column if not exists walkin_reporter_contact varchar(20),
  add column if not exists walkin_created_by uuid references public.user_profiles(profile_id);

alter table public.case_reports alter column survivor_id drop not null;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'case_reports_source_consistency') then
    alter table public.case_reports add constraint case_reports_source_consistency
      check (
        (source_channel = 'Mobile' and survivor_id is not null)
        or
        (source_channel = 'Walk-In' and (survivor_id is not null or walkin_reporter_name is not null))
      );
  end if;
end $$;

create index if not exists idx_case_reports_source_channel on public.case_reports(source_channel);

-- Lets an operational admin correct a walk-in reporter's contact details
-- post-creation. Additive to the existing column-scoped UPDATE grant
-- (module2 granted `update (status)` — Postgres column grants accumulate
-- across statements, so this does not need to restate that one).
grant update (walkin_reporter_name, walkin_reporter_contact) on public.case_reports to authenticated;

-- ---------------------------------------------------------
-- 3. case_access_tokens — the QR credential. Only a SHA-256 hash is
--    ever stored; the raw token is generated inside generate_/
--    regenerate_case_access_token below, returned exactly once to the
--    calling admin, and never persisted anywhere (including audit_logs
--    — the generic audit trigger attached below logs this row's
--    columns, and token_hash is the only token-shaped column that
--    exists to log).
-- ---------------------------------------------------------
create table if not exists public.case_access_tokens (
  token_id        uuid primary key default gen_random_uuid(),
  case_id         uuid not null references public.case_reports(case_id) on delete cascade,
  token_hash      text not null unique,
  issued_by       uuid not null references public.user_profiles(profile_id),
  issued_at       timestamptz not null default now(),
  expires_at      timestamptz not null default (now() + interval '180 days'),
  revoked_at      timestamptz,
  revoked_by      uuid references public.user_profiles(profile_id),
  last_scanned_at timestamptz,
  created_at      timestamptz not null default now()
);

create index if not exists idx_case_access_tokens_case on public.case_access_tokens(case_id);

-- Enforces "no unlimited active credentials" at the database level —
-- generate_case_access_token() also checks this explicitly first (for a
-- clean error message), this index is the actual backstop.
drop index if exists one_active_token_per_case;
create unique index one_active_token_per_case on public.case_access_tokens(case_id) where (revoked_at is null);

-- ---------------------------------------------------------
-- 4. case_client_links — the actual authorization relationship. Reuses
--    module10's verification_status enum (pending/verified/rejected)
--    rather than inventing a parallel status system. case_number is a
--    deliberate, one-time denormalized copy (written only by
--    redeem_case_access_token) so the requesting client can render
--    their own pending/rejected state without any join into
--    case_reports (which their RLS does not otherwise permit at all).
-- ---------------------------------------------------------
create table if not exists public.case_client_links (
  link_id          uuid primary key default gen_random_uuid(),
  case_id          uuid not null references public.case_reports(case_id) on delete cascade,
  profile_id       uuid not null references public.user_profiles(profile_id) on delete cascade,
  token_id         uuid references public.case_access_tokens(token_id),
  case_number      varchar(30) not null,
  status           verification_status not null default 'pending',
  requested_at     timestamptz not null default now(),
  reviewed_at      timestamptz,
  reviewed_by      uuid references public.user_profiles(profile_id),
  rejection_reason text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (case_id, profile_id)
);

create index if not exists idx_case_client_links_case on public.case_client_links(case_id);
create index if not exists idx_case_client_links_profile on public.case_client_links(profile_id);

-- ---------------------------------------------------------
-- 5. Helper functions — single-hop or case_reports-only reads, same
--    SECURITY DEFINER STABLE pattern as current_role()/can_refer_case()
--    elsewhere in this schema.
-- ---------------------------------------------------------

-- Operational case-management roles only — deliberately excludes
-- provincial_admin/super_admin (technical), unlike is_provincial_admin()
-- which folds provincial_staff in for OTHER purposes. This is the
-- database-level twin of /admin/cases' existing route guard.
create or replace function public.is_operational_case_admin()
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.user_profiles
    where auth_user_id = auth.uid()
      and role in ('municipal_admin', 'barangay_admin', 'provincial_staff')
  );
$$;

-- Authorization gate for inserting a walk-in case_reports row: the
-- caller's own role must match the ownership tier being claimed for the
-- new case. Mirrors can_refer_case()'s shape (module3).
create or replace function public.can_create_walkin_case(
  p_municipality_id uuid, p_owner_level case_owner_level, p_owner_barangay_id uuid
) returns boolean
language sql stable security definer set search_path = public
as $$
  select
    (public.current_role() = 'municipal_admin'
      and p_owner_level = 'Municipality'
      and p_municipality_id = public.current_municipality_id())
    or (public.current_role() = 'barangay_admin'
      and p_owner_level = 'Barangay'
      and p_owner_barangay_id = public.current_barangay_id()
      and p_municipality_id = public.current_municipality_id())
    or (public.current_role() = 'provincial_staff' and p_owner_level = 'Municipality');
$$;

-- Centralizes the hash algorithm so token generation and redemption can
-- never drift apart. No table access — plain immutable SQL function.
create or replace function public.hash_access_token(p_token text)
returns text
language sql immutable
as $$
  select encode(extensions.digest(p_token, 'sha256'), 'hex');
$$;

-- ---------------------------------------------------------
-- 6. QR lifecycle RPCs — the ONLY writers of case_access_tokens. No
--    INSERT/UPDATE grant is ever given to `authenticated` on that table
--    directly (see the grants in section 8) — every write goes through
--    one of these three, which independently re-check authorization
--    every time rather than trusting the caller reached this from an
--    authorized-looking screen.
-- ---------------------------------------------------------

create or replace function public.generate_case_access_token(p_case_id uuid)
returns text
language plpgsql security definer set search_path = public
as $$
declare
  v_raw text;
begin
  if not (public.is_operational_case_admin() and public.admin_can_access_case_active(p_case_id)) then
    raise exception 'Not authorized to generate a client access QR for this case';
  end if;

  if exists (select 1 from public.case_access_tokens where case_id = p_case_id and revoked_at is null) then
    raise exception 'An active QR credential already exists for this case. Use regenerate instead.';
  end if;

  v_raw := translate(encode(extensions.gen_random_bytes(32), 'base64'), '+/=', '-_');

  insert into public.case_access_tokens (case_id, token_hash, issued_by)
  values (p_case_id, public.hash_access_token(v_raw), public.current_profile_id());

  return v_raw;
end;
$$;

create or replace function public.regenerate_case_access_token(p_case_id uuid)
returns text
language plpgsql security definer set search_path = public
as $$
declare
  v_raw text;
begin
  if not (public.is_operational_case_admin() and public.admin_can_access_case_active(p_case_id)) then
    raise exception 'Not authorized to regenerate a client access QR for this case';
  end if;

  update public.case_access_tokens
  set revoked_at = now(), revoked_by = public.current_profile_id()
  where case_id = p_case_id and revoked_at is null;

  v_raw := translate(encode(extensions.gen_random_bytes(32), 'base64'), '+/=', '-_');

  insert into public.case_access_tokens (case_id, token_hash, issued_by)
  values (p_case_id, public.hash_access_token(v_raw), public.current_profile_id());

  return v_raw;
end;
$$;

create or replace function public.revoke_case_access_token(p_case_id uuid)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  if not (public.is_operational_case_admin() and public.admin_can_access_case_active(p_case_id)) then
    raise exception 'Not authorized to revoke the client access QR for this case';
  end if;

  update public.case_access_tokens
  set revoked_at = now(), revoked_by = public.current_profile_id()
  where case_id = p_case_id and revoked_at is null;
end;
$$;

-- ---------------------------------------------------------
-- 7. Client-facing RPCs.
-- ---------------------------------------------------------

-- The mobile app's ONE entry point after a QR scan. Independently
-- re-derives authentication + identity verification + token validity —
-- never trusts the caller. Only ever creates/advances a 'pending' link;
-- 'verified' is reachable exclusively through an administrator's own
-- UPDATE (section 8). Granted to `authenticated` only — the app never
-- calls this while signed out (that state is decided client-side from
-- session presence alone), so no anonymous grant exists at all.
create or replace function public.redeem_case_access_token(p_token text)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_profile_id uuid;
  v_token public.case_access_tokens%rowtype;
  v_link public.case_client_links%rowtype;
  v_case_number varchar(30);
begin
  v_profile_id := public.current_profile_id();
  if v_profile_id is null then
    return jsonb_build_object('state', 'not_authenticated');
  end if;

  select * into v_token from public.case_access_tokens where token_hash = public.hash_access_token(p_token);

  if v_token is null or v_token.revoked_at is not null or v_token.expires_at < now() then
    return jsonb_build_object('state', 'invalid');
  end if;

  update public.case_access_tokens set last_scanned_at = now() where token_id = v_token.token_id;

  if not public.is_identity_verified() then
    return jsonb_build_object('state', 'identity_verification_required');
  end if;

  select case_number into v_case_number from public.case_reports where case_id = v_token.case_id;

  select * into v_link from public.case_client_links where case_id = v_token.case_id and profile_id = v_profile_id;

  if v_link is null then
    insert into public.case_client_links (case_id, profile_id, token_id, case_number, status)
    values (v_token.case_id, v_profile_id, v_token.token_id, v_case_number, 'pending')
    returning * into v_link;
  elsif v_link.status = 'rejected' then
    update public.case_client_links
    set status = 'pending', requested_at = now(), reviewed_at = null, reviewed_by = null,
        rejection_reason = null, token_id = v_token.token_id, updated_at = now()
    where link_id = v_link.link_id
    returning * into v_link;
  end if;

  if v_link.status = 'verified' then
    return jsonb_build_object('state', 'authorized', 'case_id', v_link.case_id);
  elsif v_link.status = 'rejected' then
    return jsonb_build_object('state', 'rejected', 'reason', v_link.rejection_reason);
  else
    return jsonb_build_object('state', 'pending_verification', 'case_number', v_link.case_number);
  end if;
end;
$$;

-- The ONE narrow client-safe projection (spec's "Client Case
-- Projection"). Returns null unless a 'verified' link exists for the
-- caller — never widens case_reports' own RLS. Deliberately excludes
-- description/incident narrative/administrative notes/staff identity —
-- only the fields an existing survivor's own mobile CaseDetailScreen
-- already shows for their own case.
create or replace function public.get_client_case(p_case_id uuid)
returns jsonb
language plpgsql stable security definer set search_path = public
as $$
declare
  v_profile_id uuid;
  v_case public.case_reports%rowtype;
  v_owner_label text;
  v_referral_status text;
  v_history jsonb;
begin
  v_profile_id := public.current_profile_id();
  if v_profile_id is null then
    return null;
  end if;

  if not exists (
    select 1 from public.case_client_links
    where case_id = p_case_id and profile_id = v_profile_id and status = 'verified'
  ) then
    return null;
  end if;

  select * into v_case from public.case_reports where case_id = p_case_id;
  if v_case is null then
    return null;
  end if;

  if v_case.owner_level = 'Barangay' then
    select 'Barangay ' || b.barangay_name into v_owner_label
    from public.barangays b where b.barangay_id = v_case.owner_barangay_id;
  elsif v_case.owner_level = 'Municipality' then
    select m.municipality_name into v_owner_label
    from public.municipalities m where m.municipality_id = v_case.municipality_id;
  else
    v_owner_label := 'Provincial Office';
  end if;

  select sr.referral_status::text into v_referral_status
  from public.shelter_referrals sr
  where sr.case_id = p_case_id
  order by sr.referred_at desc
  limit 1;

  select jsonb_agg(
           jsonb_build_object('status', h.new_status, 'remarks', h.remarks, 'changed_at', h.changed_at)
           order by h.changed_at
         )
    into v_history
  from public.case_status_history h
  where h.case_id = p_case_id;

  return jsonb_build_object(
    'case_id', v_case.case_id,
    'case_number', v_case.case_number,
    'case_type', v_case.case_type,
    'status', v_case.status,
    'priority_level', v_case.priority_level,
    'reported_at', v_case.reported_at,
    'incident_date', v_case.incident_date,
    'assigned_office', coalesce(v_owner_label, '—'),
    'referral_status', v_referral_status,
    'status_history', coalesce(v_history, '[]'::jsonb)
  );
end;
$$;

-- Admin-side "find an existing SafeHer user to associate with this
-- walk-in case" search (Scenario A). A dedicated RPC rather than a
-- widened survivors SELECT policy — barangay_admin cannot otherwise
-- browse the survivors table at all (module3, recursion-avoidance),
-- and this keeps the returned field set intentionally minimal
-- regardless of caller role.
create or replace function public.search_clients_for_walkin(p_query text)
returns table (
  profile_id uuid,
  survivor_id uuid,
  first_name varchar,
  last_name varchar,
  phone_number varchar,
  municipality_name varchar,
  barangay_name varchar
)
language sql stable security definer set search_path = public
as $$
  select up.profile_id, s.survivor_id, up.first_name, up.last_name, up.phone_number,
         m.municipality_name, b.barangay_name
  from public.user_profiles up
  join public.survivors s on s.profile_id = up.profile_id
  left join public.municipalities m on m.municipality_id = s.municipality_id
  left join public.barangays b on b.barangay_id = s.barangay_id
  where up.role = 'survivor' and up.is_active = true
    and (
      up.first_name ilike '%' || p_query || '%'
      or up.last_name ilike '%' || p_query || '%'
      or up.phone_number ilike '%' || p_query || '%'
    )
    and (
      public.current_role() = 'provincial_staff'
      or (public.current_role() = 'municipal_admin' and s.municipality_id = public.current_municipality_id())
      or (public.current_role() = 'barangay_admin' and s.barangay_id = public.current_barangay_id())
    )
  order by up.last_name, up.first_name
  limit 20;
$$;

-- ---------------------------------------------------------
-- 8. RLS — case_reports gains a second, additive INSERT policy (OR'd
--    with the existing "Survivors can submit own cases", same pattern
--    already used across this schema for multi-role SELECT policies).
-- ---------------------------------------------------------
drop policy if exists "Operational admins can create walk-in cases" on public.case_reports;
create policy "Operational admins can create walk-in cases"
  on public.case_reports for insert
  with check (
    source_channel = 'Walk-In'
    and walkin_created_by = public.current_profile_id()
    and public.is_operational_case_admin()
    and public.can_create_walkin_case(municipality_id, owner_level, owner_barangay_id)
  );

-- case_access_tokens — admins in jurisdiction can see token METADATA
-- (never the raw token, which is never stored). No client ever sees
-- this table. No authenticated INSERT/UPDATE/DELETE grant exists —
-- every write goes through the SECURITY DEFINER RPCs above.
alter table public.case_access_tokens enable row level security;

drop policy if exists "Admins can view access tokens in scope" on public.case_access_tokens;
create policy "Admins can view access tokens in scope"
  on public.case_access_tokens for select
  using (public.admin_can_access_case_active(case_id));

grant select on public.case_access_tokens to authenticated;

-- case_client_links — a client sees only their own rows (link metadata,
-- never case narrative); admins in jurisdiction see all requests for
-- their cases and are the only ones who can move status forward. No
-- authenticated INSERT/DELETE grant — only redeem_case_access_token()
-- inserts.
alter table public.case_client_links enable row level security;

drop policy if exists "Clients and admins can view case links" on public.case_client_links;
create policy "Clients and admins can view case links"
  on public.case_client_links for select
  using (profile_id = public.current_profile_id() or public.admin_can_access_case_active(case_id));

drop policy if exists "Operational admins can review case links in scope" on public.case_client_links;
create policy "Operational admins can review case links in scope"
  on public.case_client_links for update
  using (public.is_operational_case_admin() and public.admin_can_access_case_active(case_id))
  with check (public.is_operational_case_admin() and public.admin_can_access_case_active(case_id));

grant select on public.case_client_links to authenticated;
grant update (status, reviewed_at, reviewed_by, rejection_reason) on public.case_client_links to authenticated;

-- ---------------------------------------------------------
-- 9. RPC execute grants — authenticated only. Revoking from PUBLIC
--    first closes the default PostgreSQL "EXECUTE granted to PUBLIC on
--    every new function" behavior, matching the least-privilege intent
--    described throughout this file.
-- ---------------------------------------------------------
revoke all on function public.generate_case_access_token(uuid) from public;
revoke all on function public.regenerate_case_access_token(uuid) from public;
revoke all on function public.revoke_case_access_token(uuid) from public;
revoke all on function public.redeem_case_access_token(text) from public;
revoke all on function public.get_client_case(uuid) from public;
revoke all on function public.search_clients_for_walkin(text) from public;

grant execute on function public.generate_case_access_token(uuid) to authenticated;
grant execute on function public.regenerate_case_access_token(uuid) to authenticated;
grant execute on function public.revoke_case_access_token(uuid) to authenticated;
grant execute on function public.redeem_case_access_token(text) to authenticated;
grant execute on function public.get_client_case(uuid) to authenticated;
grant execute on function public.search_clients_for_walkin(text) to authenticated;

-- ---------------------------------------------------------
-- 10. Triggers.
-- ---------------------------------------------------------

-- Generic audit trail (module3's audit_row_change) — real actor (auth.uid()
-- resolves correctly even inside these SECURITY DEFINER RPCs, since
-- SECURITY DEFINER changes privilege, not auth.uid() itself), real
-- old/new diffs. Structurally incapable of logging a raw token: the raw
-- token is never written to any column, only its hash.
drop trigger if exists trg_audit_case_access_tokens on public.case_access_tokens;
create trigger trg_audit_case_access_tokens after insert or update or delete on public.case_access_tokens
  for each row execute procedure public.audit_row_change('token_id');

drop trigger if exists trg_audit_case_client_links on public.case_client_links;
create trigger trg_audit_case_client_links after insert or update or delete on public.case_client_links
  for each row execute procedure public.audit_row_change('link_id');

-- The ONLY code path that backfills case_reports.survivor_id for a
-- Scenario-B walk-in case (created with no account) — fires only on the
-- transition INTO 'verified', i.e. only after an administrator's own
-- explicit approval. Leaves survivor_id untouched if it was already set
-- (Scenario A — the admin already associated an existing account at
-- creation time).
create or replace function public.apply_case_client_link_verification()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  v_survivor_id uuid;
begin
  if new.status = 'verified' and old.status is distinct from 'verified' then
    select survivor_id into v_survivor_id from public.survivors where profile_id = new.profile_id;
    if v_survivor_id is not null then
      update public.case_reports
      set survivor_id = v_survivor_id, updated_at = now()
      where case_id = new.case_id and survivor_id is null;
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_apply_case_client_link_verification on public.case_client_links;
create trigger trg_apply_case_client_link_verification
  after update of status on public.case_client_links
  for each row execute procedure public.apply_case_client_link_verification();

-- Notifications — reuses the existing 'Verification' notification_type
-- (module10) rather than adding a new enum value for a closely-related
-- concept. Submitted -> fan out to admins in the case's current owning
-- scope (mirrors notify_on_user_verification_change's shape); reviewed
-- -> notify the requesting client. Never includes case narrative.
create or replace function public.notify_on_case_client_link_change()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  v_case_municipality uuid;
  v_case_owner_level case_owner_level;
  v_case_owner_barangay uuid;
  recipient record;
begin
  if tg_op = 'INSERT' then
    select municipality_id, owner_level, owner_barangay_id
      into v_case_municipality, v_case_owner_level, v_case_owner_barangay
    from public.case_reports where case_id = new.case_id;

    for recipient in
      select profile_id from public.user_profiles
      where is_active = true
        and (
          role = 'provincial_staff'
          or (role = 'municipal_admin' and municipality_id = v_case_municipality)
          or (role = 'barangay_admin' and v_case_owner_level = 'Barangay' and barangay_id = v_case_owner_barangay)
        )
    loop
      insert into public.notifications (profile_id, case_id, notification_type, title, message, is_read)
      values (
        recipient.profile_id, new.case_id, 'Verification', 'New Case Access Request',
        'A client has requested access to case ' || new.case_number || '. Review is required before access is granted.',
        false
      );
    end loop;

  elsif tg_op = 'UPDATE' and new.status is distinct from old.status then
    if new.status = 'verified' then
      insert into public.notifications (profile_id, case_id, notification_type, title, message, is_read)
      values (
        new.profile_id, new.case_id, 'Verification', 'Case Access Approved',
        'Your access to case ' || new.case_number || ' has been approved. You can now view it in My Cases.', false
      );
    elsif new.status = 'rejected' then
      insert into public.notifications (profile_id, case_id, notification_type, title, message, is_read)
      values (
        new.profile_id, new.case_id, 'Verification', 'Case Access Request Not Approved',
        coalesce(
          'Your request to access case ' || new.case_number || ' was not approved. Reason: ' || new.rejection_reason,
          'Your request to access case ' || new.case_number || ' was not approved.'
        ),
        false
      );
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_notify_on_case_client_link_change on public.case_client_links;
create trigger trg_notify_on_case_client_link_change
  after insert or update of status on public.case_client_links
  for each row execute procedure public.notify_on_case_client_link_change();


-- =========================================================
-- VERIFICATION — run these separately, after everything above, to
-- confirm the migration applied correctly. All read-only unless noted.
-- =========================================================

-- 1. Confirm the new type/tables/columns exist:
--   select enumlabel from pg_enum where enumtypid = 'case_source'::regtype order by enumsortorder;
--   select column_name from information_schema.columns where table_name = 'case_reports'
--     and column_name in ('source_channel','walkin_reporter_name','walkin_reporter_contact','walkin_created_by');
--   select is_nullable from information_schema.columns where table_name = 'case_reports' and column_name = 'survivor_id';
--   select relrowsecurity from pg_class where relname in ('case_access_tokens','case_client_links');

-- 2. Confirm no authenticated grant exists for writing case_access_tokens
--    directly (expect 0 rows — only the RPCs, running as their owner,
--    can write it):
--   select privilege_type from information_schema.role_table_grants
--   where table_name = 'case_access_tokens' and grantee = 'authenticated'
--     and privilege_type in ('INSERT','UPDATE','DELETE');

-- 3. Confirm one_active_token_per_case is enforced — as an authorized
--    admin, call generate_case_access_token() twice for the same case_id
--    without revoking: the second call should raise the "already exists"
--    exception before ever reaching the unique index.

-- 4. Confirm technical provincial_admin/super_admin are denied (RLS,
--    not just missing UI) — as such an account:
--   select public.is_operational_case_admin();  -- expect false
--   select public.generate_case_access_token('<any case_id>');  -- expect exception

-- 5. Confirm redeem_case_access_token() never reveals case data before
--    a 'verified' link exists — as an identity-verified survivor with no
--    prior link to a real case's token:
--   select public.redeem_case_access_token('<raw token>');
--   -- expect {"state":"pending_verification","case_number":"..."} only,
--   -- never case_type/description/status.

-- 6. Confirm get_client_case() returns null for a non-verified caller,
--    and the true projection only after an admin sets the link's status
--    to 'verified':
--   select public.get_client_case('<case_id>');

-- 7. Confirm audit_logs never contains a raw token — inspect new_values
--    for any row where table_name = 'case_access_tokens':
--   select new_values from audit_logs where table_name = 'case_access_tokens' order by created_at desc limit 5;
--   -- expect only token_hash (a hex digest), never a token that was
--   -- passed into generate_/regenerate_/redeem_case_access_token.

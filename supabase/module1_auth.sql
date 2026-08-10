-- =========================================================
-- SafeHer — Module 1 (Authentication) Supabase setup
-- Run in the Supabase SQL editor. Assumes municipalities and
-- user_profiles already exist exactly as defined in the ERD.
-- =========================================================

-- ---------------------------------------------------------
-- 1. Auto-create a user_profiles row whenever a new
--    auth.users row is created, reading the metadata passed
--    from supabase.auth.signUp({ options: { data } }).
--    This sidesteps the RLS/session race that happens if the
--    client tries to insert user_profiles itself before email
--    confirmation completes.
-- ---------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.user_profiles (
    auth_user_id,
    municipality_id,
    role,
    first_name,
    last_name,
    phone_number
  )
  values (
    new.id,
    nullif(new.raw_user_meta_data->>'municipality_id', '')::uuid,
    'survivor',
    coalesce(new.raw_user_meta_data->>'first_name', ''),
    coalesce(new.raw_user_meta_data->>'last_name', ''),
    new.raw_user_meta_data->>'phone_number'
  );
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- ---------------------------------------------------------
-- 2. Row Level Security
-- ---------------------------------------------------------
alter table public.user_profiles enable row level security;
alter table public.municipalities enable row level security;

-- user_profiles: a user may only read/update their own row.
-- (Municipal/provincial/super admins get broader read policies
-- in the module that builds case management & admin dashboards.)
drop policy if exists "Users can view own profile" on public.user_profiles;
create policy "Users can view own profile"
  on public.user_profiles for select
  using (auth.uid() = auth_user_id);

drop policy if exists "Users can update own profile" on public.user_profiles;
create policy "Users can update own profile"
  on public.user_profiles for update
  using (auth.uid() = auth_user_id)
  with check (auth.uid() = auth_user_id);

-- No insert policy for user_profiles: rows are only created by the
-- handle_new_user() trigger (runs as security definer), never directly
-- by the client.

-- municipalities: public read of active municipalities only
-- (needed for the sign-up dropdown, before the user has a session).
drop policy if exists "Anyone can view active municipalities" on public.municipalities;
create policy "Anyone can view active municipalities"
  on public.municipalities for select
  using (is_active = true);

-- ---------------------------------------------------------
-- 3. Seed data — Aurora province municipalities
--    (safe to re-run: skips existing names)
-- ---------------------------------------------------------
insert into public.municipalities (municipality_name, province, is_active)
select name, 'Aurora', true
from (values
  ('Baler'), ('Maria Aurora'), ('Dipaculao'), ('Casiguran'),
  ('Dingalan'), ('Dilasag'), ('Dinalungan'), ('San Luis')
) as seed(name)
where not exists (
  select 1 from public.municipalities m where m.municipality_name = seed.name
);

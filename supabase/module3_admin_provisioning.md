# SafeHer — Initial admin provisioning

There is no public admin registration page, by design (see `PART 10` of the
admin portal spec). This is the one-time, manual bootstrap process for
creating your **first** administrator. After that first account exists, use
it to sign in to the admin portal and provision every subsequent admin
through the already-deployed `create-admin-user` Edge Function
(`supabase/functions/create-admin-user/index.ts`) — that function requires an
existing admin's JWT to authorize the call, which is exactly why it can't
create the *first* one; only this manual path can.

The service-role key is never used from a browser in either path. This
bootstrap uses the Supabase Dashboard's own admin UI; the Edge Function uses
the service-role key server-side only, as already wired up.

## Two admin roles, from the ERD

```
role = 'provincial_admin'  →  municipality_id = NULL   (province-wide access)
role = 'municipal_admin'   →  municipality_id = <uuid> (scoped to one municipality)
```

## Step 1 — Create the Auth user

Supabase Dashboard → your project → **Authentication → Users → Add user**.
Enter an email and a strong password, and check **Auto Confirm User** (so it
doesn't need an email-confirmation link). Click Create.

**What happens automatically:** the `on_auth_user_created` trigger
(`supabase/module1_auth.sql`) fires and inserts a `user_profiles` row for
this user with `role = 'survivor'` (its hardcoded default) and
`first_name = ''`, `last_name = ''`. This is expected — the trigger has no
way to know this user is meant to be an admin. Step 2 promotes it.

## Step 2 — Find the new user's ID

Same Users list — click the new user, copy their **User UID** (a UUID). Or:

```sql
select id, email from auth.users where email = 'the-email-you-just-created@example.com';
```

## Step 3 — Promote the profile to an admin role

Run in the SQL Editor, filling in the placeholders. **For a provincial
admin:**

```sql
update public.user_profiles
set
  role = 'provincial_admin',
  municipality_id = null,
  first_name = 'PASTE_FIRST_NAME',
  last_name = 'PASTE_LAST_NAME',
  is_active = true
where auth_user_id = 'PASTE_USER_UID_FROM_STEP_2';
```

**For a municipal admin**, first find the target municipality's ID:

```sql
select municipality_id, municipality_name from public.municipalities order by municipality_name;
```

then:

```sql
update public.user_profiles
set
  role = 'municipal_admin',
  municipality_id = 'PASTE_MUNICIPALITY_ID',
  first_name = 'PASTE_FIRST_NAME',
  last_name = 'PASTE_LAST_NAME',
  is_active = true
where auth_user_id = 'PASTE_USER_UID_FROM_STEP_2';
```

This `UPDATE` runs as the SQL Editor's own role (effectively an owner/admin
context in the dashboard), so it isn't subject to the client-facing RLS
policies in `module2_case_data_rls.sql` that restrict what the `authenticated`
role can change about a profile (those correctly block a signed-in admin from
self-promoting via the app — they don't apply to you running SQL directly in
the dashboard).

## Step 4 — Verify

```sql
select profile_id, first_name, last_name, role, municipality_id, is_active
from public.user_profiles
where auth_user_id = 'PASTE_USER_UID_FROM_STEP_2';
```

Confirm `role` and `municipality_id` are exactly what you expect, then sign
in at `/admin/login` with that email/password.

## Suggested test accounts for development

Use placeholders like these when creating your own — **do not commit real
passwords to git**; generate a strong password in the dashboard itself and
keep it in a password manager, not in this file or any `.env`.

| Role | Email | Municipality |
|---|---|---|
| Provincial Administrator | `admin-provincial@example.com` | *(none — NULL)* |
| Municipal Administrator | `admin-municipal@example.com` | Baler *(or your chosen municipality)* |

## After the first admin exists

Sign in as the provincial admin, go to **Administrator Management**
(`/admin/users`), and once `create-admin-user` is deployed
(`supabase functions deploy create-admin-user` from the Supabase CLI, with
`SUPABASE_SERVICE_ROLE_KEY` set as an Edge Function secret — never in the
web app's `.env`), every subsequent admin — municipal or provincial — should
be created through that flow instead of repeating this manual process.

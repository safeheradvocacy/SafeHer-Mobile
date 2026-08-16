# SafeHer — Full System Build

This is the complete SafeHer platform built on top of your **existing** Supabase project — nothing here creates, replaces, or seeds your database. Every query targets the exact 14 tables from your ERD.

## What's in here

```
safeher/
├── shared/database.types.ts     ← canonical schema types, generated from your ERD.
│                                   Copied byte-for-byte into mobile/ and admin/ —
│                                   this is what guarantees the two apps can never
│                                   disagree about a column name or enum value.
├── mobile/                      ← React Native (Expo) app for survivors, all 9 modules
├── admin/                       ← React + Vite dashboard for Municipal AND Provincial
│                                   admins (one app, role-gated routing/nav — see below)
└── supabase/functions/          ← 2 Edge Functions (see "Server-side pieces")
```

## Before you run anything

Both apps need your real Supabase project values:

```
cd mobile  && cp .env.example .env       # fill in EXPO_PUBLIC_SUPABASE_URL / ANON_KEY
cd admin   && cp .env.example .env.local # fill in VITE_SUPABASE_URL / ANON_KEY
```

Get these from Supabase → Project Settings → API. **Only ever use the `anon` public key in these files — never the service role key.**

Two Storage buckets are assumed and referenced by the code: `evidence` (private) and `avatars` (public). If they don't already exist in your project, create them in Supabase → Storage.

## Running it

```
cd mobile && npm install && npm start     # then press i / a, or scan the QR code with Expo Go
cd admin  && npm install && npm run dev   # http://localhost:5173
```

Both were verified in this build with `npx tsc --noEmit` (zero errors) and the admin app additionally with a full `npm run build` (zero errors).

## Server-side pieces (deploy when ready)

Two things need your Supabase CLI, because they need the **service role key**, which must never live in either client app:

1. **`supabase/functions/create-admin-user`** — creates new admin logins (Auth user + `user_profiles` row) from the admin dashboard's "Add administrator" button. Until deployed, that button explains what to do instead of silently failing.
2. **`supabase/functions/safeher-chatbot`** — AI backend for the mobile chatbot. Until deployed (or without an `ANTHROPIC_API_KEY` secret set), the chatbot automatically falls back to a small offline FAQ so it's never broken, just less capable.

```
supabase functions deploy create-admin-user
supabase functions deploy safeher-chatbot
supabase secrets set ANTHROPIC_API_KEY=sk-ant-...   # optional, for the chatbot
```

## Design decisions made where the spec left something open

- **One admin app, not two.** The spec describes "distinct experiences" for Municipal and Provincial admins; this is built as a single React app with role-gated routing and navigation rather than two separately deployed apps. Same login screen, same components, the sidebar and every query scope themselves to the signed-in admin's role. This avoids duplicating ~70% of the code (and the drift/conflict risk that comes with maintaining two copies) while still fully separating what each role can see and do.
- **`case_number` generation** happens client-side (municipality code + date + random digits) since the ERD doesn't show a DB trigger/sequence for it. If your Supabase project already auto-generates this server-side, delete the one call site in `mobile/src/lib/audit.ts` (`generateCaseNumber`) and stop passing it on insert.
- **Case status / referral status / SOS status transitions** are constrained to the forward flows implied by your ERD's enum ordering (e.g. a case can't jump straight from `Pending` to `Resolved`) — defined once in `shared/database.types.ts` as `CASE_STATUS_FLOW` etc., and enforced in the UI on both the status-update dropdown and the notification text.
- **Assignment "staff"** — the ERD's `role` enum only has 4 values (no separate social-worker/police/lawyer roles), so `case_assignments.assigned_to` is scoped to `municipal_admin`/`provincial_admin` accounts in the case's municipality.

## The one real bug this build caught

`@supabase/supabase-js` above `2.45.4` (confirmed broken at `2.112.2`, the version npm resolves by default today) has a type-inference regression: every `.insert()` call's argument type silently collapses to `never`, meaning TypeScript stops checking insert payloads at all — exactly the kind of thing that causes a runtime/DB mismatch nobody notices until production. Both `package.json` files pin the exact version `2.45.4` (not a `^` range) to avoid it. If you bump this dependency later, re-run `npx tsc --noEmit` on both apps before trusting the result.

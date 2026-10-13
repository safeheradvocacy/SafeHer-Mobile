---
title: Deliverable 1 — Project Structure and Technical Inventory
status: complete (first pass)
date: 2026-10-12
---

# Deliverable 1 — Project Structure and Technical Inventory

Status: **COMPLETE** for the purpose of this first pass. Re-check before
manuscript submission if further development occurs after this date.

## Project directory

Root: `C:\Users\Jastine\Desktop\safeher-mobile` — no root-level
`package.json` **[CODE]**. The repository is four independent
applications/packages, not a monorepo with shared tooling:

```
safeher-mobile/
├── mobile/     React Native (Expo) survivor-facing app
├── admin/      React + Vite administrative web dashboard
├── shared/     one file: database.types.ts (hand-aligned copy, not a build-linked package)
└── supabase/   SQL migrations, Edge Functions, email templates
```

GitHub remote: `https://github.com/safeheradvocacy/SafeHer-Mobile.git`,
branch `main` **[SESSION]**.

## Mobile application

- **Entry point**: `mobile/index.ts` → `mobile/App.tsx` **[CODE]**.
- **Navigation root**: `mobile/src/navigation/RootNavigator.tsx` — branches
  between `AuthNavigator` (unauthenticated), `AppNavigator`
  (authenticated), and a dedicated `RecoveryNavigator` (password-reset
  deep link, kept separate specifically so a recovery session can never
  silently drop a user into the full app with their old password still
  active) **[CODE]**.
- **Screens**: `mobile/src/screens/` — 27 `.tsx` files across 12
  subdirectories (`announcements`, `assistant`, `auth`, `caseAccess`,
  `cases`, `home`, `incident`, `legal`, `notifications`, `profile`,
  `shelters`, `sos`, `verification`). Some files contain more than one
  logical screen (e.g. `auth/PasswordRecovery.tsx` exports both
  `ForgotPasswordScreen` and `ResetPasswordScreen`;
  `auth/SplashOnboardingWelcome.tsx` exports the splash/onboarding/welcome
  sequence) **[CODE]**. Prior documentation **[DOC-2026-09]** counted 26
  distinct navigable screens; this is consistent with the file count
  above and was not re-derived screen-by-screen in this pass — flagged
  as **[GAP]** for an exact re-count if the manuscript needs a precise
  figure.
- **Auth/session**: `mobile/src/contexts/AuthContext.tsx` (session state,
  sign-in/up/out, OTP verification, password recovery/change) and
  `mobile/src/lib/supabase.ts` (Supabase client init) **[CODE]**.
- **Session storage**: `mobile/src/lib/secureSessionStorage.ts` — a
  chunked `expo-secure-store` adapter (Android Keystore / iOS Keychain),
  with a one-time migration path from the prior `AsyncStorage`-backed
  storage **[SESSION]**.
- **Deep links**: `mobile/src/lib/deepLinks.ts` (auth callback links,
  Client Case Access QR links) **[CODE]**.
- **Emergency SOS logic**: `mobile/src/lib/useSosTrigger.ts` (state
  machine: idle → locating → located/location-unavailable → saving →
  done/error), `mobile/src/lib/sosLocation.ts` (location
  preflight/acquisition), UI in `mobile/src/screens/sos/SosScreen.tsx`
  and `mobile/src/screens/home/SosConfirmSheet.tsx` **[CODE]**.
- **AI assistant**: `mobile/src/lib/useSupportChat.ts`,
  `mobile/src/screens/assistant/SafeHerAssistantScreen.tsx` — calls
  `supabase.functions.invoke('safeher-chatbot', ...)`; no AI provider key
  present anywhere in `mobile/src` (repo-wide grep for `sk-`, `openai`,
  `anthropic`, `groq`, `apiKey` near AI code returned no privileged key)
  **[SESSION]**.
- **Push notifications**: `mobile/src/lib/pushNotifications.ts`,
  `mobile/src/lib/usePushNotifications.ts` — explicitly self-documented
  in code as inert without an EAS `projectId` and inert inside Expo Go;
  separate from the database-backed `notifications` table **[SESSION]**.
- **App configuration**: `mobile/app.config.ts` (dynamic Expo config —
  converted from a static `app.json` during this working session's Android
  release-prep pass), `mobile/eas.json` (build profiles) **[SESSION]**.
- **Dependencies**: `mobile/package.json` / `mobile/package-lock.json` —
  Expo SDK `~57.0.27`, React `19.2.3`, React Native `0.86.3`, TypeScript
  `~6.0.3`, `@supabase/supabase-js@2.45.4` (pinned exact, not a `^`
  range — see "The one real bug this build caught" in the root
  `README.md`, which remains a plausible historical note even though the
  rest of that file is stale) **[SESSION]**.
- **Automated tests**: **none found.** No `*.test.*`/`*.spec.*` files and
  no Jest/testing-library config anywhere under `mobile/src` **[SESSION,
  confirmed via direct filesystem search]**.
- **Anomaly**: `mobile/safeher-mobile/` is a separate, unrelated,
  committed Vite+React scaffold (its own `package.json`, React 19,
  `oxlint`) with no connection to the real Expo app — appears to be a
  very early false-start committed in "SECIND COMMIT" and never
  developed further or removed. Flagged for the team to decide whether
  to delete; not touched by this audit. `mobile/supabase/.temp/` is
  Supabase CLI metadata (project ref only, not a secret) accidentally
  committed from running the CLI in the wrong directory — low-priority
  housekeeping item **[SESSION]**.

## Web dashboard (admin)

- **Entry point**: `admin/src/main.tsx` → `admin/src/App.tsx` (React
  Router `BrowserRouter`, route guards via `ProtectedRoute`) **[CODE]**.
- **Pages**: `admin/src/pages/` — 52 `.tsx` files across 20
  subdirectories, including role-specific dashboards
  (`dashboard/ProvincialDashboard.tsx`, `MunicipalDashboard.tsx`,
  `TechnicalAdminDashboard.tsx`, `LawEnforcementDashboard.tsx`,
  `ShelterAdminDashboard.tsx`, `SupportExpertDashboard.tsx`, routed via
  `dashboard/DashboardRouter.tsx`), case management
  (`cases/CaseListPage.tsx`, `CaseDetailPage.tsx`), SOS monitoring
  (`sos/SosMonitoringPage.tsx`), shelters (5 pages under `shelters/`),
  law enforcement (`lawEnforcement/SosReferralsPage.tsx`,
  `CaseReferralsPage.tsx`), police personnel administration
  (`police/PoliceManagementPage.tsx`), verification queues
  (`verifications/`), reports and analytics (10 files under `reports/`,
  one `*Analytics*`/`*Reports*` pair per role), announcements, barangay
  inter-agency requests, backups, audit log, roles/permissions reference
  page, and the public landing page (`public/`) **[CODE]**.
- **Auth/session**: `admin/src/contexts/AuthContext.tsx`,
  `admin/src/lib/supabase.ts`, route protection in
  `admin/src/routes/ProtectedRoute.tsx` **[CODE/SESSION]**.
- **Permission model**: `admin/src/lib/permissions.ts` — the single
  source of truth the sidebar (`admin/src/layout/AppLayout.tsx`) and
  route guards both derive from, explicitly documented in its own header
  as *"a UI-layer convenience, not the actual security boundary"* — RLS
  is **[SESSION, read in full multiple times this session]**.
- **PDF/report generation**: `admin/src/lib/reportDocument.ts`,
  `governmentReportDocument.ts`, `analyticsReportDocument.ts` — real
  vector PDF generation via `jspdf`/`jspdf-autotable`, not screenshots
  **[SESSION]**.
- **Dependencies**: `admin/package.json` — React 18.3.1, Vite 5.4.5,
  TypeScript 5.5.4, `@supabase/supabase-js@2.45.4` (same pinned version
  as mobile), `react-router-dom@6.26.2`, `jspdf`, `chart.js`,
  `@react-google-maps/api` **[SESSION]**.
- **Automated tests**: **none found** — same confirmation method as
  mobile **[SESSION]**.
- **Deployment**: `admin/vercel.json` (SPA rewrite config) — prepared for
  Vercel during this working session; **not confirmed deployed to a live
  URL** (no Vercel account access in this environment) **[SESSION]**.

## Backend (Supabase)

- **Base schema**: `supabase/00_schema.sql` — original tables, enums
  (`user_role` originally 4 values, `case_type` originally 6 values,
  etc.), base RLS **[SCHEMA]**.
- **Migrations**: 32 numbered module files,
  `module1_auth.sql` through `module32_police_management.sql`, plus
  `module1b_grants_and_survivors_rls.sql` and
  `module3b_service_role_grants.sql` (both exist specifically because a
  live test surfaced a missing grant after the fact — documented in
  `[DOC-2026-09]`) and one markdown file,
  `module3_admin_provisioning.md` **[SCHEMA, counted directly]**. This
  is **14 more modules than the 18 the 2026-09 report described** —
  the backend has grown substantially since that report was written.
- **Edge Functions**: `supabase/functions/` — 6 functions:
  `create-admin-user`, `admin-user-metadata`, `safeher-chatbot`,
  `send-push-notification`, `backup-create`, `backup-restore`, plus a
  `_shared` helper directory **[SCHEMA]**. This is one more than the 5
  the 2026-09 report described (`admin-user-metadata` was added since).
  Every function pairs a caller-JWT-scoped client (to verify identity)
  with a service-role-key-holding client (for the privileged action
  itself) — confirmed by direct reads of `create-admin-user/index.ts`
  and `admin-user-metadata/index.ts` earlier this session **[SESSION]**.
- **Email templates**: `supabase/email-templates/` — a custom-built
  template system (shared brand/layout partials + 4 templates:
  confirm-signup, reset-password, security-code/OTP, change-email) with
  a `build.mjs` generator. Explicitly documented in its own `README.md`
  as requiring **manual deployment** into the Supabase Dashboard's
  auth-email template slots — **not auto-deployed by any script**
  **[SESSION]**.

## Database (summary — full inventory in Deliverable 3)

- **32 tables**, enumerated directly from every `create table` statement
  across `00_schema.sql` and all 32 modules: `announcements`,
  `audit_logs`, `backup_schedule`, `barangay_action_requests`,
  `barangays`, `case_access_tokens`, `case_assignments`,
  `case_client_links`, `case_referrals`, `case_reports`,
  `case_services`, `case_status_history`, `chat_messages`,
  `chat_sessions`, `evidence`, `expert_support_requests`, `faqs`,
  `law_enforcement_referrals`, `municipalities`, `notifications`,
  `push_tokens`, `saved_reports`, `shelter_referrals`,
  `shelter_requests`, `shelters`, `sos_alerts`, `survivors`,
  `system_backups`, `system_restores`, `terms_acceptances`,
  `user_profiles`, `user_verifications` **[SCHEMA, grep-verified,
  reproducible]**.
- **`user_role` enum** — started with 4 values in `00_schema.sql`
  (`survivor`, `municipal_admin`, `provincial_admin`, `super_admin`),
  grew via `alter type user_role add value` in modules 3, 4, 6, 7, 9,
  and 11, adding `barangay_admin`, `shelter_admin`, `support_expert`,
  `shelter_staff`, `law_enforcement`, `provincial_staff` respectively —
  **10 enum values total, ever added [SCHEMA]**. `shelter_staff` was
  later retired (`module24_retire_shelter_staff_role.sql` — role
  consolidation into `shelter_admin`) and `super_admin` is no longer a
  creatable target for new accounts (enforced in
  `create-admin-user/index.ts`, treated identically to `provincial_admin`
  everywhere it still appears) **[SESSION]**. **Currently active,
  assignable roles: 8** — `survivor`, `barangay_admin`,
  `municipal_admin`, `provincial_staff`, `provincial_admin`,
  `shelter_admin`, `support_expert`, `law_enforcement`.
- **Storage buckets** (from `insert into storage.buckets` statements):
  `identity-documents` (private, 8 MB limit, module10),
  `evidence` (private, 8 MB limit, module29),
  `system-backups` (private, 50 MB limit, module16) **[SCHEMA]**.
  **Resolved (was a [GAP] as of 2026-10-12, first pass):** the
  `avatars` bucket is **not** created by any SQL migration, and this is
  explicitly confirmed by the project's own code —
  `module10_identity_verification.sql` line 338 states outright:
  *"avatars/evidence were both created directly in the Supabase
  dashboard and have no SQL anywhere."* That comment is itself now
  partially stale: `evidence` **was** later brought under migration
  tracking (`module29_evidence_storage_limits.sql`), confirmed by a
  full-repository grep for `storage.buckets` entries. `avatars` was
  **not** — no later module (11 through 32) adds it either, confirmed
  by the same grep. It is used in both apps as a **public** bucket via
  `getPublicUrl()` (`mobile/src/screens/profile/ProfileScreen.tsx`),
  which is an appropriate access level for non-sensitive profile photos
  — this is not a security concern. **It is, however, a real
  deployment-reproducibility gap**: a fresh deployment of this project
  from the repository alone, onto a new Supabase project, would be
  missing this bucket (and whatever access policies it has) entirely,
  since nothing in version control creates it. The bucket's *exact*
  RLS/access policy text still cannot be confirmed without live
  Dashboard access **[CODE + SCHEMA, confirmed 2026-10-13]**.

## Authentication (summary — full workflow verification in Deliverable 2)

- Supabase Auth, email/password, **OTP-code email verification** (not
  link-based — 8-digit code, `supabase.auth.verifyOtp({..., type:
  'email'})`), PKCE flow for the mobile app's deep-link exchanges,
  separate password-recovery deep-link handling **[SESSION, read
  directly in `AuthContext.tsx` this session]**.
- `super_admin` as a role label is deprecated for new accounts but
  remains a live enum value — see above.

## Authorization

- Role-based access control at the application layer
  (`admin/src/lib/permissions.ts`) **layered on top of** PostgreSQL
  Row-Level Security, which both the project's own code comments and
  `[DOC-2026-09]` identify as the actual enforcement boundary — the
  permissions file is explicit that it is "a UI-layer convenience, not
  the actual security boundary" **[SESSION]**. Full role/permission
  matrix is Deliverable 3D (not yet produced in this pass).

## Testing

- **No automated test suite exists in this repository** — confirmed by
  direct filesystem search in both `mobile/` and `admin/` **[SESSION]**.
- The only documented testing evidence found is the **manual,
  scenario-based RLS verification run** described in
  `SafeHer_System_Documentation_Report.html` §6 (SOS/case-referral
  pipeline, 8 scenarios, disposable test accounts, cleaned up
  afterward) — this is **prior evidence from the team's own earlier
  report**, not something this audit re-ran **[DOC-2026-09]**.
- That same report's own Recommendations section (§7) already
  recommends converting this into an automated regression suite —
  **this has not happened** as of this inspection **[SESSION +
  DOC-2026-09, consistent]**.
- Within this working session, `npx tsc --noEmit` and `npx expo-doctor`
  were run repeatedly against the mobile app (clean/21-of-21 passing at
  last run) and `npx tsc -b && vite build` against the admin app (clean)
  — these are **static/build-correctness checks, not functional or
  security tests** **[SESSION]**.

## Deployment

- **Mobile**: Expo-managed workflow (no committed `/ios` or `/android`
  native folders — confirmed via `.gitignore`). EAS Build is configured
  (`mobile/eas.json` — `development`/`preview`/`production` profiles)
  but **no build has actually been produced** — this environment has no
  EAS account authentication **[SESSION]**.
- **Admin**: `admin/vercel.json` prepared for a Vercel deployment this
  session; **no evidence of an actual live production URL** — this
  environment has no Vercel account access **[SESSION]**.
- **Backend**: a Supabase project exists and is linked (confirmed via
  `supabase/.temp/project-ref` and `mobile/supabase/.temp/linked-project.json`
  — project name "SafeHer", a single project, no separate staging
  instance found or referenced anywhere) **[SCHEMA]**. Whether all 32
  migration modules have actually been **applied** to that live project
  cannot be confirmed without live database access — **[GAP]**.

## Documentation

- `README.md` (root) — stale, see above.
- `SafeHer_System_Documentation_Report.html` (root) — substantive,
  partially stale on counts, see above.
- `SafeHer-System-Inventory.pdf` (root) — inaccessible in this
  environment, see above.
- `supabase/module3_admin_provisioning.md` — a markdown note alongside
  the SQL modules, not yet read in this pass — **[GAP, next step]**.
- `supabase/email-templates/README.md` — read earlier this session,
  documents the manual Supabase Dashboard deployment requirement for
  email templates **[SESSION]**.
- No requirements specification, ERD diagram file, or user manual was
  found in the repository itself — **[GAP]**. (The 2026-09 HTML report
  contains an inline architecture diagram and references an "ERD," but
  no separate ERD file exists in the repo.)

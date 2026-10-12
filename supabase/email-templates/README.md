# SafeSpace transactional email templates

## Why this directory exists

Supabase Auth's confirmation/recovery/OTP emails are configured in the
**Supabase Dashboard** (Authentication → Email Templates), not in this
repository — there is no `supabase/config.toml` in this project defining
templates as code, and no custom email-sending Edge Function exists
either (confirmed by inspecting every function in `supabase/functions/`:
none of them send transactional email). This means:

- Nothing in source control was ever driving what users actually
  received. Whatever is live today is whatever was last typed into the
  dashboard — which is very plausibly still Supabase's own default,
  unbranded template, or old SafeHer-branded copy.
- **I cannot deploy to that dashboard from this session** — no Supabase
  project credentials exist here. This directory produces the exact
  HTML to paste in; actually pasting it is a manual step you (or
  whoever holds dashboard access) must do.

## What's here

- `_shared/brand.mjs` — color tokens and copy constants, taken directly
  from the real, existing design system (`admin/src/theme/theme.css`'s
  `:root` tokens and `admin/src/components/branding/Logo.tsx`'s actual
  wordmark colors), not invented.
- `_shared/emailLayout.mjs` — the ONE shared layout renderer every
  template calls. This is the "reusable design system" the brief asks
  for — table-based, inline-CSS HTML (the real cross-client-compatible
  baseline, not modern CSS that only looks right in a browser preview).
- `confirmSignup.mjs`, `resetPassword.mjs`, `securityCode.mjs`,
  `changeEmail.mjs` — one file per Supabase template slot, each calling
  the shared layout with its own heading/body/action.
- `build.mjs` — generates the final static files. Run:
  ```
  node supabase/email-templates/build.mjs
  ```
  Output lands in `dist/<name>.html` (paste this into the dashboard)
  and `dist/<name>.txt` (see "Plain-text" below).

## Where each file goes in the Supabase Dashboard

Go to **Authentication → Email Templates** in the Supabase Dashboard
for this project, then for each slot: open it, switch to the HTML
source view, delete the existing content, paste the matching file
below, and save.

| Dashboard template slot | File to paste | Subject to set | Really used by this app? |
| --- | --- | --- | --- |
| **Confirm signup** | `dist/confirmSignup.html` | `Verify your email address \| SafeSpace` | Yes — mobile signup, 8-digit code entered in `EmailVerificationScreen` |
| **Reset Password** | `dist/resetPassword.html` | `Reset your password \| SafeSpace` | Yes — mobile `PasswordRecovery` and admin forgot-password / admin-triggered reset |
| **Magic Link** | `dist/securityCode.html` | `Your SafeSpace security code` | Yes, repurposed — mobile's "confirm it's you" step before a password change (`ChangePasswordScreen`) uses `signInWithOtp`, which sends Supabase's Magic Link template. Only the `{{ .Token }}` code is ever consumed; nothing in this app relies on the click-through link. |
| **Change Email Address** | `dist/changeEmail.html` | `Confirm your email address change \| SafeSpace` | **Not currently triggered.** No code path calls `updateUser({ email })` today. Branded anyway so this provisioned-by-default slot doesn't sit in Supabase's generic styling — remove this step if you'd rather leave it configured later only if/when that feature ships. |
| Invite user | — not touched | — | Not used — admin-created accounts are created pre-confirmed (`email_confirm: true`) with a password set directly by the creating admin; no invite email is ever sent. |
| Reauthentication | — not touched | — | Not used — this app deliberately reuses the Magic Link mechanism instead of Supabase's dedicated `reauthenticate()` API (see `securityCode.mjs`'s own header comment). |

## Sender identity (also dashboard-only)

Set in **Project Settings → Auth → SMTP Settings**:

- **Sender display name**: `SafeSpace`
- **Sender address / SMTP credentials**: leave whatever is already
  configured and verified — this task does not authorize changing
  provider, address, or credentials. If the current sender name shown
  there still says "SafeHer" or something generic, that's the one
  field actually worth changing; the address itself should stay as-is
  unless you've independently verified a new one.
- Do not expect a reply to the sender address to reach anyone unless
  that inbox is genuinely monitored — the footer deliberately never
  claims it is (there's no configured support email anywhere in this
  codebase; the footer instead points at the in-app Support chat, a
  real, verified channel).

## Plain-text ("multipart") emails

Supabase's dashboard Email Templates UI exposes **one HTML field per
slot and no separate plain-text field** — this was checked, not
assumed. There is no way to attach the `dist/*.txt` plain-text
equivalent through that UI today. Delivering true multipart (HTML +
text) mail would require routing these specific messages through a
custom SMTP-sending Edge Function instead of Supabase's built-in Auth
mailer — a materially different delivery architecture, and explicitly
against this task's own instruction to preserve the existing email
delivery mechanism rather than replace it for a branding change. The
`.txt` files are kept here as the documented equivalent content, ready
to use if that architecture ever changes.

## Keeping these in sync later

If the brand palette, footer copy, or layout ever needs to change,
edit `_shared/brand.mjs` and/or `_shared/emailLayout.mjs` once, re-run
`build.mjs`, and re-paste all four `dist/*.html` files into the
dashboard — never hand-edit a template directly in Supabase's UI, or
the next `build.mjs` run will silently regress it back out of sync.

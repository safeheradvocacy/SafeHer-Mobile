---
title: SafeSpace Capstone Audit — Scope, Access, and Evidence Sources
status: in progress — first pass
date: 2026-10-12
---

# Scope of this audit pass

This is a **read-only** inspection. No source code, database schema, RLS
policy, Supabase configuration, environment variable, deployment setting,
or production data was modified to produce this document. All findings
below come from direct inspection of the repository as it exists on disk
at `C:\Users\Jastine\Desktop\safeher-mobile`, run on 2026-10-12.

## What was actually accessible

| Location | Accessible? | Notes |
|---|---|---|
| `mobile/` (full source tree) | Yes | Expo/React Native app. `node_modules` excluded from inspection (not source). |
| `admin/` (full source tree) | Yes | Vite/React web app. |
| `shared/` | Yes | One file: `database.types.ts`. |
| `supabase/` (migrations, functions, email templates) | Yes | 32 numbered SQL modules + `00_schema.sql` + 6 Edge Functions. |
| `.env` files (both apps) | Yes, **names only** | Confirmed which variables are *referenced*; values were never read or reproduced, per this audit's own confidentiality rule and the project's own `.env.example` convention. |
| Live Supabase project (database, Auth, Storage) | **No** | No database credentials, dashboard access, or live query capability in this environment. Every database claim below is sourced from migration *files*, not a live schema introspection. |
| Google Play Console / EAS dashboard | No | Not applicable to this audit (no build or deployment action taken). |
| `SafeHer-System-Inventory.pdf` (repo root) | **No** | PDF rendering is unavailable in this environment (`pdftoppm`/poppler-utils not installed). File exists (764 KB, dated 2026-09-09) but its contents are **not** reflected anywhere in this audit. A team member with normal PDF access should review it separately and reconcile it against these findings. |
| `SafeHer_System_Documentation_Report.html` (repo root) | Yes | Read in full. Treated as a **prior, team-authored** evidence source — see below. |
| Physical devices, Play Store listing, any human evaluator | No | Not applicable to a code audit. |

## Existing documentation found, and how it's being treated

Three pre-existing documents were found at the repository root. None of
them are treated as current fact without cross-checking against the
actual source/schema — this is the central discipline this task
requires.

1. **`README.md`** (repo root) — **Severely stale.** Describes "exactly
   14 tables," "4 role enum values," "2 Edge Functions," and
   `ANTHROPIC_API_KEY` as the AI provider. Direct inspection (below)
   found 32 tables, 10 historical role-enum values (8 currently active),
   and 6 Edge Functions. This file appears to date from the project's
   earliest commits and has not been updated since. **Do not cite this
   file as a current source for the manuscript** — it is preserved here
   only as a historical artifact.
2. **`SafeHer_System_Documentation_Report.html`** (repo root, dated
   2026-09-09) — A substantive, well-constructed capstone documentation
   report, authored under the system's prior name ("SafeHer") and a
   narrower VAWC-only framing. Its **author list matches the actual git
   commit author** for this repository (Ramirez, Danica Jane B.), so
   this is treated as a **genuine prior artifact of this research team**,
   not a third party source. It reports (as of its writing): 9
   administrative roles, 26 survivor-facing mobile screens, 18 schema
   modules, 5 Edge Functions, 8 municipalities covered. Direct
   inspection today confirms the *architecture and methodology*
   descriptions in this report remain substantively accurate, but the
   **counts are now stale** — the project has grown to 32 schema modules
   and 6 Edge Functions since this report was written (see Deliverable 1
   below). It also documents a real, specific RLS verification run
   (§6, "SOS & case referral pipeline") performed against disposable
   test accounts — this is **historical evidence of testing having
   occurred**, not something this audit re-ran or re-verified itself.
   This report also predates the SafeSpace rebrand and the
   gender-inclusive scope statement in the current master prompt — any
   manuscript text drawn from it must be updated for both.
3. **`SafeHer-System-Inventory.pdf`** — inaccessible, see table above.

## Evidence-sourcing convention used throughout this audit

Every claim in the deliverables that follow is tagged with where it came
from, using these categories (per the governing master prompt's own
evidence register requirement):

- **[CODE]** — directly read from application source in this pass.
- **[SCHEMA]** — directly read from a `supabase/*.sql` migration file.
- **[DOC-2026-09]** — sourced from the existing HTML report above, not
  independently re-verified in this pass.
- **[SESSION]** — verified earlier in this same working session (same
  day, same repository state), via direct code reads, `tsc`/build runs,
  or `expo-doctor` output — not re-run in this specific pass, but not
  stale either (no intervening changes to the relevant files).
- **[UNVERIFIED]** — a claim from prior documentation or planning that
  this pass could not confirm against current code/schema.
- **[GAP]** — something this audit explicitly could not determine and
  flags as needing the team's attention.

Nothing below is marked as tested, passing, or production-verified
unless a concrete command, file, or prior documented test run is cited.

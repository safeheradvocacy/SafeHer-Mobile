# SafeSpace security assessment — RBAC probe

Authorization-testing harness for the SafeSpace security assessment.
Tests whether PostgreSQL Row Level Security and role-based access control
actually hold at runtime, using real authenticated sessions against the live
Supabase API.

## What gets committed

| File | Committed? |
|---|---|
| `rbac-probe.mjs` | Yes — the harness |
| `.test-accounts.env.example` | Yes — empty template |
| `.test-accounts.env` | **No — gitignored. Contains credentials.** |
| `reports/` | **No — gitignored. May contain row IDs.** |

## Setup

### 1. Create disposable test accounts

Create these in the running application — through the mobile signup flow for
survivors, and through Administrator Management for staff roles. Use obviously
fake names (e.g. "Test Survivor A") and an email domain you control.

Minimum useful set, in priority order:

| Priority | Accounts | Boundary tested |
|---|---|---|
| 1 | 2 × survivor | Cross-survivor isolation — the most important test |
| 2 | 2 × barangay_admin, **different barangays** | Jurisdiction boundary |
| 3 | 1 × municipal_admin | Municipal vs province-wide scope |
| 4 | 2 × support_expert | Support conversation isolation |
| 5 | 1 × law_enforcement | Assignment-gated SOS/referral access |
| 6 | 1 × shelter_admin | Shelter-scoped records |

Priorities 1 and 2 alone produce the assessment's most valuable evidence.

### 2. Give the test accounts some data

Cross-tenant probes need each account to own at least one record the others
do not. The simplest safe way: sign in as each test survivor **in the app** and
submit one incident report with clearly synthetic content, e.g.

> `SECURITY ASSESSMENT TEST RECORD — synthetic data, no action required.`

Note the resulting case IDs so you can remove them afterwards. Client roles
cannot delete `case_reports` (there is no DELETE policy — this is by design),
so cleanup requires the Supabase SQL editor.

### 3. Configure

```bash
cd security-assessment
cp .test-accounts.env.example .test-accounts.env
```

Fill in `SUPABASE_ANON_KEY` and one `ACCT_n=role|label|email|password` line per
account. Delete unused template lines.

## Running

```bash
node rbac-probe.mjs                  # read-only (default)
node rbac-probe.mjs --allow-writes   # adds the privilege-escalation probe
```

Read-only mode creates, modifies and deletes nothing.

`--allow-writes` adds exactly one extra probe: a low-privilege account attempts
to set its own `role` to `super_admin`. This is expected to **fail**. If it
succeeds, that is a critical finding, and the harness immediately reverts the
change and reports whether the revert worked.

## Output

Console output gives a per-phase PASS/FAIL breakdown. A full JSON record is
written to `reports/rbac-probe-<timestamp>.json` for the report appendix.

The harness never prints credentials or tokens, and never prints row content —
only HTTP status codes, row counts, and 8-character ID prefixes.

## Reading the results

- **FAIL** — an account read or wrote something its role should not reach.
  Treat as a confirmed finding and investigate the corresponding RLS policy.
- **INCONCLUSIVE** — the probe returned zero rows but the harness could not
  confirm the table actually contains data, so "correctly denied" and "table is
  empty" are indistinguishable. Supply a higher-privilege account, or add test
  data, to resolve.
- **SKIPPED** — not applicable to that role, or deliberately not run because
  executing it would have a real side effect (e.g. creating a production backup).

A clean run is **not** proof the system is secure. It means the probes that ran
found no failures. Coverage is bounded by which accounts were supplied and
which tables hold test data.

## Cleanup

After the assessment: deactivate or delete every test account, remove the
synthetic case records via the SQL editor, and delete `.test-accounts.env`.

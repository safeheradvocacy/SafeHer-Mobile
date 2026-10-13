---
title: ISO/IEC 25010 Questionnaire-to-Feature Traceability Matrix
status: EDITION RESOLVED (2026-10-13) — confirmed as ISO/IEC 25010:2023 (9 characteristics, including Safety) by direct inspection of the team's actual "SAFESPACE SOFTWARE QUALITY EVALUATION QUESTIONNAIRE" (IT Expert form). Traceability content below updated accordingly; a cross-check of that real instrument against audit evidence is included.
date: 2026-10-13 (first pass); edition resolved and Safety section + cross-check added 2026-10-13 (same-day continuation)
---

# ISO/IEC 25010 questionnaire traceability — status and caveats

## Edition — resolved, not assumed

The governing master prompt for this audit was explicit: *"Verify the
ISO/IEC 25010 edition required by ASCOT before finalizing the quality
characteristics. Do not silently assume that a previously proposed model is
the approved one."* At the time this document was first written, no ASCOT
manuscript template, rubric, or adviser guidance was available in this
environment to answer that question, and a repository-wide search for
"25010," "questionnaire," "IT Expert," "End User," and "Likert" found zero
matching files — so the edition was left explicitly unconfirmed, and the
8-characteristic 2011-style list from the master prompt was used only as a
labeled, provisional placeholder.

**That gap is now resolved.** The team shared the actual instrument in use —
*"SAFESPACE SOFTWARE QUALITY EVALUATION QUESTIONNAIRE"* (IT Expert form,
Part I respondent profile, Part II nine lettered sections A–I, Part III
comments/signature). It evaluates **nine** top-level characteristics —
A. Functional Suitability, B. Performance Efficiency, C. Compatibility,
D. Usability, E. Reliability, F. Security, G. Maintainability,
H. Portability, **I. Safety** — which is the structure introduced by the
**2023 revision of ISO/IEC 25010** (the 2011 edition has only the first
eight; Safety is the defining addition of the 2023 revision). This is not
inferred or assumed — it is read directly off the instrument's own section
headings and definitions, including Part II's own sub-characteristic names
(Functional Completeness/Correctness/Appropriateness; Time Behaviour/
Resource Utilization/Capacity; Co-existence/Interoperability; Appropriateness
Recognizability/Learnability/Operability/User Error Protection/UI
Aesthetics/Accessibility; Maturity/Availability/Fault Tolerance/
Recoverability; Confidentiality/Integrity/Non-repudiation/Accountability/
Authenticity; Modularity/Reusability/Analysability/Modifiability/
Testability; Adaptability/Installability/Replaceability; Operational
Constraint/Risk Identification/Fail Safe/Hazard Warning/Safe Integration),
all of which match the 2023 edition's own defined sub-characteristics.

**What this audit still cannot confirm**: whether this specific instrument
has itself been formally approved by the ASCOT adviser/panel, or is still a
working draft on the team's side — that is outside what a codebase audit can
verify, and this document does not assume either way. What it *does* settle,
for the purposes of this traceability matrix, is which characteristic set to
align to: the 9-characteristic, 2023-style model, not the 8-characteristic
placeholder previously used here. The **Safety** section has been added
below (it did not exist in the first pass), and the section headers below
are now lettered A–I to match the real instrument directly.

## Cross-check: does the actual questionnaire match SafeSpace's real functions?

This section directly answers the question the team asked when sharing the
instrument: whether its evaluation statements correspond to real, verified
SafeSpace functionality, or risk asking a respondent to rate something that
doesn't exist or can't honestly be assessed from what this audit has
established. **Short answer: yes, broadly** — every section names real,
implemented SafeSpace functionality, not a hypothetical or nonexistent
feature. The caveats are about *evidence*, not *existence*: several items
cannot be honestly rated from documentation alone and require the evaluator
to actually test the live system, and a few items touch findings this audit
already made that the team should know about before scores are recorded, so
a low score isn't a surprise and a high score isn't accidentally
unsupported.

| # | Section | Verdict | Note |
|---|---|---|---|
| A | Functional Suitability | **Well-matched, well-evidenced.** | Incident reporting, case management, SOS alerts, and shelter requests/referrals are all confirmed implemented in code and wired to real backend tables (`02-*.md` §3–§6). "Functional Appropriateness" (reports supporting decision-making) is backed by confirmed-real, non-placeholder reporting/analytics queries (`02-*.md` §10). |
| B | Performance Efficiency | **Matched, but zero existing evidence.** | Time Behaviour, Resource Utilization, and Capacity all name real system behavior, but this audit found **no** performance/load testing anywhere in the repository or its history. Every rating in this section will have to come from the evaluator's own live testing at evaluation time, not from any existing document — flag this to whoever administers the questionnaire so they budget time for actual measurement rather than impression. |
| C | Compatibility | **Matched, partially evidenced.** | Interoperability between mobile, web, and backend is architecturally real (one shared Supabase project, confirmed `01-*.md`), but "exchanges and processes information correctly" implies behavioral verification this audit could not perform without live access. Co-existence (not interfering with other apps) is a generic, easily directly-observable claim. |
| D | Usability | **Matched, directly testable by the evaluator.** | All six items are observable through hands-on use of a live instance — this is exactly the kind of section a hands-on IT Expert evaluation is for. One heads-up: "User Error Protection" is where this audit found concrete, named gaps (silent write failures in `CaseDetailPage.tsx`'s status/assignment actions, the shared shelter hook, and the admin notifications mark-read — `02-*.md` §5, §6, §9). If the evaluator happens to test those specific flows (e.g., forces a network failure mid-save), they may reasonably score this lower than a pure happy-path click-through would suggest — that would be an accurate finding, not an evaluator error. |
| E | Reliability | **Matched; "Recoverability" needs a careful read.** | Maturity/Availability/Fault Tolerance/error-messaging are directly observable via use. Recoverability is hedged ("where supported"), which is good instrument design — but if interpreted at the system level, this audit found backup/restore is implemented but **never executed** (`02-*.md` §10, `05-*.md` item C3) and point-in-time recovery is confirmed disabled for survivor/case data (`05-*.md` item C4). A "Very Good" rating here should rest on an actual demonstrated restore, not on the code's careful design alone. |
| F | Security | **Matched, strong partial evidence.** | Confidentiality/Integrity map to RLS (extensively documented in code, though never live-tested end-to-end — `05-*.md` item C1). Authenticity maps to Supabase Auth — solid. Non-repudiation/Accountability map to `audit_logs`, but this audit found and the application's **own UI discloses** that the log is not tamper-evident, and coverage (31 known `logAudit()` call sites) was not exhaustively verified against every mutation in the codebase (`02-*.md` §10, `05-*.md` item H6) — an evaluator aware of this would reasonably land on "Good" rather than "Very Good" for these two items specifically, pending the completeness audit this audit could not finish. |
| G | Maintainability | **Matched; "Testability" is the one item most likely to be over-rated without inspection.** | Modularity/Reusability/Analysability/Modifiability are reasonable to assess via code review. **Testability is a real, pointed mismatch risk**: this audit confirmed, repeatedly and exhaustively, **zero automated tests exist anywhere in the repository** (`mobile/`, `admin/`, or `supabase/functions/`) — no unit, integration, or end-to-end test files of any kind. An evaluator who actually checks for a test suite (as the instrument's own directions ask: "actual observations, and available testing... evidence") should find this and score accordingly; an evaluator who doesn't check may default to a generic "Good" based on impression. Worth flagging explicitly to whoever administers the questionnaire. |
| H | Portability | **Matched, one concrete known gap.** | Adaptability (cross-device) was not independently verified by this audit (no device testing performed, consistent with this audit having no physical-device access throughout). Installability is reasonably well-supported (documented Vercel config for `admin/` and EAS config for `mobile/` both exist from earlier work this session). But this audit also found a specific, named reproducibility gap: the `avatars` storage bucket is not created by any SQL migration, so a fresh deployment onto a new Supabase project would be missing it (`01-*.md`, "Storage buckets") — relevant context for an honest "Installability" rating. |
| I | Safety | **Matched — the most SafeSpace-specific section, and the one this audit most wants the team to read carefully before scoring.** | See the new "I. Safety" traceability table below — it includes one specific, high-stakes finding (Risk Identification, re: what the SOS flow does and does not guarantee) and one genuine evidence gap this audit had not previously checked (Hazard Warning, re: confirmation prompts on destructive actions). |

This cross-check does not assign scores — scoring is the evaluator's job, not
a code audit's. It identifies, per section, whether an honest answer can
currently be grounded in existing evidence or requires the evaluator's own
live testing, and names the specific prior findings relevant to each section
so a score isn't given or received as a surprise.

## How to read the matrix below

For each (still-unconfirmed) characteristic, this table lists **candidate**
questionnaire items for two respondent groups — **IT Expert** (a technical
reviewer assessing the system directly) and **End User** (a role-appropriate
staff user or, where feasible and ethical, a non-identifying survivor-side
reviewer) — and maps each candidate item to:

- a **specific, already-verified-or-flagged-unverified feature** from
  `01-deliverable-1-project-structure.md` / `02-deliverable-2-feature-matrix.md`
  (cited by file and section, not re-described from scratch),
- an **evaluation method** (what the respondent would actually need to do —
  use the UI, review a report, attempt a live test),
- the **evidence this audit already has**, versus what is still missing, and
- **limitations** — in particular, flagging every item that can currently
  only be evaluated as "the UI element exists and is reachable," not "the
  underlying behavior is correct," per the master prompt's explicit
  instruction not to infer successful runtime behavior from source code
  alone.

No item below should be read as "validated" — this is a traceability
*mapping*, not a completed survey instrument, and it has not been reviewed or
piloted with any respondent.

## A. Functional Suitability

| Respondent | Candidate item | Verified feature (source) | Evaluation method | Evidence available | Limitations |
|---|---|---|---|---|---|
| IT Expert | "Each role's data access matches its documented jurisdiction (barangay/municipality/province/shelter/assignment)." | `02-*.md` §2 (RBAC/RLS), §5–§7 (case, shelter, police scoping) | Live RLS test per role, per table, with disposable accounts and real JWTs | Policy **text** read directly this pass; only the 2026-09 report's narrower 8-scenario SOS/case-referral run is actual live-test evidence, and per `03-prior-documentation-reconciliation.md` item 5 that run now tests a **superseded** SOS mechanism | Cannot be answered "yes" from source reading alone — this is exactly the gap item 3 in `02-*.md`'s unresolved-questions section describes |
| IT Expert | "An incident report, once submitted, produces a case record with the correct status history." | `02-*.md` §3 | Submit a real test report against a live/staging project, inspect the resulting rows | Code path read and understood; **no execution evidence** | Source-code-only — explicitly flagged as unverified behavior per the governing instruction |
| End User (staff) | "I can find, assign, and update a case through its full lifecycle without needing to guess at an undocumented step." | `02-*.md` §5 | Task-based usability walkthrough (not a test of the schema, a test of the screen) | None — this is a UX judgment that requires a real user, not a code reader | Cannot be estimated from code; must come from an actual respondent |
| End User (shelter admin) | "Shelter requests/referrals addressed to my shelter are clearly distinguished from other shelters' cases." | `02-*.md` §6 | Live use, or a walkthrough with a seeded test account scoped to one shelter | RLS text confirms the *access* boundary; the *clarity* of the distinction is a UX judgment, not something RLS proves | Access-control correctness and UI clarity are two different claims — don't conflate them in the questionnaire wording |

## B. Performance Efficiency

| Respondent | Candidate item | Verified feature (source) | Evaluation method | Evidence available | Limitations |
|---|---|---|---|---|---|
| IT Expert | "The admin reporting/analytics pages load acceptably with a realistic data volume." | `02-*.md` §10 (Reports/Analytics) | Load test or manual timing against a seeded dataset of realistic size | None — this audit confirmed the queries are real (not static/placeholder) but never measured timing, and has no live project to measure against | Pure code reading cannot produce a performance number; this item is unanswerable without an actual environment |
| IT Expert | "The admin app's production bundle size is reasonable for its target users' connectivity." | `03-*.md` item 10 (2026-09 report's §07 recommendation #5, re: chunk-size warnings) | Run `vite build`, inspect the chunk-size warning output | Not re-verified this pass — flagged as a **[GAP]** in `03-*.md` | Requires actually running the build, not reading the report's claim about it |

## C. Compatibility

| Respondent | Candidate item | Verified feature (source) | Evaluation method | Evidence available | Limitations |
|---|---|---|---|---|---|
| IT Expert | "The mobile app behaves correctly across the Android OS versions/screen sizes the target population actually uses." | Not covered in Deliverable 1/2 — out of this audit's scope | Device-matrix manual testing | None in this repository | This audit has no physical-device test evidence of any kind, by design (no device access in this environment, consistent with earlier phases of this project) |
| IT Expert | "Push notifications integrate correctly with the OS notification center once a real device/EAS build exists." | `02-*.md` §9 | Real-device test once an EAS project is configured | None — `02-*.md` §9 explicitly states push is not currently operable end-to-end (no EAS project configured) | Cannot be evaluated at all until the EAS-project prerequisite is resolved — this should be sequenced, not attempted prematurely |

## D. Usability

| Respondent | Candidate item | Verified feature (source) | Evaluation method | Evidence available | Limitations |
|---|---|---|---|---|---|
| End User (survivor-side proxy or staff) | "The SOS flow is clear about what it does and does not do (e.g., it does not call police directly)." | `02-*.md` §4, "Known limitations" row | Task-based usability test with think-aloud | Code confirms no call/SMS integration exists; whether the **UI communicates this honestly to a real user** is untested | The manuscript must not claim SOS "calls police" per `02-*.md` §4 — the questionnaire item should test comprehension, not just satisfaction |
| End User (all staff roles) | "I always know which action buttons I'm allowed to use before I click them." | `02-*.md` §5, "Required permissions" row (buttons are not hidden by ownership tier; RLS is the real gate, discovered only on write) | Usability walkthrough across at least two roles with different case-ownership scopes | This audit found the *code reason* this could be a problem (buttons aren't conditionally hidden) but has no user-reaction evidence | A real respondent may report this as confusing or may not notice it at all — don't presume the answer from the code finding |
| End User (shelter admin) | "I can tell whether my last status update/occupancy change actually saved." | `02-*.md` §6, "Validation / error handling" row (shared hook never checks `{ error }`, reports success regardless) | Deliberately induce a failure (e.g., revoke network mid-save) during a usability session | Code-level gap confirmed; user-facing consequence not yet observed | This is a case where the *code finding* strongly predicts a *usability* problem, but the questionnaire should still verify it happens, not assume it |

## E. Reliability

| Respondent | Candidate item | Verified feature (source) | Evaluation method | Evidence available | Limitations |
|---|---|---|---|---|---|
| IT Expert | "A failed write (network loss, RLS denial) is surfaced to the user rather than silently appearing to succeed." | `02-*.md` §5 (`submitStatusChange`/`submitAssignment`), §6 (shared shelter hook), §9 (admin mark-read) | Deliberate failure injection, observed directly | Multiple specific **[CODE]**-confirmed gaps already identified — this characteristic has unusually strong existing evidence compared to others in this table | Still code-level findings, not yet reproduced live; listing the exact file/function for each makes this the easiest item to actually test |
| IT Expert | "The system has a working backup/recovery path for case and survivor data." | `02-*.md` §10, "Known limitations" row | Review of backup scope + PITR status | PITR confirmed disabled via code comment; custom backup confirmed to exclude survivor/case data entirely | This item should score as a **known, documented limitation**, not be treated as a pass/fail surprise — the manuscript already has the honest answer |
| IT Expert | "A backup can actually be restored successfully." | `02-*.md` §10 | A real, supervised backup→restore execution against a staging copy | **None** — explicitly flagged as "Not verified (insufficient evidence)" in `02-*.md` §10 | Do not let a respondent "assume yes" from the code's careful design — the questionnaire should ask whether this was *demonstrated*, not whether the code *looks* careful |

## F. Security

| Respondent | Candidate item | Verified feature (source) | Evaluation method | Evidence available | Limitations |
|---|---|---|---|---|---|
| IT Expert | "Row-level security, not the UI, is the actual access-control boundary, and this holds under direct API calls." | `02-*.md` §2 | Direct REST calls bypassing the UI, with real JWTs per role | Policy text read; **[DOC-2026-09]** historical test exists for one slice only, and per `03-*.md` the SOS slice of it is now stale | Same gap as item 3 in `02-*.md`'s unresolved-questions — this is the highest-value missing evidence for the whole manuscript's security chapter |
| IT Expert | "The AI provider key and other secrets are never exposed client-side." | `02-*.md` §8 | Direct inspection of client bundle / Edge Function source (already done) | **[CODE]** — confirmed this pass: `AI_API_KEY` is read only server-side in the Edge Function, never returned to the client | This one item has strong, direct evidence already — a rare case where "yes" is well-supported, not just assumed |
| IT Expert | "Audit logging is complete for every security-relevant action." | `02-*.md` §10, "Known limitations" row | A full line-by-line mutation-vs-`logAudit()`-call-site audit | Partial — 31 call sites catalogued, but explicitly **not** exhaustively verified against every mutation in the codebase | Must not be scored as "complete" — the audit itself says this is unverified, not confirmed-complete |

## G. Maintainability

| Respondent | Candidate item | Verified feature (source) | Evaluation method | Evidence available | Limitations |
|---|---|---|---|---|---|
| IT Expert | "Retired roles/features are cleanly removed rather than left as dead code." | `02-*.md` §6, "Known limitations" (retired `shelter_staff` role, intentionally kept per its own migration's header comment) | Code review | **[SCHEMA]** confirmed this is a deliberate, documented decision, not oversight | A questionnaire item here should ask whether the team finds this an acceptable tradeoff, not whether dead code "exists" — it exists on purpose |
| IT Expert | "Error-handling patterns are consistent across similar features." | `02-*.md` §5–§9 (inconsistent try/catch and toast coverage noted in nearly every section) | Code review across the 10 features in Deliverable 2 | Strong **[CODE]** evidence of inconsistency, catalogued per-feature | This is one of the best-evidenced maintainability findings in the whole audit — safe to cite directly |

## H. Portability

| Respondent | Candidate item | Verified feature (source) | Evaluation method | Evidence available | Limitations |
|---|---|---|---|---|---|
| IT Expert | "A fresh deployment of this repository onto a new Supabase project would reproduce the current production environment." | `01-deliverable-1-project-structure.md`, "Storage buckets" (resolved `avatars`-bucket gap) | Attempt an actual fresh deployment | **[CODE + SCHEMA]** confirmed the `avatars` bucket is dashboard-only and would be missing on a fresh deploy; this is a real, specific, named reproducibility gap | This is a concrete, already-actionable finding — not a vague portability concern |

## I. Safety

Added in this continuation pass — this characteristic did not exist in the
8-characteristic placeholder list used in the first pass, and is the
defining addition of the ISO/IEC 25010:2023 edition that the real
instrument uses. It is also the most directly tied to SafeSpace's actual
purpose (supporting people in abuse-related emergencies), so the items below
lean toward flagging what the team should know **before** an evaluator
scores this section, not just what's convenient to cite.

| Respondent | Candidate item | Verified feature (source) | Evaluation method | Evidence available | Limitations |
|---|---|---|---|---|---|
| IT Expert | "SafeSpace communicates, somewhere a survivor will actually see it, what the SOS feature does and does not guarantee." | `02-*.md` §4, "Known limitations" row | Direct inspection of the SOS confirm/countdown screen's copy, plus a usability check of whether a real user comes away with an accurate understanding | **[CODE]** confirmed: no SMS, phone call, or guaranteed human-dispatch integration exists anywhere in the SOS creation path — it creates a database row and relies on an admin's realtime dashboard view plus best-effort push (itself not currently operable end-to-end, `02-*.md` §9). Whether the **in-app copy itself** discloses this to the survivor was not specifically checked in this pass. | This is the single highest-stakes item in the entire questionnaire given SafeSpace's purpose — a "Very Good" rating should require someone to have actually read the SOS screen's copy with this question in mind, not assume it based on the feature existing. Flagged here explicitly so the team checks it before, not after, scoring. |
| IT Expert | "Destructive or consequential administrative actions (deleting a user, a shelter, a backup, etc.) require an explicit confirmation step." | Not yet checked by any pass of this audit | Direct code/UI review of delete-type actions across `admin/src/pages` | **None — this is a genuine gap in this audit itself**, not just in SafeSpace. Earlier passes focused on RLS, workflows, and error handling, but never specifically inventoried confirmation dialogs on destructive actions. | Do not assume either a pass or a fail here — this needs a dedicated check before the questionnaire is administered; see the new register item added for this in `05-unresolved-evidence-and-testing-register.md`. |
| IT Expert | "When an action fails, SafeSpace does not leave the user believing it succeeded." | `02-*.md` §4 (SOS/incident-report hardening, done earlier this session) vs. §5/§6/§9 (several admin write paths that still silently report success) | Deliberate failure injection across both a hardened flow (SOS) and an unhardened one (e.g. shelter status update) | **[SESSION]** for the hardened mobile flows; **[CODE]**-confirmed gap for the unhardened admin flows | This is **uneven across the system**, not uniformly good or bad — the questionnaire's single "Fail Safe" item may get a different honest answer depending on which specific flow the evaluator happens to test, which is worth noting in the evaluator's comments section rather than averaging away |
| IT Expert | "The AI assistant's safety layer cannot be downgraded or bypassed by the AI model itself." | `02-*.md` §8 | Code review of `safeher-chatbot`'s layering (rule-based check always runs first; AI's own risk assessment can only escalate, never downgrade, the rule engine's result) | **[CODE]** — directly confirmed, one of the more strongly-evidenced findings in the whole audit | A genuinely well-supported "Very Good" candidate for "Safe Integration," unlike most other items in this table |

## What this document does not do

- It does not claim to be the final questionnaire — it is a traceability
  **scaffold** for whoever drafts the actual IT Expert and End User
  instruments, so that every question they write can point at a specific,
  already-gathered piece of evidence (or an explicit gap) instead of being
  invented fresh.
- It does not confirm that the real instrument shown to this audit has been
  formally approved by the ASCOT adviser/panel — only that it is the
  instrument the team is actually using, which is sufficient to align this
  traceability matrix's characteristic set, but not the same thing as
  institutional approval.
- It does not convert any "Known limitations" entry into a pass/fail
  judgment — ISO/IEC 25010 evaluation is the team's and the respondents' job,
  not something this read-only code audit can perform on their behalf.
- It does not cross-check the End User questionnaire (if one exists
  separately from the IT Expert form shown to this audit) — only the IT
  Expert form has been reviewed so far. If an End User version exists with
  different wording, it should be shared for the same cross-check.

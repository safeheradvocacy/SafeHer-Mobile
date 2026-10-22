# SafeSpace — Backup encryption key procedure and recovery drill

Audience: the technical Super Admin (`provincial_admin` / `super_admin`) who
owns Backup & Restore for the SafeSpace production project.

Everything in this document is a procedure to be *executed by a person*. Nothing
here runs automatically, and nothing here should be assumed done because the
document exists.

---

## Part 1 — The archive encryption key

### Why this matters more than it looks

Every archive SafeSpace produces contains abuse case records, survivor
identities, chat transcripts, and (when storage objects are included) evidence
photographs and identity documents. Archives are therefore **always** encrypted
with AES-256-GCM. The backup function refuses to run without a usable key — it
will not fall back to writing a plaintext archive.

The key is **not** in the database, **not** in any archive, and **not** in the
repository. It exists in exactly one place by default: the
`BACKUP_ENCRYPTION_KEY` Edge Function secret.

That single-location default is the dangerous part. If the Supabase project is
lost — the scenario backups exist for — and the key lived only inside it, then
every archive becomes permanently undecryptable. **The backups would be lost
along with the thing they were protecting.** Escrow is not optional paperwork;
it is the difference between a backup and a souvenir.

### 1.1 Generate the key

```bash
openssl rand -base64 32
```

This must produce base64 that decodes to exactly 32 bytes. The function
validates this and rejects anything else — wrong length, non-base64, or 32 zero
bytes are all refused with a specific reason.

Do **not** use a passphrase, a password-manager-generated "strong password", or
a hash of something memorable. It must be 32 random bytes.

### 1.2 Set it on the project

```bash
npx supabase secrets set BACKUP_ENCRYPTION_KEY='<the base64 value>' \
  --project-ref <project-ref>
```

Use single quotes. A trailing newline is tolerated (the function trims), but
shell interpolation of `$` or `/` characters is not — quoting avoids it.

Verify it registered (this prints names and digests, never values):

```bash
npx supabase secrets list --project-ref <project-ref>
```

### 1.3 Escrow it — required

Store a copy **outside Supabase**, held by at least two people, so that losing
one person or one system does not lose the key:

1. The organisation's password manager, in a vault the PSWDO technical
   administrators control.
2. A sealed offline copy (printed or on removable media) in the PSWDO safe.

Record alongside each copy: the date set, who set it, and the project ref it
belongs to. Do **not** record the key in this repository, in a ticket, in chat,
in email, or in the Supabase SQL editor's history.

### 1.4 Verify the escrowed copy actually works

An escrowed key nobody has tested is a guess. Test the *escrowed copy*, not the
one you still have in your shell:

1. Create a backup from the admin portal and download it.
2. Open a new terminal. Do not reuse the one where you generated the key.
3. Retrieve the key from escrow by hand (read it off the sealed copy / password
   manager).
4. Decrypt the downloaded archive with the script in Part 2.3 using that value.
5. Confirm the archive unzips and `manifest.json` is readable.

Record the date of this test. Repeat it whenever the key is rotated and at least
once per year.

### 1.5 Rotation

Rotating the key does **not** re-encrypt existing archives — they remain
readable only with the key they were created under. So:

1. Keep the **old** key in escrow, clearly labelled with the date range it
   covers, for as long as any archive encrypted under it is retained.
2. Set the new key.
3. Create and validate a fresh backup under the new key.
4. Re-run 1.4 against the new key.

Never delete an old key while an archive encrypted with it still exists.

---

## Part 2 — Recovery drills

The prompt that drives this work insists on a distinction this document keeps
throughout. A component is in exactly one of these states, and they are not
interchangeable:

| State | Meaning |
|---|---|
| **Inventory-only** | Listed in the archive; cannot be restored by this system. |
| **Archive-validated** | Bytes verified, checksums match, contents readable. |
| **Restored in staging** | Actually written into a disposable project and verified. |
| **Verified in production** | Actually recovered in production. |

A passing checksum is **archive-validated**. It is not a restore.

### 2.1 Drill A — isolated archive drill (automated, no project needed)

This one is runnable right now and requires no Supabase project, no credentials,
and no network:

```bash
npx --yes deno@2.1.4 run --allow-env --allow-read \
  supabase/functions/_shared/recoveryDrill.ts
```

It builds a representative encrypted archive from a stubbed data source using
the **real** `buildArchive`, then validates it with the **real** validator, and
asserts:

* the build refuses to run with a missing/malformed key
* multi-page table reads capture every row
* secret-bearing tables are excluded and do not count against completeness
* an unreadable object makes the archive *partial*, not "complete"
* an unlistable prefix is reported rather than silently dropped
* a flipped byte is rejected before decryption is attempted
* altered ciphertext with a *matching* checksum is still rejected by the GCM tag
* a wrong key is rejected
* table rows round-trip exactly
* storage objects round-trip, checksum-verified, with nested paths and
  duplicate basenames preserved
* `skip` conflict policy does not clobber an existing object; `overwrite` does
* a missing target bucket is reported and never created

**What it does not prove:** anything about a real project — no RLS, no grants,
no triggers, no auth, no production data.

### 2.2 Drill B — staging restore drill (manual, needs a disposable project)

This is the drill that upgrades components from *archive-validated* to
*restored in staging*. It **cannot** be run against production, and SafeSpace
currently has only one project, so a disposable one must be created first.

> Creating a project has a cost and creates real infrastructure. Get explicit
> approval before doing it.

**Setup**

1. Create a disposable project in the same region (`ap-southeast-1`).
2. Apply the schema in order: `00_schema.sql`, then `module1` … `module43`.
   Respect every file's Part A / Part B split — run Part A alone, let it commit,
   then Part B. Modules 3, 4, 6, 7, 9, 10, 11, 16, 23 and 42 all have one.
3. Create the storage buckets with the **same ids and the same `public`
   flags** as production: `evidence`, `identity-documents`, `avatars`,
   `shelter-photos` (public), `system-backups`. Restore never creates buckets,
   deliberately — it must not author the privacy of an evidence bucket.
4. Set `BACKUP_ENCRYPTION_KEY` on the staging project to the **same** key the
   archive was encrypted with (from escrow), plus `SUPABASE_*` which the
   platform injects.
5. Deploy `backup-auth`, `backup-create`, `backup-restore`.
6. Provision a dedicated backup password through the staging admin portal.

**Execute**

7. Upload the production archive into staging's `system-backups` bucket and
   insert its `system_backups` catalog row (`archive_format = 'zip'`,
   `checksum_sha256`, `schema_version`, `project_ref`, `storage_object_count`).
8. Run **Validate** from the admin portal. Record every check.
9. Run **Restore**. Work through the whole wizard: plan preview, typed
   confirmation phrase, dedicated password at *both* `restore_begin` and
   `restore_execute`.
10. Choose the storage conflict policy deliberately and record which.

**Verify — and record the actual result for each, not "looks fine"**

11. Row counts per table vs the archive manifest.
12. Foreign-key integrity: no orphans in `case_reports`, `case_services`,
    `case_referrals`, `shelter_referrals`, `law_enforcement_referrals`.
13. `select count(*) from pg_policies where schemaname = 'public'` and spot-check
    that RLS is still enabled on the sensitive tables.
14. Triggers and functions present (`pg_trigger`, `pg_proc`).
15. Storage object count and byte-level checksums vs `storage/_manifest.json`.
16. **Auth reconciliation.** Expect this to need manual work — password hashes,
    MFA factors and identities are not exportable. Follow
    `authentication/RESTORATION-INSTRUCTIONS.md` inside the archive. Restored
    `user_profiles` rows whose `auth_user_id` has no matching auth user are
    orphans and cannot sign in.
17. **Jurisdiction isolation.** Sign in as a `barangay_admin` and a
    `municipal_admin` and confirm each sees only their own scope. This is the
    check that catches a restore that technically succeeded but broke access
    control.
18. Critical workflows: login, case list, case detail, incident report, SOS
    visibility for `law_enforcement`.
19. Confirm private buckets are still private — fetch an `evidence` object
    without a signed URL and expect a refusal.

**Afterwards**

20. Confirm production was untouched: no new rows in production
    `system_restores`, and production `system_backups` unchanged apart from
    backups you deliberately created.
21. Write the result into the table in Part 2.3 — including the failures.
22. Delete the disposable project.

### 2.3 Decrypting an archive by hand

For escrow verification, and for the case where the admin portal itself is
unavailable. Save as `decrypt-archive.mjs` and run with Node 18+:

```js
import { readFileSync, writeFileSync } from 'node:fs';
const [, , inFile, outFile] = process.argv;
const keyB64 = process.env.BACKUP_ENCRYPTION_KEY;
if (!inFile || !outFile || !keyB64) {
  console.error('usage: BACKUP_ENCRYPTION_KEY=<base64> node decrypt-archive.mjs <in.zip.enc> <out.zip>');
  process.exit(1);
}
const stored = new Uint8Array(readFileSync(inFile));
// Layout: magic "SSBKENC1" (8) | version (1) | iv (12) | ciphertext+tag
const magic = new TextDecoder().decode(stored.slice(0, 8));
if (magic !== 'SSBKENC1') { console.error(`not an encrypted SafeSpace archive (magic: ${magic})`); process.exit(1); }
if (stored[8] !== 1) { console.error(`unsupported version ${stored[8]}`); process.exit(1); }
const rawKey = Buffer.from(keyB64.trim(), 'base64');
if (rawKey.length !== 32) { console.error(`key must decode to 32 bytes, got ${rawKey.length}`); process.exit(1); }
const key = await crypto.subtle.importKey('raw', rawKey, { name: 'AES-GCM' }, false, ['decrypt']);
try {
  const pt = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: stored.slice(9, 21) }, key, stored.slice(21)
  );
  writeFileSync(outFile, Buffer.from(pt));
  console.log(`decrypted -> ${outFile}`);
} catch {
  console.error('authentication failed: wrong key, or the archive has been altered. Contents NOT written.');
  process.exit(1);
}
```

Then verify the contents against the archive's own checksum list:

```bash
unzip -o out.zip -d extracted && cd extracted && sha256sum -c checksums.sha256
```

### 2.4 Drill record

Fill this in when a drill is actually run. An empty row means not tested — not
"fine".

| Date | Drill | Archive ID | Executed by | Result | Failures / notes |
|---|---|---|---|---|---|
| 2026-10-23 | A — isolated archive | synthetic `drill-0001` | automated | **47/47 passed** | Archive-validated only. No project involved. |
| | B — staging restore | | | **not yet run** | Requires a disposable project; none exists. |

---

## Part 3 — Known limitations

These are properties of the platform and of deliberate design choices, not
outstanding bugs:

* **Supabase Auth is inventory-only.** Password hashes, MFA factors, linked
  identities and sessions cannot be exported through the supported Admin API.
  Restoring `user_profiles` does not restore the ability to sign in.
* **Edge Function source and migration `.sql` files are not in the archive.** A
  function cannot read another function's deployment, and migrations are
  repository artifacts. Recover both from version control. The database's
  *actual current schema* is captured, which is what you compare against.
* **Schema is exported but never auto-executed.** Recreating 40+ interdependent
  modules in the right order, with the right extensions and ownership, is an
  operator procedure. The archive gives you the reference material.
* **Restore is upsert-only.** Nothing is deleted or truncated, so rows created
  after the backup survive. A restore can add back or revert; it cannot make a
  table exactly match the archive.
* **`user_profiles`, `audit_logs` and `terms_acceptances` are never restored.**
  Reverting roles could reinstate revoked access; rewriting the audit log would
  erase the record of the incident being recovered from; re-asserting an old
  consent snapshot could claim consent since withdrawn.
* **No platform PITR.** Verified `pitr_enabled: false` on this project. There is
  no database-level point-in-time recovery to fall back on.
* **Size budget.** Archives are built inside an Edge Function with a byte budget
  (`BACKUP_SIZE_BUDGET_MB`, default 64). When a table or object would exceed it,
  it is excluded **whole** and named in the coverage report — never truncated.
  At real evidence volumes this requires raising the budget or moving archive
  assembly to a dedicated worker.

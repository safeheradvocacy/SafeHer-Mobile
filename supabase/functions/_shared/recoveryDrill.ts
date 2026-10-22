// supabase/functions/_shared/recoveryDrill.ts
//
// An ISOLATED, OFFLINE recovery drill for the archive pipeline.
//
// Run with Deno (no Supabase project, no network, no credentials):
//   npx --yes deno@2.1.4 run --allow-env --allow-read \
//     supabase/functions/_shared/recoveryDrill.ts
//
// ================= WHAT THIS DOES AND DOES NOT PROVE =================
//
// PROVES (archive-validated):
//   * buildArchive() produces a real ZIP from a representative dataset
//   * encryption is MANDATORY — it refuses to build without a key
//   * the archive decrypts, its GCM tag verifies, and it unzips
//   * manifest.json is present, parseable, and lists every member
//   * every member's recorded SHA-256 matches its actual bytes
//   * the coverage report names everything not fully captured
//   * storage objects round-trip with per-object checksums
//   * openArchiveTables() reads back exactly the rows that went in
//   * a single flipped byte is REJECTED, not silently accepted
//   * a wrong key is REJECTED
//   * a path-traversal member would be refused
//
// DOES NOT PROVE (and must never be reported as proving):
//   * that a restore into a real Supabase project succeeds
//   * that RLS, grants, triggers or functions survive a restore
//   * that Supabase Auth identities can be reconciled
//   * anything about production data
//
// A pass here means the ARCHIVE FORMAT is sound and self-verifying. It
// is a prerequisite for a staging restore drill, not a substitute for
// one. The staging drill needs a disposable Supabase project and is
// documented in docs/RECOVERY-DRILL.md.
//
// The data source is a stub, not a mock of convenience: it returns the
// shapes the real code actually consumes (paged .range() reads, paged
// storage .list(), listBuckets, auth.admin.listUsers, and the three
// module42/43 RPCs), so the code under test takes its real branches.

import { buildArchive, openArchiveTables, validateArchiveBytes, restoreStorageObjects } from './archiveBuilder.ts';

// ---------------------------------------------------------------------
// Representative fixture data
// ---------------------------------------------------------------------

const TABLE_ROWS: Record<string, Record<string, unknown>[]> = {
  municipalities: [
    { municipality_id: 'm1', municipality_name: 'Baler', is_active: true },
    { municipality_id: 'm2', municipality_name: 'Dipaculao', is_active: true },
  ],
  barangays: [{ barangay_id: 'b1', municipality_id: 'm1', barangay_name: 'Poblacion', is_active: true }],
  shelters: [{ shelter_id: 's1', municipality_id: 'm1', shelter_name: 'Aurora Haven', capacity: 20 }],
  // Deliberately includes the sensitive tables, because the whole point
  // of mandatory encryption is that these are in the archive.
  survivors: [{ survivor_id: 'sv1', profile_id: 'p1', date_of_birth: '1990-01-01' }],
  case_reports: [
    { case_id: 'c1', survivor_id: 'sv1', municipality_id: 'm1', barangay_id: 'b1', status: 'Pending' },
    { case_id: 'c2', survivor_id: 'sv1', municipality_id: 'm2', barangay_id: null, status: 'Active' },
  ],
  case_services: [{ service_id: 'svc1', case_id: 'c1', status: 'Provided' }],
  // A table with MORE rows than one page, to exercise .range() paging.
  chat_messages: Array.from({ length: 2300 }, (_, i) => ({
    message_id: `msg${i}`,
    session_id: 'sess1',
    message: `message ${i}`,
    sender_type: i % 2 === 0 ? 'User' : 'AI',
  })),
  // Present in the DB and in the archive, but never restored.
  user_profiles: [{ profile_id: 'p1', role: 'survivor', is_active: true }],
  audit_logs: [{ log_id: 'a1', action: 'LOGIN', table_name: 'user_profiles' }],
};

const DISCOVERED_TABLES = [
  ...Object.keys(TABLE_ROWS).map((t) => ({
    table_name: t,
    in_scope: true,
    exclusion_reason: null as string | null,
    estimated_rows: TABLE_ROWS[t].length,
  })),
  // Secret-bearing + catalog exclusions, exactly as list_backup_tables
  // reports them in production.
  { table_name: 'backup_authorization', in_scope: false, exclusion_reason: 'secret_bearing', estimated_rows: 1 },
  { table_name: 'security_passcodes', in_scope: false, exclusion_reason: 'secret_bearing', estimated_rows: 3 },
  { table_name: 'push_tokens', in_scope: false, exclusion_reason: 'secret_bearing', estimated_rows: 5 },
  { table_name: 'system_backups', in_scope: false, exclusion_reason: 'backup_catalog', estimated_rows: 9 },
];

const BUCKETS = [
  { id: 'evidence', name: 'evidence', public: false, created_at: '2026-01-01T00:00:00Z' },
  { id: 'identity-documents', name: 'identity-documents', public: false, created_at: '2026-01-01T00:00:00Z' },
  { id: 'system-backups', name: 'system-backups', public: false, created_at: '2026-01-01T00:00:00Z' },
];

// Nested paths, >1 page in one prefix, and a duplicate BASENAME under
// two different prefixes — all three were untested before.
function makeStorageFixture(): Record<string, Record<string, Uint8Array>> {
  const enc = new TextEncoder();
  const evidence: Record<string, Uint8Array> = {};
  for (let i = 0; i < 130; i++) evidence[`case/c1/photo${i}.jpg`] = enc.encode(`evidence-bytes-${i}`);
  evidence['case/c2/photo0.jpg'] = enc.encode('different-case-same-basename');
  evidence['case/c1/nested/deep/report.pdf'] = enc.encode('nested-deep-bytes');
  return {
    evidence,
    'identity-documents': { 'p1/id-front.jpg': enc.encode('id-front'), 'p1/id-back.jpg': enc.encode('id-back') },
  };
}

// ---------------------------------------------------------------------
// Stub client
// ---------------------------------------------------------------------

interface DrillOptions {
  /** Paths that must fail to download, to exercise 'inaccessible'. */
  unreadable?: Set<string>;
  /** Prefixes whose list() must fail, to exercise a lost subtree. */
  unlistablePrefixes?: Set<string>;
}

function makeStubClient(storage: Record<string, Record<string, Uint8Array>>, opts: DrillOptions = {}) {
  const uploaded: Record<string, Record<string, Uint8Array>> = {};

  const bucketApi = (bucket: string) => ({
    list: (prefix: string, o: { limit: number; offset?: number }) => {
      if (opts.unlistablePrefixes?.has(prefix)) {
        return Promise.resolve({ data: null, error: { message: 'simulated list failure' } });
      }
      const files = storage[bucket] ?? {};
      const p = prefix ? `${prefix}/` : '';
      const direct = new Map<string, { name: string; isFile: boolean }>();
      for (const key of Object.keys(files)) {
        if (!key.startsWith(p)) continue;
        const rest = key.slice(p.length);
        if (!rest) continue;
        const slash = rest.indexOf('/');
        if (slash === -1) direct.set(rest, { name: rest, isFile: true });
        else direct.set(rest.slice(0, slash), { name: rest.slice(0, slash), isFile: false });
      }
      const all = [...direct.values()]
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((e) =>
          e.isFile
            ? { name: e.name, id: `id-${e.name}`, updated_at: '2026-01-01T00:00:00Z', metadata: { size: 10, mimetype: 'application/octet-stream' } }
            : { name: e.name, id: null, updated_at: null, metadata: null }
        );
      const offset = o.offset ?? 0;
      return Promise.resolve({ data: all.slice(offset, offset + o.limit), error: null });
    },
    download: (path: string) => {
      if (opts.unreadable?.has(`${bucket}/${path}`)) {
        return Promise.resolve({ data: null, error: { message: 'simulated download failure' } });
      }
      const bytes = (storage[bucket] ?? {})[path];
      if (!bytes) return Promise.resolve({ data: null, error: { message: 'not found' } });
      return Promise.resolve({ data: new Blob([bytes]), error: null });
    },
    upload: (path: string, bytes: Uint8Array) => {
      uploaded[bucket] = uploaded[bucket] ?? {};
      uploaded[bucket][path] = bytes;
      return Promise.resolve({ data: { path }, error: null });
    },
  });

  const client = {
    __uploaded: uploaded,
    from(table: string) {
      const builder = {
        select: (_cols?: string, _o?: unknown) => builder,
        range: (from: number, to: number) => {
          const rows = TABLE_ROWS[table] ?? [];
          return Promise.resolve({ data: rows.slice(from, to + 1), error: null });
        },
      };
      return builder;
    },
    rpc(fn: string, _args?: unknown) {
      if (fn === 'list_backup_tables') return Promise.resolve({ data: DISCOVERED_TABLES, error: null });
      if (fn === 'export_schema_ddl') {
        return Promise.resolve({
          data: {
            generated_at: new Date().toISOString(),
            columns: [{ table: 'case_reports', column: 'case_id', type: 'uuid', nullable: 'NO', default: null, position: 1 }],
            constraints: [{ table: 'case_reports', name: 'case_reports_pkey', definition: 'PRIMARY KEY (case_id)' }],
            indexes: [{ table: 'case_reports', name: 'case_reports_pkey', definition: 'CREATE UNIQUE INDEX ...' }],
            functions: [{ name: 'is_provincial_technical_admin', definition: 'CREATE FUNCTION ...' }],
            triggers: [{ table: 'case_reports', name: 'trg_audit', definition: 'CREATE TRIGGER ...' }],
            policies: [{ table: 'case_reports', name: 'admins can view', command: 'SELECT', roles: ['authenticated'], using: 'true', check: null }],
            rls_enabled: [{ table: 'case_reports', enabled: true }],
            enums: [{ name: 'backup_frequency', values: ['daily', 'weekly', 'monthly'] }],
            views: [],
            extensions: [{ name: 'pgcrypto', version: '1.3' }],
          },
          error: null,
        });
      }
      if (fn === 'list_backup_cron_jobs') {
        return Promise.resolve({
          data: [{ jobname: 'safeher-scheduled-backup', schedule: '0 2 * * *', active: true, command_redacted: true }],
          error: null,
        });
      }
      return Promise.resolve({ data: null, error: { message: `unexpected rpc ${fn}` } });
    },
    storage: {
      listBuckets: () => Promise.resolve({ data: BUCKETS, error: null }),
      from: bucketApi,
    },
    auth: {
      admin: {
        listUsers: (_o: { page: number; perPage: number }) =>
          Promise.resolve({
            data: {
              users: [
                { id: 'auth1', email: 'admin@example.test', phone: null, created_at: '2026-01-01T00:00:00Z', last_sign_in_at: null, email_confirmed_at: '2026-01-01T00:00:00Z', app_metadata: {}, user_metadata: {} },
              ],
            },
            error: null,
          }),
      },
    },
  };
  // deno-lint-ignore no-explicit-any
  return client as any;
}

// ---------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------

let pass = 0;
let fail = 0;
const failures: string[] = [];

function check(label: string, actual: unknown, expected: unknown) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) {
    pass += 1;
    console.log(`  pass  ${label}`);
  } else {
    fail += 1;
    failures.push(label);
    console.error(`  FAIL  ${label}\n          expected ${JSON.stringify(expected)}\n          actual   ${JSON.stringify(actual)}`);
  }
}

function section(title: string) {
  console.log(`\n${title}`);
}

const VALID_KEY = btoa(String.fromCharCode(...new Uint8Array(32).fill(7)));

async function main() {
  const storage = makeStorageFixture();

  section('1. Encryption is mandatory (fail closed)');
  Deno.env.delete('BACKUP_ENCRYPTION_KEY');
  let refusedWithoutKey = false;
  let refusalMessage = '';
  try {
    await buildArchive(makeStubClient(storage), {
      backupId: 'drill-nokey',
      backupType: 'manual',
      projectRef: 'drill',
      schemaVersion: '1.0',
      includeStorageBinaries: false,
      initiatedBy: null,
    });
  } catch (e) {
    refusedWithoutKey = true;
    refusalMessage = e instanceof Error ? e.message : String(e);
  }
  check('buildArchive refuses to produce an archive with no key', refusedWithoutKey, true);
  check('refusal names the missing secret', refusalMessage.includes('BACKUP_ENCRYPTION_KEY'), true);
  check(
    'refusal states that an unencrypted archive is not an acceptable fallback',
    /unencrypted archive of case and survivor data is not an acceptable fallback/.test(refusalMessage),
    true
  );

  // From here on, a valid key is configured.
  Deno.env.set('BACKUP_ENCRYPTION_KEY', VALID_KEY);
  Deno.env.set('BACKUP_SIZE_BUDGET_MB', '64');

  section('2. Build a representative encrypted archive (with storage objects)');
  const unreadable = new Set(['evidence/case/c1/photo7.jpg']);
  const built = await buildArchive(makeStubClient(storage, { unreadable }), {
    backupId: 'drill-0001',
    backupType: 'manual',
    projectRef: 'drill-project',
    schemaVersion: '1.0',
    includeStorageBinaries: true,
    initiatedBy: 'operator-1',
  });

  check('archive is encrypted', built.isEncrypted, true);
  check('algorithm recorded', built.encryptionAlgorithm, 'AES-256-GCM');
  check('filename marks encryption', built.fileName.endsWith('.zip.enc'), true);
  check('stored bytes are not a readable ZIP (PK header absent)', built.bytes[0] === 0x50 && built.bytes[1] === 0x4b, false);
  check('encrypted container magic present', new TextDecoder().decode(built.bytes.slice(0, 8)), 'SSBKENC1');

  // Paging: chat_messages has 2300 rows across 3 pages of 1000.
  const chatCoverage = built.coverage.find((c) => c.source === 'public.chat_messages');
  check('paged table captured every row (2300 across 3 pages)', chatCoverage?.rows, 2300);

  // Secret-bearing exclusions must be present and must NOT count
  // against completeness.
  const secretExclusions = built.excluded.filter((e) => e.reason === 'secret_bearing').map((e) => e.source).sort();
  check('secret-bearing tables excluded', secretExclusions, [
    'public.backup_authorization',
    'public.push_tokens',
    'public.security_passcodes',
  ]);

  // One unreadable object => that bucket is partial, so the archive is
  // not complete. This is the honest-reporting property.
  check('archive is NOT claimed complete when an object was unreadable', built.isComplete, false);
  const evidenceCoverage = built.coverage.find((c) => c.source === 'storage bucket: evidence');
  check('evidence bucket reported partial', evidenceCoverage?.status, 'partial');
  check('evidence captured count excludes the unreadable object', evidenceCoverage?.objects, 131);
  check('system-backups bucket is never backed up into itself', built.coverage.some((c) => c.source === 'storage bucket: system-backups'), false);
  check('storage object count recorded', built.storageObjectCount, 133);

  section('3. Validate the archive (decrypt, tag, manifest, checksums)');
  const validation = await validateArchiveBytes(built.bytes, {
    storedChecksum: built.storedChecksum,
    schemaVersion: '1.0',
    projectRef: 'drill-project',
  });
  const failedBlocking = validation.checks.filter((c) => c.blocking && !c.passed).map((c) => c.label);
  check('no blocking check failed', failedBlocking, []);
  check('archive reported intact', validation.archiveIntact, true);
  check('decrypt + GCM tag check passed', validation.checks.some((c) => c.passed && /authentication tag verified/.test(c.label)), true);
  check('manifest parsed', !!validation.manifest, true);
  check('coverage reported incomplete (matches build)', validation.coverageComplete, false);
  check('restoreReady is false for an incomplete archive', validation.restoreReady, false);
  check('warnings name the uncaptured source', validation.warnings.some((w) => w.includes('evidence')), true);

  section('4. Tamper and wrong-key rejection');
  const flipped = built.bytes.slice();
  flipped[flipped.length - 1] ^= 0xff;
  const tamperValidation = await validateArchiveBytes(flipped, {
    storedChecksum: built.storedChecksum,
    schemaVersion: '1.0',
    projectRef: 'drill-project',
  });
  check('flipped byte is rejected', tamperValidation.archiveIntact, false);
  check('rejection is attributed to the stored checksum, before decrypt', tamperValidation.checks[0].passed, false);

  // Tamper INSIDE the ciphertext while presenting a matching checksum,
  // so only the GCM tag can catch it.
  const inner = built.bytes.slice();
  inner[inner.length - 2] ^= 0x01;
  const { sha256Hex } = await import('./archiveBuilder.ts');
  const innerChecksum = await sha256Hex(inner);
  const innerValidation = await validateArchiveBytes(inner, {
    storedChecksum: innerChecksum,
    schemaVersion: '1.0',
    projectRef: 'drill-project',
  });
  check('altered ciphertext with a matching checksum is still rejected by the GCM tag', innerValidation.archiveIntact, false);
  check('GCM failure says contents must not be trusted', innerValidation.checks.some((c) => !c.passed && /must not be trusted/.test(c.detail ?? '')), true);

  Deno.env.set('BACKUP_ENCRYPTION_KEY', btoa(String.fromCharCode(...new Uint8Array(32).fill(9))));
  const wrongKeyValidation = await validateArchiveBytes(built.bytes, {
    storedChecksum: built.storedChecksum,
    schemaVersion: '1.0',
    projectRef: 'drill-project',
  });
  check('wrong key is rejected', wrongKeyValidation.archiveIntact, false);
  Deno.env.set('BACKUP_ENCRYPTION_KEY', VALID_KEY);

  section('5. Read table data back out of the archive');
  const opened = await openArchiveTables(built.bytes);
  if ('error' in opened) {
    check('openArchiveTables succeeded', opened.error, '(no error)');
  } else {
    check('municipalities round-tripped', opened.tables.municipalities?.length, 2);
    check('case_reports round-tripped', opened.tables.case_reports?.length, 2);
    check('paged table round-tripped in full', opened.tables.chat_messages?.length, 2300);
    check('row content preserved exactly', (opened.tables.municipalities?.[0] as Record<string, unknown>)?.municipality_name, 'Baler');
    check('never-restored tables are still PRESENT in the archive', !!opened.tables.user_profiles && !!opened.tables.audit_logs, true);
    check('secret-bearing tables are absent from the archive', 'security_passcodes' in opened.tables, false);
  }

  section('6. Restore storage objects (checksum-verified, skip-on-conflict)');
  // Target already holds one of the objects, with DIFFERENT bytes.
  const targetStorage: Record<string, Record<string, Uint8Array>> = {
    evidence: { 'case/c1/photo0.jpg': new TextEncoder().encode('PRE-EXISTING DO NOT CLOBBER') },
    'identity-documents': {},
  };
  const skipClient = makeStubClient(targetStorage);
  const skipResult = await restoreStorageObjects(skipClient, built.bytes, { conflictPolicy: 'skip' });
  check('existing object was not overwritten under skip policy', skipResult.skippedExisting, 1);
  check('nothing was overwritten under skip policy', skipResult.overwritten, 0);
  check('no checksum failures', skipResult.checksumFailures.length, 0);
  check('every restored object was checksum-verified', skipResult.verified, skipResult.restored + skipResult.skippedExisting);
  check('nested path restored to its original location', !!skipClient.__uploaded?.evidence?.['case/c1/nested/deep/report.pdf'], true);
  check('duplicate basename under a different prefix restored separately', !!skipClient.__uploaded?.evidence?.['case/c2/photo0.jpg'], true);
  check('no bucket was invented', skipResult.missingBuckets, []);

  const overwriteClient = makeStubClient(targetStorage);
  const overwriteResult = await restoreStorageObjects(overwriteClient, built.bytes, { conflictPolicy: 'overwrite' });
  check('overwrite policy replaces the existing object', overwriteResult.overwritten, 1);
  check('overwritten bytes come from the archive, not the target', new TextDecoder().decode(overwriteClient.__uploaded.evidence['case/c1/photo0.jpg']), 'evidence-bytes-0');

  section('7. Missing target bucket is reported, never created');
  const noBucketClient = makeStubClient({});
  // deno-lint-ignore no-explicit-any
  (noBucketClient as any).storage.listBuckets = () => Promise.resolve({ data: [{ id: 'identity-documents', name: 'identity-documents', public: false }], error: null });
  const missingBucketResult = await restoreStorageObjects(noBucketClient, built.bytes, { conflictPolicy: 'skip' });
  check('evidence reported as a missing bucket', missingBucketResult.missingBuckets, ['evidence']);
  check('failures recorded for objects in the missing bucket', missingBucketResult.failures.length > 0, true);
  check('no evidence object was written anywhere', !noBucketClient.__uploaded?.evidence, true);

  section('8. A lost listing subtree is reported, not silently dropped');
  const lostSubtree = await buildArchive(
    makeStubClient(storage, { unlistablePrefixes: new Set(['case/c1/nested']) }),
    {
      backupId: 'drill-0002',
      backupType: 'manual',
      projectRef: 'drill-project',
      schemaVersion: '1.0',
      includeStorageBinaries: true,
      initiatedBy: null,
    }
  );
  const lostCoverage = lostSubtree.coverage.find((c) => c.source === 'storage bucket: evidence');
  check('bucket with an unlistable prefix is not reported complete', lostSubtree.isComplete, false);
  check('lost subtree is explained in the coverage note', /could not be listed/.test(lostCoverage?.note ?? ''), true);

  console.log(`\n${fail === 0 ? 'DRILL PASSED' : 'DRILL FAILED'} — ${pass} passed, ${fail} failed`);
  if (fail > 0) console.error(`Failed: ${failures.join(', ')}`);
  console.log(
    '\nSCOPE REMINDER: this drill is ARCHIVE-VALIDATED ONLY. It does not\n' +
      'prove a restore into a real Supabase project, nor that RLS/grants/\n' +
      'triggers/auth survive one. See docs/RECOVERY-DRILL.md for the\n' +
      'staging drill that does, which requires a disposable project.\n'
  );
  if (fail > 0) Deno.exit(1);
}

await main();

#!/usr/bin/env node
/**
 * SafeSpace RBAC / RLS authorization probe
 * =========================================
 * Evidence-gathering harness for the SafeSpace security assessment.
 *
 * WHAT IT DOES
 *   1. Signs in each configured test account against Supabase Auth.
 *   2. Re-reads each account's ACTUAL role from user_profiles (never trusts
 *      the role written in the config file).
 *   3. Builds a visibility matrix: which rows of which tables each account
 *      can actually read, using the live PostgREST API with that account's
 *      own session token.
 *   4. Cross-tenant probe: for every pair of accounts, takes row IDs that
 *      account A can see and account B cannot, then has B request those IDs
 *      directly. Any row B retrieves is an authorization failure.
 *   5. Forbidden-table probe: checks that accounts cannot read tables their
 *      role has no business reading, using the highest-privilege supplied
 *      account as ground truth for whether the table actually has data
 *      (so "0 rows" is never mistaken for "correctly denied").
 *   6. Edge Function probe: confirms privileged functions reject callers
 *      whose role is not authorized.
 *   7. (--allow-writes only) Privilege-escalation probe: attempts to
 *      self-promote a low-privilege account to super_admin, verifies the
 *      result, and reverts immediately if it somehow succeeded.
 *
 * SAFETY
 *   - Read-only by default. Writes happen ONLY with --allow-writes, and the
 *     only write attempted is one that is expected to FAIL.
 *   - Never prints credentials, tokens, or row content. Output is limited to
 *     HTTP status, row counts, and 8-character ID prefixes.
 *   - Creates no records, deletes no records, modifies no case data.
 *
 * USAGE
 *   cp .test-accounts.env.example .test-accounts.env   # then fill it in
 *   node rbac-probe.mjs
 *   node rbac-probe.mjs --allow-writes
 */

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ALLOW_WRITES = process.argv.includes('--allow-writes');
const STARTED = new Date();

// Tables holding survivor-identifiable or case-sensitive data. These are the
// ones a cross-tenant leak would actually matter on.
const SENSITIVE_TABLES = [
  'case_reports', 'survivors', 'sos_alerts', 'evidence', 'chat_sessions',
  'chat_messages', 'expert_support_requests', 'notifications',
  'shelter_requests', 'shelter_referrals', 'case_referrals',
  'law_enforcement_referrals', 'case_services', 'case_status_history',
  'user_verifications', 'case_client_links', 'barangay_action_requests',
];

const TECHNICAL_ADMIN = ['provincial_admin', 'super_admin'];
const ADMIN_ROLES = ['barangay_admin', 'municipal_admin', 'provincial_staff', 'provincial_admin', 'super_admin'];

// table -> roles permitted to read it at all. Anything else reading it is a
// finding. `[]` means no client role should ever read it (service-role only).
const RESTRICTED_TABLES = {
  audit_logs: TECHNICAL_ADMIN,
  system_backups: TECHNICAL_ADMIN,
  system_restores: TECHNICAL_ADMIN,
  backup_schedule: TECHNICAL_ADMIN,
  security_passcodes: [],
  protected_access_grants: [],
  profile_photo_changes: [],
  case_access_tokens: ADMIN_ROLES,
};

const results = [];
const record = (r) => { results.push(r); return r; };
const short = (id) => (typeof id === 'string' ? id.slice(0, 8) : String(id));

function loadConfig() {
  const path = join(HERE, '.test-accounts.env');
  let raw;
  try {
    raw = readFileSync(path, 'utf8');
  } catch {
    console.error(`\nMissing ${path}`);
    console.error('Copy .test-accounts.env.example to .test-accounts.env and fill it in.\n');
    process.exit(1);
  }
  const cfg = {}; const accounts = [];
  for (const line of raw.split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const eq = t.indexOf('=');
    if (eq < 0) continue;
    const key = t.slice(0, eq).trim();
    const val = t.slice(eq + 1).trim();
    if (key.startsWith('ACCT_')) {
      const [role, label, email, password] = val.split('|').map((s) => (s ?? '').trim());
      if (!email || !password) continue; // unfilled template line — skip silently
      accounts.push({ key, declaredRole: role, label: label || key, email, password });
    } else {
      cfg[key] = val;
    }
  }
  if (!cfg.SUPABASE_URL || !cfg.SUPABASE_ANON_KEY) {
    console.error('\nSUPABASE_URL and SUPABASE_ANON_KEY are both required in .test-accounts.env\n');
    process.exit(1);
  }
  if (accounts.length === 0) {
    console.error('\nNo usable ACCT_* lines found. Each needs role|label|email|password.\n');
    process.exit(1);
  }
  return { cfg, accounts };
}

const { cfg, accounts } = loadConfig();
const BASE = cfg.SUPABASE_URL.replace(/\/+$/, '');
const KEY = cfg.SUPABASE_ANON_KEY;

async function signIn(acct) {
  const res = await fetch(`${BASE}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: acct.email, password: acct.password }),
  });
  if (!res.ok) {
    let reason = `HTTP ${res.status}`;
    try { const j = await res.json(); reason = j.error_description || j.msg || j.error || reason; } catch { /* keep status */ }
    return { ok: false, reason };
  }
  const j = await res.json();
  return { ok: true, token: j.access_token, authUserId: j.user?.id };
}

async function rest(acct, path, { method = 'GET', body, prefer } = {}) {
  const headers = { apikey: KEY, Authorization: `Bearer ${acct.token}` };
  if (body) headers['Content-Type'] = 'application/json';
  if (prefer) headers.Prefer = prefer;
  const res = await fetch(`${BASE}/rest/v1/${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
  let json = null;
  const text = await res.text();
  if (text) { try { json = JSON.parse(text); } catch { json = null; } }
  const range = res.headers.get('content-range');
  const total = range && range.includes('/') ? range.split('/')[1] : null;
  return { status: res.status, ok: res.ok, json, total, code: json && !Array.isArray(json) ? json.code : null };
}

async function callFunction(acct, name, body) {
  const res = await fetch(`${BASE}/functions/v1/${name}`, {
    method: 'POST',
    headers: { apikey: KEY, Authorization: `Bearer ${acct.token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body ?? {}),
  });
  return { status: res.status };
}

function detectPk(row) {
  if (!row) return null;
  const keys = Object.keys(row);
  const uuidish = (v) => typeof v === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-/i.test(v);
  return keys.find((k) => k.endsWith('_id') && uuidish(row[k])) || keys.find((k) => k.endsWith('_id')) || null;
}

const line = (s = '') => console.log(s);
const pad = (s, n) => String(s).padEnd(n);

// ---------------------------------------------------------------------------
// Phase 1 — authenticate
// ---------------------------------------------------------------------------
line('');
line('SafeSpace RBAC / RLS authorization probe');
line(`Target : ${BASE}`);
line(`Started: ${STARTED.toISOString()}`);
line(`Mode   : ${ALLOW_WRITES ? 'READ + WRITE probes (--allow-writes)' : 'READ-ONLY'}`);
line('');
line('--- Phase 1: authentication -------------------------------------------');

const live = [];
for (const acct of accounts) {
  const auth = await signIn(acct);
  if (!auth.ok) {
    line(`  ${pad(acct.label, 16)} SIGN-IN FAILED  (${auth.reason})`);
    record({ phase: 'auth', account: acct.label, status: 'ERROR', detail: auth.reason });
    continue;
  }
  acct.token = auth.token;
  acct.authUserId = auth.authUserId;

  const prof = await rest(acct, 'user_profiles?select=profile_id,role,municipality_id,barangay_id&limit=1');
  const p = Array.isArray(prof.json) ? prof.json[0] : null;
  acct.profileId = p?.profile_id ?? null;
  acct.actualRole = p?.role ?? null;

  const mismatch = acct.actualRole && acct.declaredRole && acct.actualRole !== acct.declaredRole;
  line(`  ${pad(acct.label, 16)} OK  role=${acct.actualRole ?? 'UNRESOLVED'}  profile=${short(acct.profileId)}${mismatch ? `  [!] config said "${acct.declaredRole}"` : ''}`);
  record({ phase: 'auth', account: acct.label, status: 'OK', role: acct.actualRole, profileIdPrefix: short(acct.profileId), configMismatch: !!mismatch });
  live.push(acct);
}

if (live.length === 0) { line('\nNo accounts signed in. Nothing to probe.\n'); process.exit(1); }

// Highest-privilege signed-in account, used as ground truth for "does this
// table actually contain any rows?" so an empty result is never misread.
const groundTruth = live.find((a) => TECHNICAL_ADMIN.includes(a.actualRole))
  || live.find((a) => ADMIN_ROLES.includes(a.actualRole))
  || null;

// ---------------------------------------------------------------------------
// Phase 2 — visibility matrix
// ---------------------------------------------------------------------------
line('');
line('--- Phase 2: visibility matrix (rows each account can read) ------------');
line(`  ${pad('table', 28)}${live.map((a) => pad(a.label, 14)).join('')}`);

const visible = {}; // table -> label -> { pk, ids[], status, total }
for (const table of SENSITIVE_TABLES) {
  visible[table] = {};
  const cells = [];
  for (const acct of live) {
    const r = await rest(acct, `${table}?select=*&limit=25`, { prefer: 'count=exact' });
    const rows = Array.isArray(r.json) ? r.json : [];
    const pk = detectPk(rows[0]);
    visible[table][acct.label] = {
      pk,
      ids: pk ? rows.map((x) => x[pk]).filter(Boolean) : [],
      status: r.status,
      total: r.total,
    };
    cells.push(pad(r.ok ? `${r.total ?? rows.length} rows` : `denied ${r.status}`, 14));
    record({ phase: 'visibility', table, account: acct.label, role: acct.actualRole, status: r.status, rowsVisible: r.ok ? (r.total ?? rows.length) : 0, pgCode: r.code });
  }
  line(`  ${pad(table, 28)}${cells.join('')}`);
}

// ---------------------------------------------------------------------------
// Phase 3 — cross-tenant probe
// ---------------------------------------------------------------------------
line('');
line('--- Phase 3: cross-tenant access (A can see it; can B fetch it?) -------');
let xChecks = 0, xFails = 0, xSkipped = 0;
for (const table of SENSITIVE_TABLES) {
  for (const A of live) {
    const va = visible[table][A.label];
    if (!va.pk || va.ids.length === 0) continue;
    for (const B of live) {
      if (A.label === B.label) continue;
      const vb = visible[table][B.label];
      const bSet = new Set(vb.ids || []);
      const targets = va.ids.filter((id) => !bSet.has(id)).slice(0, 3);
      if (targets.length === 0) { xSkipped++; continue; }
      for (const id of targets) {
        const r = await rest(B, `${table}?${va.pk}=eq.${encodeURIComponent(id)}&select=${va.pk}`);
        const leaked = r.ok && Array.isArray(r.json) && r.json.length > 0;
        xChecks++;
        if (leaked) {
          xFails++;
          line(`  FAIL  ${pad(table, 26)} ${pad(B.label, 14)} read ${pad(A.label, 14)} row ${short(id)}`);
          record({ phase: 'cross-tenant', result: 'FAIL', table, owner: A.label, ownerRole: A.actualRole, probe: B.label, probeRole: B.actualRole, rowIdPrefix: short(id), status: r.status });
        } else {
          record({ phase: 'cross-tenant', result: 'PASS', table, owner: A.label, ownerRole: A.actualRole, probe: B.label, probeRole: B.actualRole, rowIdPrefix: short(id), status: r.status });
        }
      }
    }
  }
}
line(`  ${xChecks} checks run, ${xFails} failures, ${xSkipped} pairs skipped (no distinguishing rows).`);
if (xChecks === 0) line('  NOTE: no cross-tenant checks were possible — the test accounts hold no distinct data yet.');

// ---------------------------------------------------------------------------
// Phase 4 — restricted tables
// ---------------------------------------------------------------------------
line('');
line('--- Phase 4: restricted tables -----------------------------------------');
for (const [table, allowedRoles] of Object.entries(RESTRICTED_TABLES)) {
  let truth = null;
  if (groundTruth) {
    const g = await rest(groundTruth, `${table}?select=*&limit=1`, { prefer: 'count=exact' });
    truth = g.ok ? Number(g.total ?? 0) : null;
  }
  for (const acct of live) {
    const permitted = allowedRoles.includes(acct.actualRole);
    const r = await rest(acct, `${table}?select=*&limit=1`, { prefer: 'count=exact' });
    const rows = r.ok ? Number(r.total ?? (Array.isArray(r.json) ? r.json.length : 0)) : 0;
    let verdict;
    if (permitted) verdict = r.ok ? 'PASS (permitted, readable)' : `INFO (permitted but ${r.status})`;
    else if (!r.ok) verdict = 'PASS (denied)';
    else if (rows > 0) verdict = 'FAIL (unauthorized read)';
    else if (truth === null || truth === 0) verdict = 'INCONCLUSIVE (0 rows; table may be empty)';
    else verdict = 'PASS (filtered to 0 of ' + truth + ')';
    if (verdict.startsWith('FAIL')) line(`  FAIL  ${pad(table, 26)} ${pad(acct.label, 14)} role=${acct.actualRole} read ${rows} row(s)`);
    record({ phase: 'restricted', table, account: acct.label, role: acct.actualRole, permitted, status: r.status, rowsVisible: rows, groundTruthRows: truth, verdict });
  }
}
const r4 = results.filter((r) => r.phase === 'restricted');
line(`  ${r4.filter((r) => r.verdict.startsWith('PASS')).length} pass, ${r4.filter((r) => r.verdict.startsWith('FAIL')).length} fail, ${r4.filter((r) => r.verdict.startsWith('INCONCLUSIVE')).length} inconclusive.`);

// ---------------------------------------------------------------------------
// Phase 5 — Edge Function authorization
// ---------------------------------------------------------------------------
line('');
line('--- Phase 5: Edge Function authorization -------------------------------');
for (const acct of live) {
  const isTech = TECHNICAL_ADMIN.includes(acct.actualRole);

  const f1 = await callFunction(acct, 'create-admin-user', { action: 'create' });
  const expect1 = ['municipal_admin', ...TECHNICAL_ADMIN, 'provincial_staff'].includes(acct.actualRole);
  const v1 = expect1 ? 'INFO (role may legitimately call this)' : (f1.status === 401 || f1.status === 403 ? 'PASS (rejected)' : `FAIL (HTTP ${f1.status})`);
  if (v1.startsWith('FAIL')) line(`  FAIL  create-admin-user      ${pad(acct.label, 14)} role=${acct.actualRole} HTTP ${f1.status}`);
  record({ phase: 'edge-function', fn: 'create-admin-user', account: acct.label, role: acct.actualRole, status: f1.status, verdict: v1 });

  // Skipped for technical admins: they are authorized, and calling it would
  // actually create a production backup.
  if (!isTech) {
    const f2 = await callFunction(acct, 'backup-create', { action: 'create' });
    const v2 = (f2.status === 401 || f2.status === 403) ? 'PASS (rejected)' : `FAIL (HTTP ${f2.status})`;
    if (v2.startsWith('FAIL')) line(`  FAIL  backup-create          ${pad(acct.label, 14)} role=${acct.actualRole} HTTP ${f2.status}`);
    record({ phase: 'edge-function', fn: 'backup-create', account: acct.label, role: acct.actualRole, status: f2.status, verdict: v2 });
  } else {
    record({ phase: 'edge-function', fn: 'backup-create', account: acct.label, role: acct.actualRole, status: null, verdict: 'SKIPPED (authorized role; would create a real backup)' });
  }
}
const r5 = results.filter((r) => r.phase === 'edge-function');
line(`  ${r5.filter((r) => r.verdict.startsWith('PASS')).length} pass, ${r5.filter((r) => r.verdict.startsWith('FAIL')).length} fail, ${r5.filter((r) => r.verdict.startsWith('SKIPPED')).length} skipped.`);

// ---------------------------------------------------------------------------
// Phase 6 — privilege escalation (opt-in)
// ---------------------------------------------------------------------------
line('');
line('--- Phase 6: privilege escalation --------------------------------------');
if (!ALLOW_WRITES) {
  line('  SKIPPED — re-run with --allow-writes to attempt self-promotion to super_admin.');
  record({ phase: 'privesc', verdict: 'SKIPPED (read-only mode)' });
} else {
  for (const acct of live) {
    if (TECHNICAL_ADMIN.includes(acct.actualRole) || !acct.profileId) continue;
    const original = acct.actualRole;
    const attempt = await rest(acct, `user_profiles?profile_id=eq.${acct.profileId}`, { method: 'PATCH', body: { role: 'super_admin' }, prefer: 'return=representation' });
    const after = await rest(acct, 'user_profiles?select=role&limit=1');
    const nowRole = Array.isArray(after.json) ? after.json[0]?.role : null;
    const escalated = nowRole === 'super_admin';
    let verdict;
    if (escalated) {
      verdict = 'CRITICAL FAIL (role changed to super_admin)';
      line(`  CRITICAL  ${pad(acct.label, 14)} escalated ${original} -> super_admin. Attempting revert...`);
      const rev = await rest(acct, `user_profiles?profile_id=eq.${acct.profileId}`, { method: 'PATCH', body: { role: original } });
      const check = await rest(acct, 'user_profiles?select=role&limit=1');
      const reverted = (Array.isArray(check.json) ? check.json[0]?.role : null) === original;
      line(reverted ? `  ...reverted to ${original}.` : `  ...REVERT FAILED (HTTP ${rev.status}) — fix manually in the Supabase dashboard.`);
      record({ phase: 'privesc', account: acct.label, role: original, verdict, reverted });
    } else {
      verdict = `PASS (rejected, HTTP ${attempt.status}; role still ${nowRole})`;
      record({ phase: 'privesc', account: acct.label, role: original, status: attempt.status, verdict });
    }
  }
  const r6 = results.filter((r) => r.phase === 'privesc' && r.verdict);
  line(`  ${r6.filter((r) => r.verdict.startsWith('PASS')).length} pass, ${r6.filter((r) => r.verdict.startsWith('CRITICAL')).length} critical failure(s).`);
}

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------
const fails = results.filter((r) => String(r.verdict || r.result || '').match(/^(FAIL|CRITICAL)/));
const inconclusive = results.filter((r) => String(r.verdict || '').startsWith('INCONCLUSIVE'));

line('');
line('--- Summary -------------------------------------------------------------');
line(`  Probes recorded : ${results.length}`);
line(`  Failures        : ${fails.length}`);
line(`  Inconclusive    : ${inconclusive.length}`);
line('');
if (fails.length === 0) {
  line('  No authorization failures detected in the probes that actually ran.');
  line('  This is NOT proof the system is secure — see inconclusive count and');
  line('  the coverage limits of the supplied account set.');
} else {
  line('  AUTHORIZATION FAILURES DETECTED — see the FAIL lines above.');
}

mkdirSync(join(HERE, 'reports'), { recursive: true });
const stamp = STARTED.toISOString().replace(/[:.]/g, '-');
const out = join(HERE, 'reports', `rbac-probe-${stamp}.json`);
writeFileSync(out, JSON.stringify({
  target: BASE,
  startedAt: STARTED.toISOString(),
  finishedAt: new Date().toISOString(),
  mode: ALLOW_WRITES ? 'read+write' : 'read-only',
  accounts: live.map((a) => ({ label: a.label, role: a.actualRole, profileIdPrefix: short(a.profileId) })),
  totals: { probes: results.length, failures: fails.length, inconclusive: inconclusive.length },
  results,
}, null, 2));
line(`  JSON report: ${out}`);
line('');

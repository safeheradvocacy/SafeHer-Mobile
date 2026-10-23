#!/usr/bin/env node
// supabase/functions/_shared/archiveBuilder.checks.mjs
//
// Runnable assertions for the two security/correctness-critical PURE
// functions in the Backup & Restore module:
//
//   1. isUnsafeArchivePath()  (_shared/archiveBuilder.ts)
//      — rejects ZIP member paths that would escape the extraction
//        directory. This is the control standing between a malicious
//        uploaded archive and arbitrary file write.
//
//   2. topologicallyOrder()   (backup-restore/index.ts)
//      — orders restore upserts parents-first from the live foreign-key
//        graph, and refuses to order genuine cycles instead of failing
//        deep into an executing restore.
//
// WHY IT IS WRITTEN THIS WAY: this repository has no test framework and
// no test files of any kind (verified: no vitest/jest/playwright in
// either package.json, no *.test.* or *.spec.* anywhere). Rather than
// introduce a framework nobody asked for, or — far worse — paste a COPY
// of these functions into a test file where the copy could pass while
// the real code is broken, this script extracts each function's ACTUAL
// source text from the ACTUAL file and evaluates that. If someone edits
// the real implementation, this script tests the edit.
//
// It deliberately does NOT test anything requiring Supabase, Deno, or
// network access — those are covered by the SQL VERIFICATION sections in
// module42_backup_authorization_hardening.sql, which must be run against
// a real project.
//
// Run:  node supabase/functions/_shared/archiveBuilder.checks.mjs

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';

const here = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

// The admin app's own typescript, used only to strip types from the
// extracted function text. No new dependency is introduced.
const ts = require(join(here, '..', '..', '..', 'admin', 'node_modules', 'typescript'));

let failures = 0;
let passes = 0;

function check(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) {
    passes += 1;
  } else {
    failures += 1;
    console.error(`  FAIL  ${label}\n          expected ${JSON.stringify(expected)}\n          actual   ${JSON.stringify(actual)}`);
    return;
  }
  console.log(`  pass  ${label}`);
}

/**
 * Pulls one `function name(...) { ... }` declaration out of a source
 * file by brace-matching from its signature, so no copy of the body
 * lives in this script.
 */
function extractFunction(source, name) {
  const sigIndex = source.indexOf(`function ${name}(`);
  if (sigIndex === -1) throw new Error(`could not find function ${name}`);

  // Find the end of the PARAMETER LIST by paren-matching, then locate
  // the body's opening brace. This matters because a return type can
  // itself be an object literal — `): { ordered: string[] } {` — and
  // naively taking the first `{` after the signature brace-matches the
  // RETURN TYPE instead of the body, silently extracting a fragment.
  const parenStart = source.indexOf('(', sigIndex);
  let parenDepth = 0;
  let afterParams = -1;
  for (let i = parenStart; i < source.length; i++) {
    if (source[i] === '(') parenDepth += 1;
    else if (source[i] === ')') {
      parenDepth -= 1;
      if (parenDepth === 0) {
        afterParams = i + 1;
        break;
      }
    }
  }
  if (afterParams === -1) throw new Error(`unbalanced parameter list for ${name}`);

  // Skip a return-type annotation if present. When that type is itself
  // an object literal, brace-match past it so the body brace is found.
  let cursor = afterParams;
  while (cursor < source.length && /\s/.test(source[cursor])) cursor += 1;
  if (source[cursor] === ':') {
    cursor += 1;
    while (cursor < source.length && /\s/.test(source[cursor])) cursor += 1;
    if (source[cursor] === '{') {
      let typeDepth = 0;
      for (; cursor < source.length; cursor++) {
        if (source[cursor] === '{') typeDepth += 1;
        else if (source[cursor] === '}') {
          typeDepth -= 1;
          if (typeDepth === 0) {
            cursor += 1;
            break;
          }
        }
      }
    }
    // For a simple named return type (`): Foo {`), the next `{` found
    // below is already the body brace, so nothing more to skip.
  }

  const braceStart = source.indexOf('{', cursor);
  let depth = 0;
  let inLineComment = false;
  let inBlockComment = false;
  let quote = null;
  for (let i = braceStart; i < source.length; i++) {
    const c = source[i];
    const next = source[i + 1];
    if (inLineComment) {
      if (c === '\n') inLineComment = false;
      continue;
    }
    if (inBlockComment) {
      if (c === '*' && next === '/') {
        inBlockComment = false;
        i += 1;
      }
      continue;
    }
    if (quote) {
      if (c === '\\') i += 1;
      else if (c === quote) quote = null;
      continue;
    }
    if (c === '/' && next === '/') {
      inLineComment = true;
      i += 1;
      continue;
    }
    if (c === '/' && next === '*') {
      inBlockComment = true;
      i += 1;
      continue;
    }
    if (c === '"' || c === "'" || c === '`') {
      quote = c;
      continue;
    }
    if (c === '{') depth += 1;
    else if (c === '}') {
      depth -= 1;
      if (depth === 0) return source.slice(sigIndex, i + 1);
    }
  }
  throw new Error(`unbalanced braces while extracting ${name}`);
}

/**
 * Strips TypeScript types using the REAL compiler, not regexes.
 *
 * An earlier version of this script hand-rolled regex type-stripping
 * and it was genuinely wrong: `trail.slice(start === -1 ? 0 : start)`
 * had its ternary `: start` eaten as if it were a type annotation,
 * producing a syntax error. A checker that mangles the code it is
 * checking is worse than no checker, so this uses typescript's own
 * transpiler (already a dev dependency of the admin app).
 */
function stripTypes(src) {
  return ts.transpileModule(src, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
  }).outputText;
}

console.log('\n1. isUnsafeArchivePath — ZIP path traversal rejection');
{
  const src = readFileSync(join(here, 'archiveBuilder.ts'), 'utf8');
  const fnSrc = stripTypes(extractFunction(src, 'isUnsafeArchivePath'));
  const isUnsafeArchivePath = new Function(`${fnSrc}; return isUnsafeArchivePath;`)();

  // Must be REJECTED
  check('empty path', isUnsafeArchivePath(''), true);
  check('absolute posix', isUnsafeArchivePath('/etc/passwd'), true);
  check('absolute windows backslash', isUnsafeArchivePath('\\Windows\\System32'), true);
  check('drive letter', isUnsafeArchivePath('C:/Windows/System32'), true);
  check('leading traversal', isUnsafeArchivePath('../../etc/passwd'), true);
  check('embedded traversal', isUnsafeArchivePath('database/data/../../../etc/passwd'), true);
  check('backslash traversal', isUnsafeArchivePath('database\\..\\..\\etc\\passwd'), true);
  check('traversal as final segment', isUnsafeArchivePath('database/data/..'), true);

  // Must be ACCEPTED — these are the archive's own real member paths
  check('manifest', isUnsafeArchivePath('manifest.json'), false);
  check('table export', isUnsafeArchivePath('database/data/case_reports.json'), false);
  check('schema member', isUnsafeArchivePath('database/schema/policies.json'), false);
  check('storage object', isUnsafeArchivePath('storage/evidence/2026/01/photo.jpg'), false);
  check('auth instructions', isUnsafeArchivePath('authentication/RESTORATION-INSTRUCTIONS.md'), false);
  // A filename that merely CONTAINS dots is legitimate and must not be
  // confused with a traversal segment.
  check('dots inside a filename', isUnsafeArchivePath('database/data/my..table.json'), false);
  check('single dot segment is not traversal', isUnsafeArchivePath('database/./data.json'), false);
}

console.log('\n2. topologicallyOrder — dependency ordering and cycle refusal');
{
  const src = readFileSync(join(here, '..', 'backup-restore', 'index.ts'), 'utf8');
  const fnSrc = stripTypes(extractFunction(src, 'topologicallyOrder'));
  const neverMatch = src.match(/const NEVER_RESTORED = new Set\(\[([^\]]*)\]\)/);
  if (!neverMatch) throw new Error('could not find NEVER_RESTORED');
  const topologicallyOrder = new Function(
    `const NEVER_RESTORED = new Set([${neverMatch[1]}]); ${fnSrc}; return topologicallyOrder;`
  )();

  const deps = [
    { table_name: 'municipalities', pk_columns: ['municipality_id'], depends_on: [] },
    { table_name: 'barangays', pk_columns: ['barangay_id'], depends_on: ['municipalities'] },
    { table_name: 'case_reports', pk_columns: ['case_id'], depends_on: ['survivors', 'barangays'] },
    { table_name: 'survivors', pk_columns: ['survivor_id'], depends_on: ['user_profiles'] },
    { table_name: 'user_profiles', pk_columns: ['profile_id'], depends_on: [] },
    { table_name: 'audit_logs', pk_columns: ['log_id'], depends_on: ['user_profiles'] },
    { table_name: 'case_services', pk_columns: ['service_id'], depends_on: ['case_reports'] },
  ];
  const present = new Set(deps.map((d) => d.table_name));
  const { ordered, cycles } = topologicallyOrder(deps, present);

  check('no cycles in an acyclic graph', cycles, []);

  // Policy exclusions must not appear at all.
  check('user_profiles excluded by policy', ordered.includes('user_profiles'), false);
  check('audit_logs excluded by policy', ordered.includes('audit_logs'), false);

  const pos = (t) => ordered.indexOf(t);
  check('municipalities before barangays', pos('municipalities') < pos('barangays'), true);
  check('barangays before case_reports', pos('barangays') < pos('case_reports'), true);
  check('survivors before case_reports', pos('survivors') < pos('case_reports'), true);
  check('case_reports before case_services', pos('case_reports') < pos('case_services'), true);
  check('every non-excluded present table ordered', ordered.length, 5);

  // A real cycle must be reported and withheld, never ordered anyway.
  const cyclic = [
    { table_name: 'a', pk_columns: ['id'], depends_on: ['b'] },
    { table_name: 'b', pk_columns: ['id'], depends_on: ['a'] },
    { table_name: 'c', pk_columns: ['id'], depends_on: [] },
  ];
  const res2 = topologicallyOrder(cyclic, new Set(['a', 'b', 'c']));
  check('cycle members reported', res2.cycles.sort(), ['a', 'b']);
  check('cycle members withheld from ordering', res2.ordered, ['c']);

  // A parent that is not in the archive must not block its child:
  // restore is upsert-only, so the parent row may already exist live.
  const partial = [{ table_name: 'case_services', pk_columns: ['service_id'], depends_on: ['case_reports'] }];
  const res3 = topologicallyOrder(partial, new Set(['case_services']));
  check('child orders even when parent absent from archive', res3.ordered, ['case_services']);
}

console.log('\n3. AES-256-GCM round-trip (same primitives the builder uses)');
{
  // Verifies the scheme and header layout the archive builder relies on:
  // magic(8) | version(1) | iv(12) | ciphertext+tag. Uses Node's
  // WebCrypto, which is the same API surface Deno provides.
  // NB: getRandomValues must stay bound to the Crypto object — pulling
  // it out by destructuring throws ERR_INVALID_THIS on Node.
  const { subtle } = globalThis.crypto;
  const getRandomValues = (a) => globalThis.crypto.getRandomValues(a);
  const rawKey = getRandomValues(new Uint8Array(32));
  const plaintext = new TextEncoder().encode('SafeSpace archive bytes');

  const encKey = await subtle.importKey('raw', rawKey, { name: 'AES-GCM' }, false, ['encrypt']);
  const iv = getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await subtle.encrypt({ name: 'AES-GCM', iv }, encKey, plaintext));

  const magic = new TextEncoder().encode('SSBKENC1');
  const stored = new Uint8Array(magic.length + 1 + iv.length + ct.length);
  stored.set(magic, 0);
  stored[magic.length] = 1;
  stored.set(iv, magic.length + 1);
  stored.set(ct, magic.length + 1 + iv.length);

  check('encrypted output is not the plaintext', Buffer.from(stored).equals(Buffer.from(plaintext)), false);
  check('magic header present', new TextDecoder().decode(stored.slice(0, 8)), 'SSBKENC1');

  const decKey = await subtle.importKey('raw', rawKey, { name: 'AES-GCM' }, false, ['decrypt']);
  const recoveredIv = stored.slice(9, 21);
  const recoveredCt = stored.slice(21);
  const pt = new Uint8Array(await subtle.decrypt({ name: 'AES-GCM', iv: recoveredIv }, decKey, recoveredCt));
  check('round-trips to the original bytes', new TextDecoder().decode(pt), 'SafeSpace archive bytes');

  // A tampered byte must fail the GCM tag, not decrypt to garbage.
  const tampered = stored.slice();
  tampered[tampered.length - 1] ^= 0xff;
  let tamperRejected = false;
  try {
    await subtle.decrypt({ name: 'AES-GCM', iv: recoveredIv }, decKey, tampered.slice(21));
  } catch {
    tamperRejected = true;
  }
  check('tampered ciphertext is rejected by the GCM tag', tamperRejected, true);

  // A wrong key must fail too.
  const wrongKey = await subtle.importKey('raw', getRandomValues(new Uint8Array(32)), { name: 'AES-GCM' }, false, ['decrypt']);
  let wrongKeyRejected = false;
  try {
    await subtle.decrypt({ name: 'AES-GCM', iv: recoveredIv }, wrongKey, recoveredCt);
  } catch {
    wrongKeyRejected = true;
  }
  check('wrong key is rejected', wrongKeyRejected, true);
}

console.log('\n4. resolveEncryptionKey — fail closed, never downgrade to plaintext');
{
  const src = readFileSync(join(here, 'archiveBuilder.ts'), 'utf8');
  const fnSrc = stripTypes(extractFunction(src, 'resolveEncryptionKey'));

  // The real function reads Deno.env and throws EncryptionKeyError, so
  // both are supplied in the evaluation scope. The FUNCTION BODY under
  // test is the real one from source.
  const makeFn = (envValue) => {
    const Deno = { env: { get: (name) => (name === 'BACKUP_ENCRYPTION_KEY' ? envValue : undefined) } };
    class EncryptionKeyError extends Error {
      constructor(m) {
        super(m);
        this.name = 'EncryptionKeyError';
      }
    }
    return new Function(
      'Deno',
      'EncryptionKeyError',
      'atob',
      `${fnSrc}; return resolveEncryptionKey;`
    )(Deno, EncryptionKeyError, (s) => Buffer.from(s, 'base64').toString('binary'));
  };

  const expectThrow = (label, envValue) => {
    let threw = false;
    let message = '';
    try {
      makeFn(envValue)();
    } catch (e) {
      threw = true;
      message = e.message ?? '';
    }
    check(label, threw, true);
    // A rejection message must never echo the supplied value.
    if (threw && typeof envValue === 'string' && envValue.length > 8) {
      check(`${label} — message does not echo the key`, message.includes(envValue.trim()), false);
    }
  };

  const validKey = Buffer.alloc(32, 7).toString('base64'); // 32 non-zero bytes

  expectThrow('missing key (undefined) is refused', undefined);
  expectThrow('empty key is refused', '');
  expectThrow('whitespace-only key is refused', '   \n  ');
  expectThrow('non-base64 key is refused', 'this is not base64!!');
  expectThrow('base64 of 16 bytes is refused', Buffer.alloc(16, 3).toString('base64'));
  expectThrow('base64 of 64 bytes is refused', Buffer.alloc(64, 3).toString('base64'));
  expectThrow('all-zero 32-byte key is refused', Buffer.alloc(32, 0).toString('base64'));

  // Accepted cases
  let ok = null;
  try {
    ok = makeFn(validKey)();
  } catch (e) {
    ok = `threw: ${e.message}`;
  }
  check('valid 32-byte key is accepted', ok instanceof Uint8Array ? ok.byteLength : ok, 32);

  let trimmed = null;
  try {
    trimmed = makeFn(`${validKey}\n`)();
  } catch (e) {
    trimmed = `threw: ${e.message}`;
  }
  check('key with trailing newline is accepted (trimmed)', trimmed instanceof Uint8Array ? trimmed.byteLength : trimmed, 32);

  // Regression guard for a real incident: an escrowed key came back 43
  // characters because its single '=' pad had been stripped. Those 43
  // characters still unambiguously encode the same 32 bytes, so the
  // key must be accepted rather than failing a backup over padding.
  const unpadded = validKey.replace(/=+$/, '');
  check('stripped-padding key is 43 chars (precondition)', unpadded.length, 43);
  let repadded = null;
  try {
    repadded = makeFn(unpadded)();
  } catch (e) {
    repadded = `threw: ${e.message}`;
  }
  check('key missing its "=" padding is re-padded and accepted', repadded instanceof Uint8Array ? repadded.byteLength : repadded, 32);
  check(
    're-padded key decodes to the SAME bytes as the padded form',
    repadded instanceof Uint8Array ? Buffer.from(repadded).toString('base64') : repadded,
    validKey
  );
}

console.log('\n5. Mandatory encryption — no plaintext fallback remains in source');
{
  // Comments are stripped first. Without this, the doc comment that
  // DOCUMENTS the removed `if (keyB64) { encrypt }` fallback matches the
  // regression regex and the check fails on its own prose — which is
  // exactly what happened on the first run of this section.
  const stripComments = (s) =>
    s
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .split('\n')
      .map((line) => line.replace(/(^|[^:])\/\/.*$/, '$1'))
      .join('\n');

  const src = stripComments(readFileSync(join(here, 'archiveBuilder.ts'), 'utf8'));

  // Guards against the specific regression this hardening removed: a
  // conditional that encrypts only when a key happens to be present.
  check(
    'no `if (keyB64)`-style conditional encryption',
    /if\s*\(\s*keyB64\s*\)/.test(src),
    false
  );
  check(
    'buildArchive calls resolveEncryptionKey unconditionally',
    /const rawKey = resolveEncryptionKey\(\);/.test(src),
    true
  );
  check('isEncrypted is not initialised to false anywhere', /let isEncrypted = false/.test(src), false);
  check(
    'decryptAesGcm no longer takes a key argument from callers',
    /decryptAesGcm\(stored,\s*keyB64\)/.test(src),
    false
  );
  check('GCM version byte is validated on decrypt', /Unsupported encrypted archive version/.test(src), true);
  check('truncated ciphertext is rejected before decrypt', /is too short to contain a complete authenticated payload/.test(src), true);
}

console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : 'CHECKS FAILED'} — ${passes} passed, ${failures} failed\n`);
process.exit(failures === 0 ? 0 : 1);

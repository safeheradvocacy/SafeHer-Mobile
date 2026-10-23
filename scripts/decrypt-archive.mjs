#!/usr/bin/env node
// scripts/decrypt-archive.mjs
//
// Decrypts a SafeSpace backup archive (.zip.enc) back into a readable
// .zip, using only Node 18+ — no Supabase, no network, no project
// access. This is deliberately standalone so it still works in the
// scenario backups exist for: the Supabase project is gone.
//
// Usage (PowerShell):
//   $env:BACKUP_ENCRYPTION_KEY='<base64 key from escrow>'
//   node scripts/decrypt-archive.mjs "C:\Users\You\Downloads\SafeSpace_Backup_....zip.enc" out.zip
//
// Usage (bash):
//   BACKUP_ENCRYPTION_KEY='<base64 key>' \
//     node scripts/decrypt-archive.mjs ~/Downloads/SafeSpace_Backup_....zip.enc out.zip
//
// Then verify every member against the archive's own checksum list:
//   unzip -o out.zip -d extracted
//   cd extracted && sha256sum -c checksums.sha256
//
// CONTAINER LAYOUT (written by _shared/archiveBuilder.ts):
//   magic "SSBKENC1" (8 bytes) | version (1 byte) | IV (12 bytes) | ciphertext+GCM tag
//
// The GCM tag is verified as part of decryption, so a wrong key, an
// altered IV, altered ciphertext or an altered tag all fail loudly and
// NOTHING is written. There is no code path here that produces a
// partially-decrypted or unauthenticated output file.

import { readFileSync, writeFileSync } from 'node:fs';

const MAGIC = 'SSBKENC1';
const MAGIC_LEN = 8;
const IV_LEN = 12;
const HEADER_LEN = MAGIC_LEN + 1 + IV_LEN;
const GCM_TAG_LEN = 16;

function die(message) {
  console.error(`\n  ✗ ${message}\n`);
  process.exit(1);
}

const [, , inFile, outFile] = process.argv;

if (!inFile || !outFile) {
  die(
    'usage: BACKUP_ENCRYPTION_KEY=<base64> node scripts/decrypt-archive.mjs <archive.zip.enc> <output.zip>'
  );
}

const keyB64 = process.env.BACKUP_ENCRYPTION_KEY;
if (!keyB64 || !keyB64.trim()) {
  die(
    'BACKUP_ENCRYPTION_KEY is not set.\n    Retrieve it from escrow (password manager / sealed offline copy),\n    not from the Supabase dashboard — testing the escrowed copy is the\n    whole point of this exercise.'
  );
}

// Trimmed for the same reason the Edge Function trims: a key pasted or
// piped from a file very commonly carries a trailing newline.
const rawKey = Buffer.from(keyB64.trim(), 'base64');
if (rawKey.length !== 32) {
  die(
    `BACKUP_ENCRYPTION_KEY must decode to exactly 32 bytes for AES-256-GCM, but decoded to ${rawKey.length}.\n    Generate keys with: openssl rand -base64 32`
  );
}

let stored;
try {
  stored = new Uint8Array(readFileSync(inFile));
} catch (e) {
  die(`Could not read ${inFile}: ${e.message}`);
}

const magic = Buffer.from(stored.slice(0, MAGIC_LEN)).toString('latin1');
if (magic !== MAGIC) {
  die(
    `Not an encrypted SafeSpace archive (header was "${magic}", expected "${MAGIC}").\n    If the filename ends in .zip rather than .zip.enc it is already a\n    plain ZIP — open it directly, and note that it is UNENCRYPTED.`
  );
}

const version = stored[MAGIC_LEN];
if (version !== 1) {
  die(`Unsupported container version ${version}. This script understands version 1.`);
}

if (stored.length <= HEADER_LEN + GCM_TAG_LEN) {
  die('Archive is truncated — too short to contain a complete authenticated payload.');
}

const iv = stored.slice(MAGIC_LEN + 1, HEADER_LEN);
const ciphertext = stored.slice(HEADER_LEN);

const key = await crypto.subtle.importKey('raw', rawKey, { name: 'AES-GCM' }, false, ['decrypt']);

let plaintext;
try {
  plaintext = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ciphertext);
} catch {
  // Deliberately one message for every authentication failure: a wrong
  // key and tampered bytes are not distinguishable here, and guessing
  // which it was would present a guess as a finding.
  die(
    'Authentication FAILED.\n    Either this is not the key the archive was encrypted with, or the\n    stored bytes have been altered. The archive has NOT been decrypted\n    and its contents must not be trusted.'
  );
}

writeFileSync(outFile, Buffer.from(plaintext));

const mb = (plaintext.byteLength / 1024 / 1024).toFixed(2);
console.log(`
  ✓ Decrypted and GCM tag verified.
      in :  ${inFile}
      out:  ${outFile}  (${mb} MB)

  Next — verify every member against the archive's own checksum list:
      unzip -o ${outFile} -d extracted
      cd extracted && sha256sum -c checksums.sha256

  Then read metadata/coverage-report.json to see what this archive does
  and does NOT contain. A readable ZIP is not the same as a complete
  backup.
`);

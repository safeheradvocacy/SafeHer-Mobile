#!/usr/bin/env node
/**
 * Minimal Android binary XML (AXML) decoder.
 *
 * Written for the SafeSpace security assessment to close three limitations that
 * plain string extraction could not reach: the android:allowBackup boolean,
 * android:targetSdkVersion, and the complete list of exported components.
 * Those values are stored as typed integers in the binary chunk structure, not
 * as strings, so `strings`-style scanning cannot recover them.
 *
 * Implements the subset of the format needed for AndroidManifest.xml:
 * string pool (UTF-8 and UTF-16), resource map, start/end element, attributes.
 *
 * Usage: node axml-decode.mjs <AndroidManifest.xml> [--xml]
 *        --xml  dump the reconstructed XML instead of the security summary
 */

import { readFileSync } from 'node:fs';

const RES_STRING_POOL = 0x0001;
const RES_XML_RESOURCE_MAP = 0x0180;
const RES_XML_START_ELEMENT = 0x0102;
const RES_XML_END_ELEMENT = 0x0103;

const TYPE_REFERENCE = 0x01;
const TYPE_STRING = 0x03;
const TYPE_INT_DEC = 0x10;
const TYPE_INT_HEX = 0x11;
const TYPE_INT_BOOLEAN = 0x12;

// Platform attribute resource IDs. aapt2 frequently emits an empty name string
// for framework attributes and relies on the resource map, so these are needed
// to recover the attribute name.
const ATTR_IDS = {
  0x01010001: 'label', 0x01010002: 'icon', 0x01010003: 'name',
  0x01010006: 'permission', 0x01010008: 'process', 0x0101000f: 'debuggable',
  0x01010010: 'exported', 0x01010018: 'authorities', 0x0101001d: 'enabled',
  0x01010020: 'grantUriPermissions', 0x01010021: 'priority',
  0x0101001e: 'launchMode', 0x01010022: 'description',
  0x0101020c: 'minSdkVersion', 0x01010270: 'targetSdkVersion',
  0x01010280: 'allowBackup', 0x01010392: 'usesCleartextTraffic',
  0x01010527: 'networkSecurityConfig', 0x010103af: 'supportsRtl',
  0x01010572: 'roundIcon', 0x0101054c: 'fullBackupContent',
  0x01010603: 'appComponentFactory', 0x01010004: 'theme',
  0x0101026c: 'largeHeap', 0x01010357: 'allowTaskReparenting',
  0x010102d3: 'extractNativeLibs', 0x01010000: 'testOnly',
  0x010104ea: 'requestLegacyExternalStorage', 0x01010269: 'hardwareAccelerated',
};

const file = process.argv[2];
const wantXml = process.argv.includes('--xml');
if (!file) { console.error('usage: node axml-decode.mjs <AndroidManifest.xml> [--xml]'); process.exit(1); }

const buf = readFileSync(file);
if (buf.readUInt16LE(0) !== 0x0003) {
  console.error('Not an Android binary XML file (bad magic).'); process.exit(1);
}

let strings = [];
let resourceIds = [];

// ---- walk top-level chunks -------------------------------------------------
let off = buf.readUInt16LE(2); // skip the XML chunk header
const fileSize = buf.readUInt32LE(4);

const elements = []; // flattened element stream

while (off < Math.min(fileSize, buf.length) - 8) {
  const type = buf.readUInt16LE(off);
  const headerSize = buf.readUInt16LE(off + 2);
  const size = buf.readUInt32LE(off + 4);
  if (size <= 0 || off + size > buf.length) break;

  if (type === RES_STRING_POOL) {
    strings = parseStringPool(buf, off, headerSize);
  } else if (type === RES_XML_RESOURCE_MAP) {
    const count = (size - headerSize) / 4;
    for (let i = 0; i < count; i++) resourceIds.push(buf.readUInt32LE(off + headerSize + i * 4));
  } else if (type === RES_XML_START_ELEMENT) {
    elements.push(parseStartElement(buf, off, headerSize));
  } else if (type === RES_XML_END_ELEMENT) {
    elements.push({ kind: 'end', name: str(buf.readUInt32LE(off + headerSize + 4)) });
  }
  off += size;
}

function str(i) {
  if (i === 0xffffffff || i < 0 || i >= strings.length) return null;
  return strings[i];
}

function parseStringPool(b, start, headerSize) {
  const count = b.readUInt32LE(start + 8);
  const flags = b.readUInt32LE(start + 16);
  const stringsStart = b.readUInt32LE(start + 20);
  const isUtf8 = (flags & 0x100) !== 0;
  const out = [];
  for (let i = 0; i < count; i++) {
    const strOff = start + stringsStart + b.readUInt32LE(start + headerSize + i * 4);
    try {
      if (isUtf8) {
        let p = strOff;
        // two length fields (utf16 len, then utf8 len), each 1 or 2 bytes
        let n = b.readUInt8(p); p += (n & 0x80) ? 2 : 1;
        n = b.readUInt8(p); let len = n; p += 1;
        if (n & 0x80) { len = ((n & 0x7f) << 8) | b.readUInt8(p); p += 1; }
        out.push(b.toString('utf8', p, p + len));
      } else {
        let p = strOff;
        let len = b.readUInt16LE(p); p += 2;
        if (len & 0x8000) { len = ((len & 0x7fff) << 16) | b.readUInt16LE(p); p += 2; }
        out.push(b.toString('utf16le', p, p + len * 2));
      }
    } catch { out.push(''); }
  }
  return out;
}

function parseStartElement(b, start, headerSize) {
  const name = str(b.readUInt32LE(start + headerSize + 4));
  const attrStart = b.readUInt16LE(start + headerSize + 8);
  const attrSize = b.readUInt16LE(start + headerSize + 10);
  const attrCount = b.readUInt16LE(start + headerSize + 12);
  const attrs = [];
  for (let i = 0; i < attrCount; i++) {
    const a = start + headerSize + attrStart + i * attrSize;
    const nsIdx = b.readUInt32LE(a);
    const nameIdx = b.readUInt32LE(a + 4);
    const rawIdx = b.readUInt32LE(a + 8);
    const dataType = b.readUInt8(a + 15);
    const data = b.readUInt32LE(a + 16);

    let attrName = str(nameIdx);
    if (!attrName && nameIdx < resourceIds.length) attrName = ATTR_IDS[resourceIds[nameIdx]] || null;
    if (!attrName) attrName = nameIdx < resourceIds.length
      ? `0x${resourceIds[nameIdx].toString(16)}` : `attr#${nameIdx}`;

    let value;
    switch (dataType) {
      case TYPE_STRING:    value = str(rawIdx) ?? str(data) ?? ''; break;
      case TYPE_INT_BOOLEAN: value = data !== 0; break;
      case TYPE_INT_DEC:   value = data; break;
      case TYPE_INT_HEX:   value = `0x${data.toString(16)}`; break;
      case TYPE_REFERENCE: value = `@ref/0x${data.toString(16)}`; break;
      default:             value = data;
    }
    const ns = str(nsIdx);
    attrs.push({ name: attrName, value, android: !!(ns && ns.includes('android')) });
  }
  return { kind: 'start', name, attrs };
}

// ---- output ----------------------------------------------------------------
const get = (el, n) => el.attrs.find((a) => a.name === n)?.value;

if (wantXml) {
  let depth = 0;
  for (const e of elements) {
    if (e.kind === 'end') { depth--; continue; }
    const pad = '  '.repeat(depth);
    const a = e.attrs.map((x) => ` ${x.android ? 'android:' : ''}${x.name}="${x.value}"`).join('');
    console.log(`${pad}<${e.name}${a}>`);
    depth++;
  }
  process.exit(0);
}

const starts = elements.filter((e) => e.kind === 'start');
const app = starts.find((e) => e.name === 'application');
const usesSdk = starts.find((e) => e.name === 'uses-sdk');
const manifest = starts.find((e) => e.name === 'manifest');

const show = (label, v) => {
  const printed = v === undefined ? 'not declared (framework default applies)' : String(v);
  console.log(`  ${label.padEnd(26)} ${printed}`);
};

console.log('\n=== AndroidManifest.xml — decoded security properties ===\n');
console.log(`  strings in pool            ${strings.length}`);
console.log(`  elements parsed            ${starts.length}`);
console.log(`  package                    ${manifest ? get(manifest, 'package') ?? '(via resource)' : '?'}\n`);

console.log('--- Application flags ---');
show('android:debuggable', app ? get(app, 'debuggable') : undefined);
show('android:allowBackup', app ? get(app, 'allowBackup') : undefined);
show('android:usesCleartextTraffic', app ? get(app, 'usesCleartextTraffic') : undefined);
show('android:networkSecurityConfig', app ? get(app, 'networkSecurityConfig') : undefined);
show('android:testOnly', app ? get(app, 'testOnly') : undefined);
show('android:fullBackupContent', app ? get(app, 'fullBackupContent') : undefined);

console.log('\n--- SDK levels ---');
show('android:minSdkVersion', usesSdk ? get(usesSdk, 'minSdkVersion') : undefined);
show('android:targetSdkVersion', usesSdk ? get(usesSdk, 'targetSdkVersion') : undefined);

console.log('\n--- Permissions declared ---');
const perms = starts.filter((e) => e.name === 'uses-permission').map((e) => get(e, 'name')).filter(Boolean).sort();
console.log(`  ${perms.length} total`);
perms.forEach((p) => console.log(`    ${p}`));

console.log('\n--- Exported components ---');
const COMPONENTS = ['activity', 'activity-alias', 'service', 'receiver', 'provider'];
let exportedCount = 0, unguarded = 0;
for (const kind of COMPONENTS) {
  const list = starts.filter((e) => e.name === kind);
  const exported = list.filter((e) => get(e, 'exported') === true);
  if (list.length === 0) continue;
  console.log(`  ${kind}: ${list.length} declared, ${exported.length} exported`);
  for (const e of exported) {
    exportedCount++;
    const perm = get(e, 'permission');
    if (!perm) unguarded++;
    console.log(`     ${get(e, 'name') ?? '(unnamed)'}${perm ? `   [permission: ${perm}]` : '   [no permission guard]'}`);
  }
}
console.log(`\n  exported total: ${exportedCount}   without a permission guard: ${unguarded}`);
console.log('');

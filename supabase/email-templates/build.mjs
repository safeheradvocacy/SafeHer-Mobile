// Generates the final, pasteable HTML (and a .txt reference copy) for
// every Supabase Auth email template in this directory. Run with:
//   node supabase/email-templates/build.mjs
//
// Output goes to supabase/email-templates/dist/<name>.html and
// <name>.txt. The .html file is what gets pasted into Supabase
// Dashboard -> Authentication -> Email Templates -> <slot> -> Source;
// the .txt file has no corresponding dashboard field (see README.md)
// but is kept as the documented plain-text equivalent.
import { writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import * as confirmSignup from './confirmSignup.mjs';
import * as resetPassword from './resetPassword.mjs';
import * as securityCode from './securityCode.mjs';
import * as changeEmail from './changeEmail.mjs';

const TEMPLATES = { confirmSignup, resetPassword, securityCode, changeEmail };

const here = dirname(fileURLToPath(import.meta.url));
const distDir = join(here, 'dist');
mkdirSync(distDir, { recursive: true });

for (const [name, mod] of Object.entries(TEMPLATES)) {
  writeFileSync(join(distDir, `${name}.html`), mod.html, 'utf8');
  writeFileSync(join(distDir, `${name}.txt`), mod.text, 'utf8');
  console.log(`Built ${name}: subject="${mod.subject}" (${mod.html.length} bytes HTML)`);
}

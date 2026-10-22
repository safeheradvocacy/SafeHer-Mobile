/** Shared numeric/phone input helpers (Requirement 1) — mirrors
 * mobile/src/lib/numericInput.ts exactly (separate repos, same rule).
 * Filtering at keystroke time is level 1 of the three-level validation
 * the brief asks for (filter -> form-level check -> server/DB
 * constraint). */

/** Philippine mobile number: 09XXXXXXXXX (11 digits, leading zero
 * preserved) or +639XXXXXXXX (country code form). */
export const PH_PHONE_RE = /^(09\d{9}|\+639\d{9})$/;

/** Strips everything except digits and (only when it's the very first
 * character typed) a leading '+'. */
export function sanitizePhoneInput(raw: string): string {
  const plus = raw.startsWith('+') ? '+' : '';
  return plus + raw.slice(plus.length).replace(/\D/g, '');
}

/** Strips everything except 0-9 — for whole-number counts. A decimal
 * point or minus sign is never even enterable. */
export function sanitizeDigitsOnly(raw: string): string {
  return raw.replace(/\D/g, '');
}

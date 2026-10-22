/** Shared numeric/phone input helpers (Requirement 1) — filtering at
 * keystroke time is level 1 of the three-level validation the brief
 * asks for (filter -> form-level check -> server/DB constraint); this
 * file is purely level 1, applied via each field's onChangeText. */

/** Philippine mobile number: 09XXXXXXXXX (11 digits, leading zero
 * preserved) or +639XXXXXXXX (country code form). Canonical copy of
 * what ProfileScreen already used locally — moved here so every phone
 * field in the app validates against the exact same rule. */
export const PH_PHONE_RE = /^(09\d{9}|\+639\d{9})$/;

/** Strips everything except digits and (only when it's the very first
 * character typed) a leading '+' — so "+639..." stays possible while a
 * '+' typed anywhere else in the string is dropped, and pasting
 * something like "09abc1234567" keeps only the digits, never
 * silently drops/reorders the ones that ARE valid. */
export function sanitizePhoneInput(raw: string): string {
  const plus = raw.startsWith('+') ? '+' : '';
  return plus + raw.slice(plus.length).replace(/\D/g, '');
}

/** Strips everything except 0-9 — for whole-number counts (people,
 * children, age, postal code). A decimal point or minus sign is never
 * even enterable, which is a stronger guarantee than rejecting them
 * after the fact. */
export function sanitizeDigitsOnly(raw: string): string {
  return raw.replace(/\D/g, '');
}

/** Parses an already-digits-only string into a whole-number count, or
 * null if empty/invalid. Since sanitizeDigitsOnly already prevents a
 * decimal point or minus sign from ever being entered, this never
 * silently truncates a decimal — there is nothing but digits to parse. */
export function parseWholeCount(raw: string): number | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  if (!/^\d+$/.test(trimmed)) return null;
  const n = Number(trimmed);
  return Number.isFinite(n) ? n : null;
}

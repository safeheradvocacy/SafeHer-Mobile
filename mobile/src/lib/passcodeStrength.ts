/**
 * Heuristic strength estimator for the SafeSpace security passcode.
 *
 * Not a full zxcvbn-equivalent — this project has no password-strength
 * library installed today (confirmed: grepped package.json), and pulling
 * in zxcvbn's ~400-800KB frequency-dictionary payload into a mobile bundle
 * without a device available in this environment to verify it actually
 * bundles/runs cleanly end-to-end felt like the wrong risk to take for
 * this pass. This is a deliberately conservative, explainable heuristic
 * instead: length + character variety + repetition/sequence detection +
 * a small common-passcode blocklist. It is NOT "uppercase/lowercase/
 * number/symbol rule counting" alone — see evaluate() below for exactly
 * what it checks and why. If a reputable estimator is added to this
 * project later, swap this file's internals; everything that imports
 * `evaluate`/`PasscodeStrength` from here does not need to change.
 */

export type PasscodeStrengthLevel = 'weak' | 'fair' | 'good' | 'strong';

export interface PasscodeStrengthResult {
  level: PasscodeStrengthLevel;
  score: number; // 0-4, internal — drives `level`, not shown directly
  suggestions: string[];
  /** Whether this passcode meets the minimum bar to be ENROLLABLE at all
   * (separate from the display `level` — a passcode can be "Fair" and
   * still allowed, but a passcode below the floor is always blocked
   * regardless of level). */
  meetsMinimum: boolean;
}

const MIN_LENGTH = 8;
const RECOMMENDED_LENGTH = 12;

// Small, deliberately short blocklist of the most predictable passcodes —
// not a breach-corpus lookup (no network call, no third-party service —
// this project has no existing integration for one, and this audit
// didn't want to invent a new external dependency for it). Checked as
// case-insensitive substrings/prefixes, not just exact matches.
const COMMON_WEAK = [
  'password', 'passcode', '12345678', '123456789', '1234567890',
  'qwertyui', 'qwerty123', 'letmein', 'iloveyou', 'abc12345',
  'admin123', 'welcome1', 'changeme', '11111111', '00000000',
  'safespace', 'safeher',
];

const SEQUENTIAL_RUNS = ['0123456789', 'abcdefghijklmnopqrstuvwxyz', 'qwertyuiop', 'asdfghjkl', 'zxcvbnm'];

function hasLongRepeat(s: string): boolean {
  // 4+ identical characters in a row (e.g. "aaaa", "1111").
  return /(.)\1{3,}/.test(s);
}

function hasSequentialRun(s: string, minRun = 4): boolean {
  const lower = s.toLowerCase();
  for (const run of SEQUENTIAL_RUNS) {
    for (let i = 0; i <= run.length - minRun; i++) {
      const fwd = run.slice(i, i + minRun);
      const rev = [...fwd].reverse().join('');
      if (lower.includes(fwd) || lower.includes(rev)) return true;
    }
  }
  return false;
}

function characterVarietyCount(s: string): number {
  let classes = 0;
  if (/[a-z]/.test(s)) classes++;
  if (/[A-Z]/.test(s)) classes++;
  if (/[0-9]/.test(s)) classes++;
  if (/[^a-zA-Z0-9]/.test(s)) classes++;
  return classes;
}

export function evaluate(passcode: string): PasscodeStrengthResult {
  const suggestions: string[] = [];
  const trimmed = passcode; // intentionally not trimmed — leading/trailing
  // whitespace is part of what the user typed and part of what they'd
  // need to re-type to verify, so silently altering it would be its own
  // bug (a passcode that "matched" at enrollment failing to verify later
  // because whitespace got stripped differently somewhere).

  const meetsMinimum = trimmed.length >= MIN_LENGTH && !/^(.)\1+$/.test(trimmed);

  if (trimmed.length === 0) {
    return { level: 'weak', score: 0, suggestions: ['Enter a passcode.'], meetsMinimum: false };
  }
  if (trimmed.length < MIN_LENGTH) {
    suggestions.push(`Use at least ${MIN_LENGTH} characters.`);
  } else if (trimmed.length < RECOMMENDED_LENGTH) {
    suggestions.push(`${RECOMMENDED_LENGTH} or more characters is stronger.`);
  }

  const lower = trimmed.toLowerCase();
  const isCommon = COMMON_WEAK.some((w) => lower === w || lower.startsWith(w) || lower.includes(w));
  if (isCommon) {
    suggestions.push('Avoid common words or predictable passcodes.');
  }

  const longRepeat = hasLongRepeat(trimmed);
  if (longRepeat) {
    suggestions.push('Avoid repeating the same character many times in a row.');
  }

  const sequential = hasSequentialRun(trimmed);
  if (sequential) {
    suggestions.push('Avoid simple sequences like "1234" or "abcd".');
  }

  const variety = characterVarietyCount(trimmed);
  if (variety < 2) {
    suggestions.push('Mix letters with numbers or symbols.');
  }

  // Score 0-4, deliberately penalized hard for the "looks random but
  // isn't" cases (common/repeat/sequential) rather than purely rewarding
  // raw length+variety, since a long sequential run can otherwise score
  // deceptively high.
  let score = 0;
  if (trimmed.length >= MIN_LENGTH) score += 1;
  if (trimmed.length >= RECOMMENDED_LENGTH) score += 1;
  if (variety >= 3) score += 1;
  if (!isCommon && !longRepeat && !sequential) score += 1;
  if (isCommon || longRepeat) score = Math.min(score, 1);
  else if (sequential) score = Math.min(score, 2);
  score = Math.max(0, Math.min(4, score));

  const level: PasscodeStrengthLevel = score <= 1 ? 'weak' : score === 2 ? 'fair' : score === 3 ? 'good' : 'strong';

  if (suggestions.length === 0 && level !== 'strong') {
    suggestions.push('Add a few more characters for a stronger passcode.');
  }

  return { level, score, suggestions, meetsMinimum: meetsMinimum && !isCommon };
}

export const PASSCODE_MIN_LENGTH = MIN_LENGTH;
export const PASSCODE_RECOMMENDED_LENGTH = RECOMMENDED_LENGTH;

export function passcodesMatch(a: string, b: string): boolean {
  return a.length > 0 && a === b;
}

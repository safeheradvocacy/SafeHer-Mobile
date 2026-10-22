/** Shared name-composition utility (module39) — the one place that
 * turns separate First/Middle/Last/Suffix parts into a single display
 * string, so every admin screen composes it the same way instead of
 * each inlining its own `${first} ${last}` interpolation. Mirrors
 * mobile/src/lib/personName.ts exactly (separate repos, same rule). */
export type NameParts = {
  first_name?: string | null;
  middle_name?: string | null;
  last_name?: string | null;
  suffix?: string | null;
};

export function formatFullName(parts: NameParts): string {
  const { first_name, middle_name, last_name, suffix } = parts;
  const base = [first_name, middle_name, last_name].filter((p) => !!p && p.trim().length > 0).join(' ');
  return suffix && suffix.trim().length > 0 ? `${base} ${suffix.trim()}` : base;
}

export const SUFFIX_OPTIONS = ['Jr.', 'Sr.', 'II', 'III', 'IV'] as const;

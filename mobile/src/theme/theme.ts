// SafeSpace mobile design tokens — government-blue system, matching the
// admin portal's palette (admin/src/theme/theme.css) so both apps read
// as one product. Calm-first intent is preserved from the prior
// "Serene Sanctuary" system — only the hue family changed, not the
// restraint principles (muted semantic colors, no neon/saturated fills).

export const colors = {
  background: '#F5F7FA',
  surface: '#FFFFFF',
  surfaceMuted: '#F5F9FD',
  primary: '#1456A0',
  primaryDark: '#0B3A82',
  primaryLight: '#EAF3FB',
  accent: '#2F80C9',
  pinkAccent: '#C95B91', // same hex as the admin web app's --color-accent-pink, for cross-platform consistency
  text: '#172033',
  textMuted: '#526070',
  border: '#D9E2EC',
  danger: '#D94B63', // used sparingly — SOS only
  dangerDark: '#AD3549',
  warning: '#D98A24',
  success: '#4D9272',
  info: '#4C82B3',
  white: '#FFFFFF',
} as const;

export const statusColors: Record<string, string> = {
  Pending: '#D98A24',
  'Under Review': '#4C82B3',
  Assigned: '#1456A0',
  'In Progress': '#4C82B3',
  Referred: '#2F80C9',
  Resolved: '#4D9272',
  Closed: '#526070',
  // case_services statuses (module22) — only 'Provided' is success-green;
  // everything else before it reads as pending/in-progress, not done.
  Requested: '#D98A24',
  Scheduled: '#4C82B3',
  Provided: '#4D9272',
  Cancelled: '#526070',
  'Unable to Provide': '#D94B63',
  Low: '#4D9272',
  Medium: '#D98A24',
  High: '#D94B63',
  Critical: '#AD3549',
  Triggered: '#D94B63',
  Responding: '#D98A24',
  Pending_referral: '#D98A24',
  Accepted: '#4D9272',
  Declined: '#526070',
  Completed: '#4D9272',
  Verified: '#4D9272',
  'Pending Review': '#D98A24',
  'Not Verified': '#526070',
  Rejected: '#D94B63',

  // module28 — announcement lifecycle + priority. 'Scheduled' above is
  // reused as-is.
  Draft: '#526070',
  Published: '#4D9272',
  Expired: '#526070',
  Archived: '#526070',
  Unpublished: '#D98A24',
  Normal: '#526070',
  Important: '#D98A24',
  Urgent: '#D94B63',
};

export const typography = {
  display: { fontFamily: 'PlusJakartaSans_700Bold', fontSize: 28, lineHeight: 34 },
  heading: { fontFamily: 'PlusJakartaSans_600SemiBold', fontSize: 20, lineHeight: 26 },
  subheading: { fontFamily: 'PlusJakartaSans_600SemiBold', fontSize: 16, lineHeight: 22 },
  body: { fontFamily: 'Inter_400Regular', fontSize: 15, lineHeight: 22 },
  bodyMedium: { fontFamily: 'Inter_500Medium', fontSize: 15, lineHeight: 22 },
  caption: { fontFamily: 'Inter_400Regular', fontSize: 13, lineHeight: 18 },
  button: { fontFamily: 'PlusJakartaSans_600SemiBold', fontSize: 16, lineHeight: 20 },
} as const;

export const spacing = { xs: 4, sm: 8, md: 16, lg: 24, xl: 32, xxl: 48 } as const;

// `button` is deliberately NOT `pill` — a fully stadium-shaped button on
// every screen reads as generic/AI-templated. Moderate rounding (roughly
// a quarter of the button's height) still feels friendly and tappable
// without every control on the app looking identical in silhouette.
// `pill` stays available for things that should genuinely be pill-shaped
// (badges, dots).
export const radius = { sm: 8, md: 14, lg: 20, button: 14, pill: 999 } as const;

// Consistent elevation — three tiers used across every card/button/sheet
// so depth reads the same everywhere instead of being hand-tuned per
// screen. Intensities trimmed ~25% from the prior system for a flatter,
// more institutional feel ("refined, not heavily 3D") — same tiers, same
// call sites, just less shadow.
export const shadows = {
  sm: {
    shadowColor: colors.primaryDark,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 5,
    elevation: 2,
  },
  md: {
    shadowColor: colors.primaryDark,
    shadowOffset: { width: 0, height: 5 },
    shadowOpacity: 0.11,
    shadowRadius: 12,
    elevation: 4,
  },
  lg: {
    shadowColor: colors.primaryDark,
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.17,
    shadowRadius: 18,
    elevation: 7,
  },
} as const;

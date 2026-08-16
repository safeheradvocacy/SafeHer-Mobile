// SafeHer mobile design tokens — "Serene Sanctuary" system
// (violet/cream palette, trauma-informed, calm-first)

export const colors = {
  background: '#FBF9F6',
  surface: '#FFFFFF',
  surfaceMuted: '#F3EFE9',
  primary: '#6C5CA6', // violet
  primaryDark: '#514080',
  primaryLight: '#E7E1F5',
  accent: '#B79CED',
  text: '#2B2530',
  textMuted: '#6E6577',
  border: '#E4DFD6',
  danger: '#C4485B', // used sparingly — SOS only
  dangerDark: '#9C2F41',
  warning: '#C98A3B',
  success: '#4A8C6F',
  info: '#4C7EA8',
  white: '#FFFFFF',
} as const;

export const statusColors: Record<string, string> = {
  Pending: '#C98A3B',
  'Under Review': '#4C7EA8',
  Assigned: '#6C5CA6',
  'In Progress': '#4C7EA8',
  Referred: '#B79CED',
  Resolved: '#4A8C6F',
  Closed: '#6E6577',
  Low: '#4A8C6F',
  Medium: '#C98A3B',
  High: '#C4485B',
  Critical: '#9C2F41',
  Triggered: '#C4485B',
  Responding: '#C98A3B',
  Pending_referral: '#C98A3B',
  Accepted: '#4A8C6F',
  Declined: '#6E6577',
  Completed: '#4A8C6F',
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

export const radius = { sm: 8, md: 14, lg: 20, pill: 999 } as const;

// Consistent elevation — three tiers used across every card/button/sheet
// so depth reads the same everywhere instead of being hand-tuned per screen.
export const shadows = {
  sm: {
    shadowColor: colors.primaryDark,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 6,
    elevation: 2,
  },
  md: {
    shadowColor: colors.primaryDark,
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.14,
    shadowRadius: 14,
    elevation: 5,
  },
  lg: {
    shadowColor: colors.primaryDark,
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.22,
    shadowRadius: 22,
    elevation: 9,
  },
} as const;

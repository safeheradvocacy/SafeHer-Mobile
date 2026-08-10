
export const colors = {
  // Surfaces
  surface: '#FBF9F8',
  surfaceDim: '#DBD9D9',
  surfaceBright: '#FBF9F8',
  surfaceContainerLowest: '#FFFFFF',
  surfaceContainerLow: '#F5F3F3',
  surfaceContainer: '#EFEDED',
  surfaceContainerHigh: '#EAE8E7',
  surfaceContainerHighest: '#E4E2E2',

  // Text on surfaces
  onSurface: '#1B1C1C',
  onSurfaceVariant: '#484555',
  inverseSurface: '#303030',
  inverseOnSurface: '#F2F0F0',

  // Outlines
  outline: '#797586',
  outlineVariant: '#CAC4D7',

  // Brand / primary
  surfaceTint: '#613EDE',
  primary: '#5F3BDC',
  onPrimary: '#FFFFFF',
  primaryContainer: '#7858F6',
  onPrimaryContainer: '#FFFBFF',
  inversePrimary: '#CABEFF',

  // Gradient used on primary buttons & hero accents (top-left -> bottom-right)
  gradientStart: '#7C5CFA',
  gradientEnd: '#5B3FD6',

  // Secondary (warm beige family)
  secondary: '#725A42',
  onSecondary: '#FFFFFF',
  secondaryContainer: '#FFDCBF',
  onSecondaryContainer: '#796048',
  warmBeige: '#F5EBDD',
  lightBrownBorder: '#D8B89C',

  // Tertiary
  tertiary: '#5B3FD6',
  onTertiary: '#FFFFFF',
  tertiaryContainer: '#745BF0',
  onTertiaryContainer: '#FFFBFF',

  // Status
  error: '#BA1A1A',
  onError: '#FFFFFF',
  errorContainer: '#FFDAD6',
  onErrorContainer: '#93000A',
  success: '#2E7D32',
  successContainer: '#E3F3E4',
  warning: '#B45309',

  // Backgrounds
  background: '#FBF9F8',
  onBackground: '#1B1C1C',
  surfaceVariant: '#E4E2E2',

  // Decorative
  softLavender: '#F3EEFF',
  cream: '#FCFAF8',

  // Utility
  white: '#FFFFFF',
  transparent: 'transparent',
  shadowTint: 'rgba(124, 92, 250, 0.16)',

  // Brand mark colors — sampled directly from the SafeHer logo artwork
  // (assets/images/safeher-logo.png), distinct from `gradientStart/End`
  // above (which is the flatter violet used on everyday buttons). Reserved
  // for brand moments — splash, letterhead-style headers — where we want
  // the exact mark colors.
  brandIndigo: '#2D1B8C',
  brandViolet: '#6B3FC2',
  brandPink: '#E24FAE',
} as const;

export const fontFamily = {
  headingBold: 'PlusJakartaSans_700Bold',
  headingSemiBold: 'PlusJakartaSans_600SemiBold',
  body: 'Inter_400Regular',
  bodyMedium: 'Inter_500Medium',
  bodySemiBold: 'Inter_600SemiBold',
} as const;

export const typography = {
  displayLg: { fontFamily: fontFamily.headingBold, fontSize: 32, lineHeight: 40, letterSpacing: -0.4 },
  headlineLg: { fontFamily: fontFamily.headingBold, fontSize: 24, lineHeight: 32 },
  headlineLgMobile: { fontFamily: fontFamily.headingBold, fontSize: 22, lineHeight: 28 },
  headlineMd: { fontFamily: fontFamily.headingSemiBold, fontSize: 20, lineHeight: 28 },
  bodyLg: { fontFamily: fontFamily.body, fontSize: 18, lineHeight: 28 },
  bodyMd: { fontFamily: fontFamily.body, fontSize: 16, lineHeight: 24 },
  bodySm: { fontFamily: fontFamily.body, fontSize: 14, lineHeight: 20 },
  labelLg: { fontFamily: fontFamily.bodySemiBold, fontSize: 14, lineHeight: 20, letterSpacing: 0.14 },
  labelSm: { fontFamily: fontFamily.bodyMedium, fontSize: 12, lineHeight: 16 },
} as const;

export const spacing = {
  baseUnit: 8,
  marginMobile: 24,
  gutterMd: 16,
  stackSm: 8,
  stackMd: 16,
  stackLg: 32,
  sectionPadding: 40,
} as const;

export const radii = {
  sm: 4,
  md: 12,
  lg: 16,
  xl: 24,
  button: 20,
  full: 9999,
} as const;

export const shadows = {
  card: {
    shadowColor: colors.primary,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.08,
    shadowRadius: 20,
    elevation: 4,
  },
  button: {
    shadowColor: colors.primary,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.24,
    shadowRadius: 12,
    elevation: 6,
  },
} as const;

export const theme = { colors, fontFamily, typography, spacing, radii, shadows };
export type Theme = typeof theme;
export default theme;

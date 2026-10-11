import type { IoniconName } from '../../components/ui';
import type { AppLanguage } from '../../lib/preferences';
import type { ClayPalette } from '../../theme/clay';

export type FeatureKey = 'privacy' | 'emergency' | 'case';

export interface FeatureMeta {
  key: FeatureKey;
  icon: IoniconName;
}

// Icons/colors are language-independent; resolved against the palette
// the same way onboarding's slide tints are (see getFeatureTint below).
export const FEATURE_META: FeatureMeta[] = [
  { key: 'privacy', icon: 'lock-closed' },
  { key: 'emergency', icon: 'alert-circle' },
  { key: 'case', icon: 'document-text' },
];

interface WelcomeStrings {
  heroTagline: string;
  headline: string;
  supporting: string;
  howWeCanHelp: string;
  features: Record<FeatureKey, { title: string; short: string; detail: string }>;
  emergencyTitle: string;
  emergencyBody: string;
  emergencySheetTitle: string;
  emergencySheetCall: string;
  emergencySheetCallDesc: string;
  emergencySheetAppNote: string;
  createAccount: string;
  logIn: string;
  privacyTitle: string;
  privacyBody: string;
  settingsTitle: string;
}

// Same caveat as onboardingContent.ts: the Filipino copy here is
// written directly, not machine-translated, but hasn't been reviewed by
// a native speaker — worth that pass before this reaches real users.
const STRINGS: Record<AppLanguage, WelcomeStrings> = {
  en: {
    heroTagline: 'Support when you need it.',
    headline: "You're safe here.",
    supporting: 'Private support. Emergency help. Case tracking.',
    howWeCanHelp: 'How we can help',
    features: {
      privacy: {
        title: 'Private & Confidential',
        short: 'Your information stays protected.',
        detail: 'Your personal information is handled securely and accessed only as needed for support.',
      },
      emergency: {
        title: 'Emergency Support',
        short: 'Get help when you need it.',
        detail: 'Access emergency assistance when you need immediate help.',
      },
      case: {
        title: 'Case Support',
        short: 'Manage your requests and support.',
        detail: 'Track your submitted requests and available support.',
      },
    },
    emergencyTitle: 'Need help now?',
    emergencyBody: 'In immediate danger? Call 911.',
    emergencySheetTitle: 'Emergency Help',
    emergencySheetCall: 'Call 911',
    emergencySheetCallDesc: 'For immediate danger, contact emergency services directly.',
    emergencySheetAppNote:
      "SafeSpace doesn't replace emergency services. Create an account to access confidential SOS alerts and support once you're safe.",
    createAccount: 'Create an account',
    logIn: 'Log in',
    privacyTitle: 'Your privacy comes first.',
    privacyBody: 'Your information is handled securely.',
    settingsTitle: 'Settings',
  },
  fil: {
    heroTagline: 'Suporta kapag kailangan mo.',
    headline: 'Ligtas ka rito.',
    supporting: 'Kumpidensyal na suporta. Tulong pang-emergency. Pagsubaybay ng kaso.',
    howWeCanHelp: 'Paano kami makakatulong',
    features: {
      privacy: {
        title: 'Pribado at Kumpidensyal',
        short: 'Protektado ang iyong impormasyon.',
        detail: 'Ligtas na hinahawakan ang iyong personal na impormasyon at ginagamit lamang kung kinakailangan para sa suporta.',
      },
      emergency: {
        title: 'Suportang Pang-emergency',
        short: 'Makakuha ng tulong kapag kailangan mo.',
        detail: 'Ma-access ang tulong pang-emergency kapag kailangan mo agad.',
      },
      case: {
        title: 'Suporta sa Kaso',
        short: 'Pamahalaan ang iyong mga request at suporta.',
        detail: 'Subaybayan ang iyong mga naisumiteng kahilingan at magagamit na suporta.',
      },
    },
    emergencyTitle: 'Kailangan mo ba ng tulong ngayon?',
    emergencyBody: 'Nasa agarang panganib? Tumawag sa 911.',
    emergencySheetTitle: 'Tulong Pang-emergency',
    emergencySheetCall: 'Tumawag sa 911',
    emergencySheetCallDesc: 'Para sa agarang panganib, direktang makipag-ugnayan sa emergency services.',
    emergencySheetAppNote:
      'Hindi kapalit ng emergency services ang SafeSpace. Gumawa ng account para ma-access ang kumpidensyal na SOS alerts at suporta kapag ligtas ka na.',
    createAccount: 'Gumawa ng account',
    logIn: 'Mag-log in',
    privacyTitle: 'Una ang iyong privacy.',
    privacyBody: 'Ligtas na hinahawakan ang iyong impormasyon.',
    settingsTitle: 'Mga Setting',
  },
};

export function getWelcomeStrings(lang: AppLanguage): WelcomeStrings {
  return STRINGS[lang];
}

// "Case Support" reuses the same pink accent as onboarding's "Track Your
// Case" slide — same underlying concept, same color, across screens.
export function getFeatureTint(key: FeatureKey, palette: ClayPalette): string {
  if (key === 'privacy') return palette.primary;
  if (key === 'emergency') return palette.danger;
  return palette.pinkAccent;
}

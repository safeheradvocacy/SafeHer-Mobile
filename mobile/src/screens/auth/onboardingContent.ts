import type { IoniconName } from '../../components/ui';
import type { ClayPalette } from '../../theme/clay';
import type { AppLanguage } from '../../lib/preferences';

// Re-exported under its original name so existing imports elsewhere in
// this screen keep working — the underlying type now lives in
// lib/preferences.ts since Welcome shares the same language preference.
export type OnboardingLanguage = AppLanguage;

export type SlideKey = 'sos' | 'report' | 'track';

interface SlideCopy {
  title: string;
  body: string;
}

interface OnboardingStrings {
  skip: string;
  settingsTitle: string;
  next: string;
  getStarted: string;
  back: string;
  skipConfirmTitle: string;
  skipConfirmBody: string;
  skipConfirmContinue: string;
  skipConfirmSkip: string;
  timelineSteps: [string, string, string];
  slides: Record<SlideKey, SlideCopy>;
}

// Filipino/Tagalog copy for these ~12 short, common strings — not run
// through a translation API, written directly. Good enough to ship as a
// real, working language option, but worth a native-speaker review
// before this reaches production, the same bar any user-facing
// translation should clear.
const STRINGS: Record<OnboardingLanguage, OnboardingStrings> = {
  en: {
    skip: 'Skip',
    settingsTitle: 'Onboarding settings',
    next: 'Next',
    getStarted: 'Get Started',
    back: 'Back',
    skipConfirmTitle: 'Skip onboarding?',
    skipConfirmBody: "You can explore SafeSpace's features later.",
    skipConfirmContinue: 'Continue',
    skipConfirmSkip: 'Skip',
    timelineSteps: ['Submitted', 'In Progress', 'Resolved'],
    slides: {
      sos: {
        title: 'Emergency SOS',
        body: 'Get help when you need it.',
      },
      report: {
        title: 'Report Safely',
        body: 'Share incidents securely.',
      },
      track: {
        title: 'Track Your Case',
        body: 'Stay updated on your support.',
      },
    },
  },
  fil: {
    skip: 'Laktawan',
    settingsTitle: 'Mga setting',
    next: 'Susunod',
    getStarted: 'Magsimula',
    back: 'Bumalik',
    skipConfirmTitle: 'Laktawan ang onboarding?',
    skipConfirmBody: 'Maaari mong tuklasin ang mga feature ng SafeSpace sa ibang pagkakataon.',
    skipConfirmContinue: 'Ituloy',
    skipConfirmSkip: 'Laktawan',
    timelineSteps: ['Naisumite', 'Isinasagawa', 'Nalutas'],
    slides: {
      sos: {
        title: 'Emergency SOS',
        body: 'Makakuha ng tulong kapag kailangan mo.',
      },
      report: {
        title: 'Mag-ulat nang Ligtas',
        body: 'Ligtas na ibahagi ang insidente.',
      },
      track: {
        title: 'Subaybayan ang Kaso',
        body: 'Manatiling updated sa iyong suporta.',
      },
    },
  },
};

export function getOnboardingStrings(lang: OnboardingLanguage): OnboardingStrings {
  return STRINGS[lang];
}

export interface SlideMeta {
  key: SlideKey;
  icon: IoniconName;
  badgeIcon: IoniconName;
  visualLabel: string;
}

// Non-text slide metadata (icons/labels) — language-independent, so kept
// separate from the copy strings above. Tint colors are deliberately
// NOT baked in here: they need to resolve against whichever palette
// (light/dark) is active, so getSlideTint() below reads them from a
// palette object at render time instead.
export const SLIDE_META: SlideMeta[] = [
  {
    key: 'sos',
    icon: 'alert-circle',
    badgeIcon: 'shield-checkmark',
    visualLabel: 'Emergency SOS feature illustration.',
  },
  {
    key: 'report',
    icon: 'document-text',
    badgeIcon: 'lock-closed',
    visualLabel: 'Secure incident reporting feature illustration.',
  },
  {
    key: 'track',
    icon: 'clipboard',
    badgeIcon: 'trending-up',
    visualLabel: 'Case tracking feature illustration.',
  },
];

export function getSlideTint(key: SlideKey, palette: ClayPalette): string {
  if (key === 'sos') return palette.danger;
  if (key === 'report') return palette.primary;
  return palette.pinkAccent;
}

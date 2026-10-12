// SafeSpace transactional email — shared brand tokens.
//
// Every value below is taken from the project's REAL, existing design
// system (admin/src/theme/theme.css's :root tokens and admin/src/
// components/branding/Logo.tsx's actual wordmark colors) — not invented
// for this file. Confirmed by direct inspection before writing this:
//   --color-primary:      #1456A0  (theme.css line 17)
//   --color-primary-dark: #0B3A82  (theme.css line 19)  == LogoLockup's "Safe"
//   --color-bg:           #F5F7FA  (theme.css line 14)
//   --color-text:         #172033  (theme.css line 22)
//   --color-text-muted:   #526070  (theme.css line 23)
//   --color-border:       #D9E2EC  (theme.css line 25)
//   --color-surface:      #FFFFFF  (theme.css line 15)
//   accent blue #2F80C9 == LogoLockup's "Space"
// "Light blue surface" (#EAF3FB) and secondary blue (#1E6BB8) are not
// existing CSS variables, but match this exact palette family — used
// only for the email-specific light-tint backgrounds (OTP code box,
// security notice) that the admin app itself doesn't need.
export const COLORS = {
  primary: '#1456A0',
  primaryDark: '#0B3A82',
  secondaryBlue: '#1E6BB8',
  accentBlue: '#2F80C9',
  lightSurface: '#EAF3FB',
  background: '#F5F7FA',
  text: '#172033',
  textMuted: '#526070',
  border: '#D9E2EC',
  white: '#FFFFFF',
};

export const PRODUCT_NAME = 'SafeSpace';
export const PRODUCT_DESCRIPTOR = 'SafeSpace — Abuse Support, Protection, and Referral Platform';

// No configured, monitored support mailbox exists anywhere in this
// project (verified by search — no support@/contact@ address is
// referenced in either app). The one real, verified channel a
// signed-in user can reach is the in-app Support chat
// (SafeHerAssistantScreen, user-facing label "SafeSpace Support
// Expert") — the footer points there instead of inventing an email
// address or implying this message's own sender is monitored.
export const SUPPORT_LINE = 'Need help? Open SafeSpace and use Support chat, or contact your SafeSpace administrator.';

export const EMAIL_WIDTH = 600;

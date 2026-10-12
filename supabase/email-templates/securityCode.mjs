// Supabase Auth dashboard slot: Authentication -> Email Templates -> "Magic Link"
//
// REAL FLOW (verified before writing this): mobile's ChangePasswordScreen
// calls sendPasswordChangeOtp() (AuthContext.tsx), which is documented
// there as reusing signInWithOtp()+verifyOtp() deliberately "rather than
// a separate/uncertain 'reauthenticate' API surface" — i.e. this app
// never calls supabase.auth.reauthenticate(), so Supabase's own separate
// "Reauthentication" template slot is NOT what fires here. signInWithOtp()
// sends Supabase's "Magic Link" template, which also exposes {{ .Token }}
// for OTP-style delivery. This app only ever consumes the 8-digit code
// (same OtpInput component/length as signup) — never the magic-link
// click-to-sign-in path — so, like confirmSignup.mjs, this template
// shows ONLY the code, never a "sign in" button that would be misleading
// (clicking it wouldn't do anything meaningful for this mobile-only flow).
//
// Named for what it actually does in this product ("Your SafeSpace
// security code"), not "Magic Link" — the subject a user sees should
// describe the real action (confirming identity before a sensitive
// change), not Supabase's internal template name for the mechanism.
import { renderEmailLayout, renderPlainText } from './_shared/emailLayout.mjs';

export const subject = 'Your SafeSpace security code';

export const html = renderEmailLayout({
  previewText: 'Use this code to confirm it’s you.',
  heading: 'Confirm it’s you',
  bodyHtml: `
    <p style="margin: 0 0 16px;">Use this code to confirm it's really you before completing a sensitive change to your SafeSpace account.</p>
  `,
  code: { label: 'Your security code', value: '{{ .Token }}' },
  expiryText: 'This code will expire shortly after it was sent — if it no longer works, request a new one from the app.',
  securityNoticeHtml: 'If you did not request this, you can ignore this email. No change will be made to your account unless this code is entered.',
});

export const text = renderPlainText({
  heading: 'Confirm it’s you',
  bodyLines: [
    "Use this code to confirm it's really you before completing a sensitive change to your SafeSpace account.",
  ],
  code: { label: 'Your security code', value: '{{ .Token }}' },
  expiryText: 'This code will expire shortly after it was sent — if it no longer works, request a new one from the app.',
  securityNote: 'If you did not request this, you can ignore this email. No change will be made to your account unless this code is entered.',
});

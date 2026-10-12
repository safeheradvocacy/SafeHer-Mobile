// Supabase Auth dashboard slot: Authentication -> Email Templates -> "Confirm signup"
//
// REAL FLOW (verified against mobile/src/contexts/AuthContext.tsx and
// mobile/src/screens/auth/EmailVerificationScreen.tsx before writing
// this, not assumed): signUp() is called WITHOUT emailRedirectTo —
// verification is an 8-DIGIT code the user types into the app
// (EmailVerificationScreen -> verifyEmailOtp -> supabase.auth.
// verifyOtp({type:'email'})), never a clickable confirmation link. The
// code length is enforced by OtpInput's DEFAULT_CODE_LENGTH (8),
// identically on this screen and ChangePasswordScreen — not 6, despite
// a comment that used to say otherwise (corrected in this same pass).
// This template therefore shows {{ .Token }} as a code block and does
// NOT render a "Verify Email Address" button/ConfirmationURL — a
// button here would be dead weight the real flow never uses, and would
// contradict the brief's own "do not change the OTP length/verification
// method... merely to match the design."
import { renderEmailLayout, renderPlainText } from './_shared/emailLayout.mjs';

export const subject = 'Verify your email address | SafeSpace';

export const html = renderEmailLayout({
  previewText: 'Your SafeSpace verification code is inside.',
  heading: 'Verify your email address',
  bodyHtml: `
    <p style="margin: 0 0 16px;">Thank you for registering with SafeSpace. To help protect your account, enter the verification code below in the app.</p>
  `,
  code: { label: 'Your verification code', value: '{{ .Token }}' },
  expiryText: 'This code will expire shortly after it was sent — if it no longer works, request a new one from the app.',
  securityNoticeHtml: 'If you did not create a SafeSpace account, you can safely ignore this email. No account will be activated until this code is entered.',
});

export const text = renderPlainText({
  heading: 'Verify your email address',
  bodyLines: [
    'Thank you for registering with SafeSpace. To help protect your account, enter the verification code below in the app.',
  ],
  code: { label: 'Your verification code', value: '{{ .Token }}' },
  expiryText: 'This code will expire shortly after it was sent — if it no longer works, request a new one from the app.',
  securityNote: 'If you did not create a SafeSpace account, you can safely ignore this email. No account will be activated until this code is entered.',
});

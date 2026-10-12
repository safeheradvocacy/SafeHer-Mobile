// Supabase Auth dashboard slot: Authentication -> Email Templates -> "Reset Password"
//
// REAL FLOW (verified before writing this): BOTH apps call
// resetPasswordForEmail(email, { redirectTo: <their own URL> }) — mobile
// passes safeher://auth-callback (deepLinks.ts's buildAuthRedirectUrl,
// exchanged via PKCE in handleAuthDeepLink), the admin portal passes
// `${window.location.origin}/admin/reset-password` (AuthContext.tsx and
// UserManagementPage.tsx's own admin-triggered reset). Supabase has only
// ONE "Reset Password" template project-wide; {{ .ConfirmationURL }}
// already resolves to whichever redirectTo was passed on that specific
// call, so one generic template correctly serves both apps without any
// per-app branching here.
import { renderEmailLayout, renderPlainText } from './_shared/emailLayout.mjs';

export const subject = 'Reset your password | SafeSpace';

export const html = renderEmailLayout({
  previewText: 'Reset your SafeSpace account password.',
  heading: 'Reset your password',
  bodyHtml: `
    <p style="margin: 0 0 16px;">We received a request to reset the password for your SafeSpace account. If you made this request, use the button below to continue securely.</p>
  `,
  action: { label: 'Reset Password', href: '{{ .ConfirmationURL }}' },
  secondaryUrl: '{{ .ConfirmationURL }}',
  securityNoticeHtml: 'If you did not request this change, you can ignore this email. Your password will not be changed unless the recovery process is completed.',
});

export const text = renderPlainText({
  heading: 'Reset your password',
  bodyLines: [
    'We received a request to reset the password for your SafeSpace account. If you made this request, use the link below to continue securely.',
  ],
  actionLabel: 'Reset Password',
  actionUrl: '{{ .ConfirmationURL }}',
  securityNote: 'If you did not request this change, you can ignore this email. Your password will not be changed unless the recovery process is completed.',
});

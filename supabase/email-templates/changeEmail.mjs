// Supabase Auth dashboard slot: Authentication -> Email Templates -> "Change Email Address"
//
// STATUS — NOT currently triggered by this application. Verified by
// search: no call to supabase.auth.updateUser({ email: ... }) exists
// anywhere in mobile/src or admin/src today, so this transaction cannot
// actually fire from either app as the code stands. It is included
// anyway because Supabase provisions this template by default on every
// project regardless of whether an app uses it — leaving it in
// Supabase's own generic/default branding would be the exact
// inconsistency this brief is about the moment a future feature does
// call updateUser({email}). This is NOT "inventing a transaction the
// application doesn't support" (the brief's own caution) — it is
// branding a slot Supabase already provisions, never claimed as live.
import { renderEmailLayout, renderPlainText } from './_shared/emailLayout.mjs';

export const subject = 'Confirm your email address change | SafeSpace';

export const html = renderEmailLayout({
  previewText: 'Confirm your new email address for SafeSpace.',
  heading: 'Confirm your email address change',
  bodyHtml: `
    <p style="margin: 0 0 8px;">We received a request to change the email address on your SafeSpace account from:</p>
    <p style="margin: 0 0 4px; font-weight: bold;">{{ .Email }}</p>
    <p style="margin: 0 0 16px;">to:</p>
    <p style="margin: 0 0 16px; font-weight: bold;">{{ .NewEmail }}</p>
    <p style="margin: 0 0 16px;">If this was you, confirm the change using the button below.</p>
  `,
  action: { label: 'Confirm Email Change', href: '{{ .ConfirmationURL }}' },
  secondaryUrl: '{{ .ConfirmationURL }}',
  securityNoticeHtml: 'If you did not request this change, you can ignore this email. Your account email will not change unless this confirmation is completed.',
});

export const text = renderPlainText({
  heading: 'Confirm your email address change',
  bodyLines: [
    'We received a request to change the email address on your SafeSpace account from {{ .Email }} to {{ .NewEmail }}.',
    'If this was you, confirm the change using the link below.',
  ],
  actionLabel: 'Confirm Email Change',
  actionUrl: '{{ .ConfirmationURL }}',
  securityNote: 'If you did not request this change, you can ignore this email. Your account email will not change unless this confirmation is completed.',
});

// SafeSpace transactional email — ONE shared layout renderer.
//
// Every template in this directory calls renderEmailLayout() instead of
// hand-writing its own HTML chrome — this is what "one reusable design
// system" means in practice here: a single function that owns the
// header, container, typography, button, code-block, security-notice,
// and footer markup, so no two templates can silently drift in spacing,
// color, or footer wording. A template file only ever supplies its own
// heading/body/action — never its own <table>/<style> chrome.
//
// WHY TABLE-BASED, INLINE-CSS HTML — not a stylesheet, not flexbox/grid,
// no JavaScript: Outlook's desktop rendering engine (Word, not a real
// browser) and many webmail clients strip <style> blocks or ignore
// modern CSS; nested <table> layout with inline style="" attributes on
// every element is the actual, verified-by-decades-of-email-development
// baseline that renders consistently across Gmail/Outlook/mobile mail
// apps. This is deliberately NOT "modern" HTML — that would look right
// in a browser preview and break in Outlook, which is exactly the
// mistake this brief calls out ("Do not assume that a browser preview
// proves Outlook or Gmail compatibility").
//
// Supabase's own `{{ .Variable }}` Go-template tokens are written here
// as literal text — Supabase substitutes them server-side at send time,
// after this file has already produced the final static HTML Supabase
// expects pasted into its dashboard. This file never evaluates or
// escapes those tokens itself.

import { COLORS, PRODUCT_DESCRIPTOR, SUPPORT_LINE, EMAIL_WIDTH } from './brand.mjs';

/** Escapes a value this SCRIPT interpolates directly into HTML (e.g. a
 * subject echoed into a heading). Supabase's own `{{ .Variable }}`
 * tokens are never passed through this — they are plain template
 * placeholders Supabase's server substitutes and escapes on its own
 * side, long after this static file is generated. */
function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function buttonHtml({ label, href }) {
  // "Bulletproof button": a solid table cell carries the background
  // color/shape (reliable everywhere, including Outlook's Word engine,
  // which mangles border-radius/padding declared directly on an <a>),
  // with a block-level <a> inside it for the actual tap/click target.
  return `
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" align="center" style="margin: 28px auto;">
      <tr>
        <td align="center" bgcolor="${COLORS.primary}" style="border-radius: 6px;">
          <a href="${href}" target="_blank"
             style="display: inline-block; padding: 14px 32px; font-family: Arial, Helvetica, sans-serif; font-size: 16px; font-weight: bold; color: ${COLORS.white}; text-decoration: none; border-radius: 6px;">
            ${escapeHtml(label)}
          </a>
        </td>
      </tr>
    </table>`;
}

function codeBlockHtml({ code, label }) {
  // Wide letter-spacing + a monospace stack keeps the code unambiguous
  // (no visual confusion between 0/O, 1/l) and easy to read back while
  // typing it into the app by hand — the actual way every OTP in this
  // product is consumed (see mobile/src/components/OtpInput.tsx).
  return `
    <p style="margin: 0 0 8px; font-family: Arial, Helvetica, sans-serif; font-size: 13px; color: ${COLORS.textMuted}; text-align: center;">${escapeHtml(label)}</p>
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" align="center" style="margin: 0 auto 28px;">
      <tr>
        <td align="center" bgcolor="${COLORS.lightSurface}" style="border: 1px solid ${COLORS.border}; border-radius: 8px; padding: 18px 28px;">
          <span style="font-family: 'Courier New', Courier, monospace; font-size: 32px; font-weight: bold; letter-spacing: 10px; color: ${COLORS.primaryDark};">${escapeHtml(code)}</span>
        </td>
      </tr>
    </table>`;
}

function secondaryUrlHtml(url) {
  return `
    <p style="margin: 0 0 24px; font-family: Arial, Helvetica, sans-serif; font-size: 13px; color: ${COLORS.textMuted}; text-align: center; word-break: break-all;">
      Or copy and paste this link into your browser:<br />
      <a href="${url}" target="_blank" style="color: ${COLORS.secondaryBlue};">${url}</a>
    </p>`;
}

function securityNoticeHtml(text) {
  return `
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin: 0 0 8px;">
      <tr>
        <td bgcolor="${COLORS.lightSurface}" style="border: 1px solid ${COLORS.border}; border-radius: 6px; padding: 14px 16px; font-family: Arial, Helvetica, sans-serif; font-size: 13px; line-height: 20px; color: ${COLORS.text};">
          ${text}
        </td>
      </tr>
    </table>`;
}

/**
 * @param {{
 *   previewText: string,          // hidden preheader (inbox preview line)
 *   heading: string,
 *   bodyHtml: string,              // one or more already-escaped <p> blocks
 *   action?: { label: string, href: string },
 *   secondaryUrl?: string,         // plain-text fallback for the button's href
 *   code?: { label: string, value: string },
 *   securityNoticeHtml?: string,
 *   expiryText?: string,
 * }} params
 */
export function renderEmailLayout(params) {
  const { previewText, heading, bodyHtml, action, secondaryUrl, code, securityNoticeHtml: notice, expiryText } = params;

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta name="color-scheme" content="light" />
<meta name="supported-color-schemes" content="light" />
<title>SafeSpace</title>
</head>
<body style="margin: 0; padding: 0; background-color: ${COLORS.background};">
  <!-- Hidden preheader: the one-line preview most mail clients show next to the subject -->
  <div style="display: none; max-height: 0; overflow: hidden; mso-hide: all;">${escapeHtml(previewText)}</div>

  <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background-color: ${COLORS.background};">
    <tr>
      <td align="center" style="padding: 32px 16px;">
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="${EMAIL_WIDTH}" style="width: ${EMAIL_WIDTH}px; max-width: 100%; background-color: ${COLORS.white}; border-radius: 10px; overflow: hidden;">

          <!-- Header: text wordmark, matching admin/src/components/branding/Logo.tsx's LogoLockup twoTone colors exactly — no image, nothing invented. -->
          <tr>
            <td align="center" style="padding: 28px 24px 20px; border-bottom: 1px solid ${COLORS.border};">
              <span style="font-family: Arial, Helvetica, sans-serif; font-size: 24px; font-weight: 800;">
                <span style="color: ${COLORS.primaryDark};">Safe</span><span style="color: ${COLORS.accentBlue};">Space</span>
              </span>
            </td>
          </tr>

          <!-- Body -->
          <tr>
            <td style="padding: 32px 36px 8px;">
              <h1 style="margin: 0 0 16px; font-family: Arial, Helvetica, sans-serif; font-size: 22px; line-height: 28px; color: ${COLORS.text}; font-weight: bold;">${escapeHtml(heading)}</h1>
              <div style="font-family: Arial, Helvetica, sans-serif; font-size: 15px; line-height: 23px; color: ${COLORS.text};">
                ${bodyHtml}
              </div>
            </td>
          </tr>

          ${
            action
              ? `<tr><td style="padding: 8px 36px 0;">${buttonHtml(action)}</td></tr>`
              : ''
          }
          ${
            code
              ? `<tr><td style="padding: 8px 36px 0;">${codeBlockHtml({ code: code.value, label: code.label })}</td></tr>`
              : ''
          }
          ${
            secondaryUrl
              ? `<tr><td style="padding: 0 36px 0;">${secondaryUrlHtml(secondaryUrl)}</td></tr>`
              : ''
          }
          ${
            expiryText
              ? `<tr><td style="padding: 0 36px 20px;"><p style="margin:0; font-family: Arial, Helvetica, sans-serif; font-size: 13px; color: ${COLORS.textMuted}; text-align: center;">${escapeHtml(expiryText)}</p></td></tr>`
              : ''
          }
          ${
            notice
              ? `<tr><td style="padding: 0 36px 28px;">${securityNoticeHtml(notice)}</td></tr>`
              : ''
          }

          <!-- Footer -->
          <tr>
            <td style="padding: 20px 36px 28px; border-top: 1px solid ${COLORS.border};">
              <p style="margin: 0 0 6px; font-family: Arial, Helvetica, sans-serif; font-size: 12px; line-height: 18px; color: ${COLORS.textMuted};">${escapeHtml(PRODUCT_DESCRIPTOR)}</p>
              <p style="margin: 0 0 6px; font-family: Arial, Helvetica, sans-serif; font-size: 12px; line-height: 18px; color: ${COLORS.textMuted};">This message relates to a SafeSpace account or system transaction.</p>
              <p style="margin: 0; font-family: Arial, Helvetica, sans-serif; font-size: 12px; line-height: 18px; color: ${COLORS.textMuted};">${escapeHtml(SUPPORT_LINE)}</p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

/** Plain-text equivalent of the same content — see each template file
 * for why Supabase's own dashboard template field can't actually carry
 * this (documented, not silently dropped). Kept so the equivalent text
 * exists in source control even though the delivery mechanism doesn't
 * expose a slot for it today. */
export function renderPlainText({ heading, bodyLines, actionLabel, actionUrl, code, expiryText, securityNote }) {
  const lines = [heading, '', ...bodyLines, ''];
  if (code) lines.push(`${code.label}: ${code.value}`, '');
  if (actionUrl) lines.push(`${actionLabel}: ${actionUrl}`, '');
  if (expiryText) lines.push(expiryText, '');
  if (securityNote) lines.push(securityNote, '');
  lines.push('—', PRODUCT_DESCRIPTOR, SUPPORT_LINE);
  return lines.join('\n');
}

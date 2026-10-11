import React from 'react';
import { ShieldCheck } from 'lucide-react';
import safeherLogo from '../../assets/branding/safeher-logo.png';

/**
 * The official SafeHer mark (shield + mother/child illustration + heart,
 * transparent background) — src/assets/branding/safeher-logo.png. As of
 * 2026-08-18 this asset is icon-only (no "SafeHer" text baked in — an
 * earlier version of this same file, 482x517, had the wordmark stacked
 * below the shield; the current one is 482x381, cropped to just the mark).
 * That change landed on disk mid-session without any edit from this
 * assistant — flagged to the user rather than assumed. Always pair with a
 * separate text wordmark (see CompactLogoLockup) since none is embedded.
 */
export function OfficialLogo({
  width,
  className,
  style,
}: {
  /** Fixed pixel width for one-off usage. Omit when `className` is one of
   * the responsive `.lp-*-logo` classes — those set `width` (with media
   * queries) in CSS, and an inline width here would silently win over them
   * regardless of viewport, since inline styles always beat stylesheet
   * rules. */
  width?: number;
  className?: string;
  style?: React.CSSProperties;
}) {
  return (
    <img
      src={safeherLogo}
      alt="SafeSpace logo"
      className={className}
      style={{ width, height: 'auto', display: 'block', maxWidth: '100%', ...style }}
    />
  );
}

/**
 * Compact brand lockup for tight spaces (navbar, footer): a simple
 * geometric shield mark (LogoMark, below) paired with the two-tone
 * "SafeSpace" text. Public-landing-page-only — the authenticated admin
 * shell uses LogoLockup below instead (same LogoMark, a single-color
 * wordmark by default, with its own twoTone option), since the two
 * contexts need different sizing/layout, not a different mark.
 *
 * Deliberately NOT the illustrated safeher-logo.png (OfficialLogo) — that
 * asset depicts a shield + mother/child illustration, which both names
 * the old brand and reads as gender/role-coded in a way the inclusive
 * SafeSpace identity is specifically meant to move away from. LogoMark's
 * plain shield-in-a-circle is a deliberately simple placeholder per the
 * rebrand brief ("do not invent an elaborate permanent logo") — swap it
 * for a real SafeSpace mark here (and in LogoLockup) the moment one exists.
 */
export function CompactLogoLockup({
  logoWidth = 44,
  fontSize = 23,
  onDark = false,
}: {
  logoWidth?: number;
  fontSize?: number;
  onDark?: boolean;
}) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
      <LogoMark size={logoWidth} tone={onDark ? 'onDark' : 'onLight'} />
      <span style={{ fontFamily: 'var(--font-display)', fontWeight: 800, fontSize }}>
        <span style={{ color: onDark ? '#FFFFFF' : '#0B3A82' }}>Safe</span>
        <span style={{ color: onDark ? '#A9CBEA' : '#2F80C9' }}>Space</span>
      </span>
    </div>
  );
}

/**
 * Placeholder brand mark (generic shield icon) — kept for the admin sidebar
 * and login page, which weren't part of this logo-integration change.
 * mirrors mobile/src/components/branding/LogoMark.tsx.
 */
export function LogoMark({
  size = 48,
  tone = 'onLight',
}: {
  size?: number;
  tone?: 'onLight' | 'onDark';
}) {
  return (
    <div
      style={{
        width: size,
        height: size,
        borderRadius: '50%',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: tone === 'onDark' ? '#FFFFFF' : 'var(--color-primary-light)',
        flexShrink: 0,
      }}
    >
      <ShieldCheck size={size * 0.5} color="var(--color-primary)" strokeWidth={2} />
    </div>
  );
}

export function LogoLockup({
  tone = 'onLight',
  size = 40,
  twoTone = false,
}: {
  tone?: 'onLight' | 'onDark';
  size?: number;
  /** Renders "Safe" / "Space" in two brand shades, matching
   * CompactLogoLockup's public-page treatment — opt-in; the admin
   * sidebar/topbar keep the single-color wordmark by default. */
  twoTone?: boolean;
}) {
  const textColor = tone === 'onDark' ? '#FFFFFF' : 'var(--color-text)';
  const fontSize = size * 0.5;
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
      <LogoMark size={size} tone={tone} />
      {twoTone ? (
        <span style={{ fontFamily: 'var(--font-display)', fontWeight: 800, fontSize }}>
          <span style={{ color: tone === 'onDark' ? '#FFFFFF' : '#0B3A82' }}>Safe</span>
          <span style={{ color: tone === 'onDark' ? '#A9CBEA' : '#2F80C9' }}>Space</span>
        </span>
      ) : (
        <span style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize, color: textColor }}>
          SafeSpace
        </span>
      )}
    </div>
  );
}

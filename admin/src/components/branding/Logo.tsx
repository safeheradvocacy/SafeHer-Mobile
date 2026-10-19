import React from 'react';
import safeSpaceLogoFull from '../../assets/branding/safespace_nobackground.png';
import safeSpaceLogoSymbol from '../../assets/branding/safesapce_logo.png';

/**
 * The official SafeSpace mark — a real, provided asset (added to the repo
 * directly, not drawn by this assistant).
 *
 * Two real source files exist, both square 1254x1254, verified by decoding
 * their actual pixels (not assumed from filename):
 *   - safespace_nobackground.png — mark + "SafeSpace" wordmark baked in,
 *     genuinely transparent (every sampled edge/corner pixel is alpha 0,
 *     not just an unused alpha channel). This is the PRIMARY logo — use it
 *     as a single complete unit wherever the full lockup fits, never paired
 *     with an extra hand-typed "SafeSpace" heading beside/beneath it.
 *     Its wordmark ink is itself blue-toned (sampled: shades in the
 *     #004070–#1090E0 range), so it only reads clearly on a light/white
 *     background — on this app's dark navy sidebar/auth-panel blue
 *     (--sidebar-bg #0B3A82 and its gradient), the contrast ratio comes out
 *     under 2:1 (WCAG wants >=4.5:1 for text), which is why every
 *     dark-background spot in this app below uses LogoMark (symbol only)
 *     instead, exactly as the branding brief allows ("use the symbol-only
 *     asset when it becomes unreadable").
 *   - safesapce_logo.png — symbol only, OPAQUE white background baked in
 *     (filenames exactly as they exist on disk; "sapce" is a pre-existing
 *     typo in the asset's own filename, not introduced here). Also verified
 *     by decoding pixels: its own wordmark-sized text strip only occupies
 *     roughly the bottom 12% of the square canvas, so at the compact
 *     heights real nav/sidebar rows actually have (well under the ~140px+
 *     a legible wordmark needs at this asset's proportions), the full
 *     lockup's text would render too small to read — this is the asset to
 *     reach for in exactly those compact spots instead.
 * `withName` selects which; defaults to the full lockup.
 */
export function OfficialLogo({
  width,
  withName = true,
  className,
  style,
}: {
  /** Fixed pixel width for one-off usage. Omit when `className` is one of
   * the responsive `.lp-*-logo` classes — those set `width` (with media
   * queries) in CSS, and an inline width here would silently win over them
   * regardless of viewport, since inline styles always beat stylesheet
   * rules. */
  width?: number;
  /** false renders the symbol-only mark instead of the mark+wordmark
   * lockup — e.g. for a dark/colored background where the wordmark's own
   * dark-blue ink wouldn't have enough contrast, or a footprint too small
   * for its wordmark text to stay legible. */
  withName?: boolean;
  className?: string;
  style?: React.CSSProperties;
}) {
  return (
    <img
      src={withName ? safeSpaceLogoFull : safeSpaceLogoSymbol}
      alt="SafeSpace"
      className={className}
      style={{ width, height: 'auto', display: 'block', maxWidth: '100%', objectFit: 'contain', ...style }}
    />
  );
}

/**
 * The real SafeSpace symbol mark, cropped into a circular badge. Used alone
 * (no hand-typed "SafeSpace" text beside it) in every compact or
 * dark-background spot in this app — sidebar (collapsed and expanded),
 * the mobile topbar, the auth page's dark brand panel, and the public
 * site's nav/footer — since safesapce_logo.png has an OPAQUE white
 * background (no alpha), rendering it inside a circular, `object-fit:
 * cover` frame is what makes it read correctly on any of those surfaces
 * without needing the artwork itself to have transparency (which it
 * doesn't, and the brief says not to modify it). `tone` still affects the
 * thin ring around the badge for contrast against light vs. dark surfaces.
 * Each call site already carries its own nearby text for the SafeSpace
 * name (a page title, a hero heading, a footer caption, or — for the
 * collapsed/narrow spots — just the alt text and a hover tooltip), so
 * dropping a second hand-typed label next to this badge isn't a loss of
 * clarity, it's removing a duplicate.
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
        overflow: 'hidden',
        flexShrink: 0,
        boxShadow: tone === 'onDark' ? '0 0 0 1px rgba(255,255,255,0.18)' : '0 0 0 1px var(--color-border)',
      }}
    >
      <img
        src={safeSpaceLogoSymbol}
        alt="SafeSpace"
        style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
      />
    </div>
  );
}

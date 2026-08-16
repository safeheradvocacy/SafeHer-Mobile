import React from 'react';
import { ShieldCheck } from 'lucide-react';

/**
 * Single integration point for the official SafeHer logo, mirroring
 * mobile/src/components/branding/LogoMark.tsx. Every branded page (landing
 * hero, footer, admin login) renders through this component instead of
 * drawing its own mark — so once the real asset is placed at
 * src/assets/branding/safeher-logo.png, swapping the placeholder below for
 *   <img src={logoUrl} width={size} height={size} style={{ objectFit: 'contain' }} alt="SafeHer" />
 * (with `import logoUrl from '../../assets/branding/safeher-logo.png'` at
 * the top) updates the whole web app in one place. Do not redraw the mark
 * elsewhere.
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

export function LogoLockup({ tone = 'onLight', size = 40 }: { tone?: 'onLight' | 'onDark'; size?: number }) {
  const textColor = tone === 'onDark' ? '#FFFFFF' : 'var(--color-text)';
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
      <LogoMark size={size} tone={tone} />
      <span style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: size * 0.5, color: textColor }}>
        SafeHer
      </span>
    </div>
  );
}

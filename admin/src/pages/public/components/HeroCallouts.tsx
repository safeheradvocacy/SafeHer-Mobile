import React, { useEffect, useState } from 'react';
import { Heart, Lock, MapPin, Shield } from 'lucide-react';

// Percentage coordinates in a 0-100 space matching the hero section's own
// box (position: absolute percentages, not a stretched SVG viewBox — see
// the component comment below for why that distinction matters now).
// Exported so HeroConnections.tsx can anchor its curved pathways to the
// exact same points these labels render at, instead of a second,
// independently-guessed set of coordinates that could drift out of sync.
export const CALLOUTS: {
  icon: typeof Lock;
  label: string;
  x: number;
  y: number;
  align: 'left' | 'right';
}[] = [
  { icon: Lock, label: 'Confidential reporting', x: 4, y: 6, align: 'left' },
  { icon: Shield, label: 'Emergency SOS access', x: 96, y: 6, align: 'right' },
  { icon: Heart, label: 'Person-first support', x: 4, y: 30, align: 'left' },
  { icon: MapPin, label: 'Shelter & referral access', x: 96, y: 30, align: 'right' },
];

/**
 * Four small trust-signal labels framing the hero — just the fade-in
 * label chips themselves, nothing reaching toward the shield from here.
 * A separate sibling, HeroConnections.tsx, draws the curved pathways
 * from these same CALLOUTS coordinates to the shield's halo; keeping
 * that entirely out of this file means this component still renders
 * correctly (labels with no lines) even if HeroConnections is ever
 * removed or fails to measure its geometry.
 *
 * Earlier, each label got its own SVG connector line reaching toward
 * the shield, but at the time that meant two separate "orbital" systems
 * competing for the same visual territory (this one, loosely positioned
 * and static, and AnimatedSecurityVisual's then-circular orbit with its
 * own four nodes) — they read as disconnected from each other. That
 * orbit is gone now (see AnimatedSecurityVisual.tsx's "Protective
 * Shield Pulse"), which is what makes a single, deliberate connector
 * system — anchored to these exact coordinates — workable again.
 *
 * Plain CSS percentage positioning (not an SVG viewBox) — a
 * `preserveAspectRatio="none"`-stretched SVG distorts circular geometry
 * on a wide-short hero, which doesn't matter for a straight connector
 * line but would matter the moment anything here needs to look
 * circular; percentages avoid the question entirely. HeroConnections
 * converts these same x/y percentages into real measured pixels instead
 * of using a stretched viewBox itself, for the same reason.
 */
export function HeroCallouts() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => setVisible(true), 500);
    return () => clearTimeout(timer);
  }, []);

  return (
    <div className="hero-callouts" aria-hidden="true">
      {CALLOUTS.map(({ icon: Icon, label, x, y, align }, i) => (
        <div
          key={label}
          className={`hero-callout-label${visible ? ' is-visible' : ''}`}
          style={{
            left: `${x}%`,
            top: `${y}%`,
            transform: `translate(${align === 'right' ? '-100%' : '0%'}, -50%)`,
            transitionDelay: `${i * 90 + 500}ms`,
          }}
        >
          {align === 'left' ? (
            <>
              <Icon size={15} strokeWidth={1.75} />
              <span>{label}</span>
            </>
          ) : (
            <>
              <span>{label}</span>
              <Icon size={15} strokeWidth={1.75} />
            </>
          )}
        </div>
      ))}
    </div>
  );
}

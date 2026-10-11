import React from 'react';
import { ShieldCheck } from 'lucide-react';

// The hero's visual anchor — "Protective Shield Pulse": a stationary
// shield with a soft halo and two gently expanding-and-fading
// protection rings, nothing else. This deliberately REPLACES an
// earlier four-node "orbital network" version of this component (small
// nodes continuously circling the shield, each with its own connector
// stub) — that read as a network/security-product diagram, not a calm
// public-service reassurance. There is no node, no orbit, and no
// connector line left anywhere in this file; the only motion is the
// shield's own faint breathing and the two rings quietly expanding
// outward from it. Structure, outer to inner:
//
//   protection rings   (expand + fade, one 2.5s behind the other)
//   halo               (very soft, slow opacity/scale breathe)
//   shield-glow        (tight blurred halo immediately around the badge)
//   shield-badge + icon (the stable core — never rotates, never orbits)
//
// `shieldRef` is optional and purely informational: HeroConnections.tsx
// (a sibling in the hero, not a child of this component) reads this
// element's real measured position so its four curved pathways can
// converge on the actual halo, on the actual screen, at the actual
// viewport width — instead of a second, independently-guessed
// coordinate for where the shield is assumed to sit.
export function AnimatedSecurityVisual({
  shieldRef,
}: {
  shieldRef?: React.Ref<HTMLDivElement>;
}) {
  return (
    <div className="shield-group hero-shield-crest" ref={shieldRef} aria-hidden="true">
      <div className="shield-pulse-ring" />
      <div className="shield-pulse-ring ring-b" />

      <div className="hero-glass-orb hero-glass-orb-sm" />

      <div
        className="shield-glow"
        style={{
          position: 'absolute',
          inset: -22,
          borderRadius: '50%',
          background: 'rgba(20,86,160,0.18)',
          filter: 'blur(20px)',
        }}
      />

      <div
        className="shield-badge"
        style={{
          position: 'relative',
          width: 118,
          height: 118,
          borderRadius: '50%',
          background: 'linear-gradient(135deg, #2F80C9, #0B3A82)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          boxShadow: '0 10px 22px rgba(8,28,58,0.24)',
        }}
      >
        <ShieldCheck size={54} color="#FFFFFF" strokeWidth={1.75} />
      </div>
    </div>
  );
}

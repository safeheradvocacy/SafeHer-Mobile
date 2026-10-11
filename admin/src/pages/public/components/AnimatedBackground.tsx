import React from 'react';

// Ambient background behind the hero — two soft, slow-drifting blue
// glow blobs. Deliberately restrained: the earlier version of this
// component drifted four blurred purple/pink/lavender blobs plus eight
// floating icon-less particle dots, which read as a lot of simultaneous
// motion once layered under the hero's other moving elements
// (HeroCallouts, AnimatedSecurityVisual's shield/orbit) —
// more than a calm, trustworthy public-service page needs. Pure CSS,
// `pointerEvents: none`, `aria-hidden` — decorative only, never
// intercepts a click or competes with the heading/buttons for
// attention; prefers-reduced-motion turns the drift off entirely (see
// theme.css).
export function AnimatedBackground() {
  return (
    <div aria-hidden="true" style={{ position: 'absolute', inset: 0, overflow: 'hidden', pointerEvents: 'none', zIndex: 0 }}>
      <div
        className="bg-blob-h"
        style={{
          width: 420, height: 420, top: -140, left: -120,
          background: 'radial-gradient(circle, rgba(169,203,234,0.16), transparent 70%)',
          filter: 'blur(70px)',
        }}
      />
      <div
        className="bg-blob-v"
        style={{
          width: 340, height: 340, top: 220, right: -80,
          background: 'radial-gradient(circle, rgba(20,86,160,0.12), transparent 70%)',
          filter: 'blur(80px)',
          animationDelay: '2.5s',
        }}
      />
    </div>
  );
}

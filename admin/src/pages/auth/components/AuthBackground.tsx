import React from 'react';

// Ambient background for the admin auth brand panel — two soft glow blobs
// plus a few extremely faint large-radius curves, all of it completely
// static. Deliberately restrained, and deliberately NOT animated: a
// government/public-service sign-in screen should settle once it's loaded
// rather than keep moving in the background indefinitely (the earlier
// version of this component had both — four blurred color blobs and five
// floating icon chips drifting continuously, then later two blobs left
// softly pulsing forever — neither of which has any state to communicate,
// just decoration in motion). The curves are a quieter echo of the public
// landing page's own line language, not its animated orbital/bloodline
// system — large, thin, barely-there, and still. Pure CSS/SVG, aria-hidden,
// pointer-events: none; nothing here needs a reduced-motion override since
// nothing here moves in the first place.
export function AuthBackground() {
  return (
    <div aria-hidden="true" style={{ position: 'absolute', inset: 0, overflow: 'hidden', pointerEvents: 'none' }}>
      <div
        style={{
          position: 'absolute',
          top: '6%',
          right: '12%',
          width: 220,
          height: 220,
          borderRadius: '50%',
          background: 'rgba(255,255,255,0.08)',
          filter: 'blur(50px)',
        }}
      />
      <div
        style={{
          position: 'absolute',
          bottom: '10%',
          left: '8%',
          width: 180,
          height: 180,
          borderRadius: '50%',
          background: 'rgba(191,219,245,0.14)',
          filter: 'blur(45px)',
        }}
      />
      <svg
        viewBox="0 0 600 900"
        preserveAspectRatio="xMidYMid slice"
        style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }}
      >
        <path d="M -80 260 Q 300 160 680 320" stroke="rgba(255,255,255,0.08)" strokeWidth="1" fill="none" />
        <path d="M -80 620 Q 300 740 680 600" stroke="rgba(255,255,255,0.06)" strokeWidth="1" fill="none" />
      </svg>
    </div>
  );
}

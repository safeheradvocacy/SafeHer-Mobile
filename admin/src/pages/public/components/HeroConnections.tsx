import React, { useEffect, useMemo, useState } from 'react';
import { CALLOUTS } from './HeroCallouts';

// Four thin curved "protection pathways" linking the hero's trust-signal
// labels (HeroCallouts) to the central shield's halo (AnimatedSecurityVisual)
// — visually ties the four capabilities to the central SafeSpace protection
// element without reviving the orbital/node system that was deliberately
// removed. No orbit, no rotation, no nodes, and — unlike an earlier version
// of this effect — no merged/hidden routing path connecting the four of
// them either: just four independent static curves, each carrying its own
// continuously flowing current (see .connection-path-current in theme.css).
// Phase-offset per path (PULSE_SEQUENCE order, below) so the eye reads a
// directional progression around the four capabilities, but every path is
// moving all the time — the stagger only shifts where each one currently is
// in its own endless loop, never creates a pause.
//
// Hidden below the width where HeroCallouts itself hides (960px) — there's
// nothing to connect to without the labels, and a pathway trying to survive
// on its own at that width is exactly the "don't force it" case the brief
// calls out.
//
// Geometry is measured, not guessed: both the hero section and the shield
// cluster are watched with a ResizeObserver, and the curves are drawn in
// real screen pixels (not a stretched 0-100 viewBox) so they always land
// on the halo's actual edge at the current viewport size, rather than an
// estimated percentage that only happens to line up at one height.

const MIN_WIDTH_TO_SHOW = 960;

// Purely for the animation-delay stagger (1.5s apart, per the brief) — the
// visible curves themselves don't care about this order, only which corner
// each one's own CALLOUTS entry puts it in.
const PULSE_SEQUENCE = [
  'Confidential reporting',
  'Person-first support',
  'Shelter & referral access',
  'Emergency SOS access',
];
const STAGGER_SECONDS = 1.5;

interface Geometry {
  width: number;
  height: number;
  cx: number;
  cy: number;
  haloR: number;
}

type Point = [number, number];

function cubicLength(p0: Point, p1: Point, p2: Point, p3: Point, steps = 20) {
  let length = 0;
  let prev = p0;
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    const mt = 1 - t;
    const x = mt * mt * mt * p0[0] + 3 * mt * mt * t * p1[0] + 3 * mt * t * t * p2[0] + t * t * t * p3[0];
    const y = mt * mt * mt * p0[1] + 3 * mt * mt * t * p1[1] + 3 * mt * t * t * p2[1] + t * t * t * p3[1];
    length += Math.hypot(x - prev[0], y - prev[1]);
    prev = [x, y];
  }
  return length;
}

export function HeroConnections({
  heroRef,
  shieldRef,
}: {
  heroRef: React.RefObject<HTMLElement>;
  shieldRef: React.RefObject<HTMLDivElement>;
}) {
  const [geometry, setGeometry] = useState<Geometry | null>(null);

  useEffect(() => {
    const heroEl = heroRef.current;
    const shieldEl = shieldRef.current;
    if (!heroEl || !shieldEl) return;

    const measure = () => {
      const heroRect = heroEl.getBoundingClientRect();
      const shieldRect = shieldEl.getBoundingClientRect();
      setGeometry({
        width: heroRect.width,
        height: heroRect.height,
        cx: shieldRect.left + shieldRect.width / 2 - heroRect.left,
        cy: shieldRect.top + shieldRect.height / 2 - heroRect.top,
        // The halo (.hero-glass-orb-sm) sits at a fixed ~0.83 of the shield
        // cluster's own box at both its sizes (150/180 desktop, 120/145
        // mobile) — close enough to treat as one constant rather than
        // measuring the halo element itself separately.
        haloR: (shieldRect.width * 0.83) / 2,
      });
    };

    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(heroEl);
    observer.observe(shieldEl);
    return () => observer.disconnect();
  }, [heroRef, shieldRef]);

  const paths = useMemo(() => {
    if (!geometry || geometry.width <= MIN_WIDTH_TO_SHOW) return [];
    const { width, height, cx, cy, haloR } = geometry;
    // A flatter, shorter bow on narrower heroes keeps the curve clear of
    // the headline without needing a separate breakpoint-specific path set.
    const bow = width < 1200 ? 46 : 72;

    return CALLOUTS.map(({ x, y, align, label }) => {
      const sx = (x / 100) * width;
      const sy = (y / 100) * height;
      // Top labels dive down and away from their own text line before
      // sweeping in; bottom labels rise up and away from theirs — in both
      // cases the path leaves the text's horizontal band immediately
      // rather than cutting straight across it.
      const bowDown = y < 20;
      const side = align === 'left' ? -1 : 1;

      const ex = cx + side * haloR * 0.86;
      const ey = cy + (bowDown ? -1 : 1) * haloR * 0.5;

      const c1: Point = [sx, sy + (bowDown ? bow : -bow)];
      const c2: Point = [(sx + ex) / 2, ey + (bowDown ? -bow * 0.5 : bow * 0.5)];
      const start: Point = [sx, sy];
      const end: Point = [ex, ey];

      // Position in the story order (Confidential reporting -> Person-first
      // support -> Shelter & referral access -> Emergency SOS access), not
      // this array's visual position — only used for the delay stagger.
      const order = PULSE_SEQUENCE.indexOf(label);

      const length = cubicLength(start, c1, c2, end);

      return {
        key: `${x}-${y}`,
        d: `M ${start[0]} ${start[1]} C ${c1[0]} ${c1[1]}, ${c2[0]} ${c2[1]}, ${end[0]} ${end[1]}`,
        delay: order * STAGGER_SECONDS,
        // Computed here, not via CSS calc(var(--len) * 0.4) — a single
        // unresolved var() inside stroke-dasharray's calc() makes the
        // WHOLE property invalid, and an invalid stroke-dasharray falls
        // back to its initial value (`none`): a solid, undashed line,
        // where the stroke-dashoffset animation has nothing to visibly
        // move. Passing the three already-multiplied numbers removes
        // that failure mode entirely — theme.css just substitutes them.
        dash: length * 0.4,
        gap: length * 0.6,
        negLen: -length,
      };
    });
  }, [geometry]);

  if (!geometry || paths.length === 0) return null;
  const { width, height } = geometry;

  return (
    <svg className="hero-connections" aria-hidden="true" width={width} height={height}>
      {paths.map(({ key, d, delay, dash, gap, negLen }) => {
        const style = {
          '--delay': `${delay}s`,
          '--dash': dash,
          '--gap': gap,
          '--neg-len': negLen,
        } as React.CSSProperties;
        return (
          <g key={key} style={style}>
            <path className="connection-path-base" d={d} />
            <path className="connection-path-highlight" d={d} />
          </g>
        );
      })}
    </svg>
  );
}

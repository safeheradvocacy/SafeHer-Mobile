import React from 'react';
import { StyleSheet } from 'react-native';
import Svg, { Rect, Circle, Mask, Defs } from 'react-native-svg';
import type { TargetRect } from '../contexts/TourContext';

const DEFAULT_PADDING = 10;
const DEFAULT_RADIUS = 20;

function spotlightRadius(target: TargetRect, padding: number): number {
  if (target.shape === 'circle') return (Math.max(target.width, target.height) + padding * 2) / 2;
  if (target.shape === 'pill') return (target.height + padding * 2) / 2;
  return target.radius ?? DEFAULT_RADIUS;
}

interface SpotlightProps {
  /** The element to cut a hole around — undefined dims the whole screen
   * with no hole (the Welcome step, which has nothing specific to point at). */
  target: TargetRect | undefined;
  screenWidth: number;
  screenHeight: number;
  /** Breathing room between the target's real edges and the cutout. */
  padding?: number;
  dimColor?: string;
  dimOpacity?: number;
  /** A faint outline traced around the cutout — omit for no outline at
   * all. Kept thin/low-opacity by design: this should read as "look
   * here", not a selection box. */
  ringColor?: string;
}

/**
 * Dims the screen and cuts a real hole around `target` using an SVG
 * luminance mask (white reveals, black hides) — one shape, exactly the
 * target's own silhouette (rounded rect / stadium / circle), rather
 * than approximating a hole by tiling separate dimmed rectangles around
 * its edges. The tiled-rectangle approach is what previously made the
 * spotlight read as its own rectangular shape with a border around it
 * instead of a clean window onto the real UI — it physically cannot
 * produce a soft/rounded/circular hole, only a rectangular one, however
 * the surrounding pieces are arranged. A mask-based cutout has no such
 * limit and has no seams between separately-positioned pieces.
 *
 * `pointerEvents="none"` on the whole SVG means nothing in this layer —
 * dimmed area or cutout alike — ever intercepts a touch. Every tap,
 * anywhere on screen, reaches the real UI beneath exactly as if this
 * layer weren't there; nothing about the masking technique changes that
 * guarantee.
 */
export function Spotlight({
  target,
  screenWidth,
  screenHeight,
  padding = DEFAULT_PADDING,
  dimColor = '#0B1A30',
  dimOpacity = 0.5,
  ringColor,
}: SpotlightProps) {
  if (screenWidth <= 0 || screenHeight <= 0) return null;

  if (!target) {
    return (
      <Svg width={screenWidth} height={screenHeight} style={StyleSheet.absoluteFill} pointerEvents="none">
        <Rect x={0} y={0} width={screenWidth} height={screenHeight} fill={dimColor} fillOpacity={dimOpacity} />
      </Svg>
    );
  }

  const x = target.x - padding;
  const y = target.y - padding;
  const w = target.width + padding * 2;
  const h = target.height + padding * 2;
  const isCircle = target.shape === 'circle';
  const cx = x + w / 2;
  const cy = y + h / 2;
  const cr = Math.max(w, h) / 2;
  const r = spotlightRadius(target, padding);
  const maskId = 'spotlight-cutout';

  return (
    <Svg width={screenWidth} height={screenHeight} style={StyleSheet.absoluteFill} pointerEvents="none">
      <Defs>
        <Mask id={maskId} maskUnits="userSpaceOnUse" x={0} y={0} width={screenWidth} height={screenHeight}>
          <Rect x={0} y={0} width={screenWidth} height={screenHeight} fill="#ffffff" />
          {isCircle ? (
            <Circle cx={cx} cy={cy} r={cr} fill="#000000" />
          ) : (
            <Rect x={x} y={y} width={w} height={h} rx={r} ry={r} fill="#000000" />
          )}
        </Mask>
      </Defs>
      <Rect x={0} y={0} width={screenWidth} height={screenHeight} fill={dimColor} fillOpacity={dimOpacity} mask={`url(#${maskId})`} />
      {ringColor &&
        (isCircle ? (
          <Circle cx={cx} cy={cy} r={cr} fill="none" stroke={ringColor} strokeWidth={1.25} strokeOpacity={0.45} />
        ) : (
          <Rect x={x} y={y} width={w} height={h} rx={r} ry={r} fill="none" stroke={ringColor} strokeWidth={1.25} strokeOpacity={0.45} />
        ))}
    </Svg>
  );
}

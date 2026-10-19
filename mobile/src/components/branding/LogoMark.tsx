import React from 'react';
import { Image } from 'react-native';

/**
 * The SafeSpace brand marks. Two real asset files exist on disk (verified
 * by decoding their actual PNG pixels, not assumed from filename), both
 * square 1254x1254:
 *   - safesapce_logo.png — symbol only, OPAQUE white background baked in
 *     (filename spelled exactly as it exists on disk; "sapce" is a
 *     pre-existing typo in the asset itself, not introduced here).
 *   - safespace_nobackground.png — mark + "SafeSpace" wordmark baked in,
 *     genuinely transparent (every sampled edge/corner pixel is alpha 0).
 * `LogoMark` renders the symbol only, for compact spots (a fixed square
 * footprint, no wordmark). `LogoFull` renders the complete lockup as a
 * single image — never pair it with a separate "SafeSpace" Text, since
 * the name is already baked into the asset.
 *
 * Pixel analysis of safespace_nobackground.png found its wordmark text
 * strip occupies only the bottom ~12% of the square canvas, so it only
 * stays legible once the whole image renders at roughly 140px+ — below
 * that, prefer LogoMark instead. Its wordmark ink is also blue-toned
 * (sampled in the #004070-#1090E0 range), so it only has real contrast on
 * a light/white background — never place it directly on this app's blue
 * `colors.primary`/`colors.primaryDark` surfaces.
 */
const SIZES = { sm: 16, md: 20, lg: 28 } as const;

export function LogoMark({ size = 'md' }: { size?: keyof typeof SIZES | number }) {
  const dimension = typeof size === 'number' ? size : SIZES[size];
  return (
    <Image
      source={require('../../assets/branding/safesapce_logo.png')}
      accessibilityRole="image"
      accessibilityLabel="SafeSpace"
      resizeMode="contain"
      style={{ width: dimension, height: dimension }}
    />
  );
}

/** The complete mark+wordmark lockup, as a single transparent image — use
 * on a light background with room for the image to render at ~140px+
 * wide so its baked-in text stays legible. Square source, so `height`
 * is just set equal to `width` directly (matching LogoMark above) rather
 * than left to `aspectRatio` — a locally `require()`'d Image with
 * `aspectRatio` but no explicit `height` doesn't reliably constrain to
 * the given `width` here (it rendered at close to the source's native
 * 1254px instead), where two explicit numbers do. */
export function LogoFull({ width = 160 }: { width?: number }) {
  return (
    <Image
      source={require('../../assets/branding/safespace_nobackground.png')}
      accessibilityRole="image"
      accessibilityLabel="SafeSpace"
      resizeMode="contain"
      style={{ width, height: width }}
    />
  );
}

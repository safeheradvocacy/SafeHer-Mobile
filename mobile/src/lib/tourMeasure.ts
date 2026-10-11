import type { RefObject } from 'react';
import type { View } from 'react-native';
import type { TargetRect } from '../contexts/TourContext';

// Several tour targets (the greeting, the Report Incident tile, the SOS
// card, Home's own header) sit inside a FadeInUp entrance animation —
// Home's Quick Actions block, the slowest, settles at delay(180) +
// duration(320) = 500ms. onLayout fires as soon as Yoga computes layout,
// which happens well before that transform animation finishes, so a
// single measureInWindow call there can capture the element still
// mid-slide, offset from its resting position. Measuring once
// immediately (correct for every non-animated target, e.g. the tab bar)
// AND once again after the animations have had time to settle covers
// both cases at *registration* time. On its own that still isn't
// enough — Home is a ScrollView, so even a correct registration can go
// stale later if the user scrolls or content reflows — which is what
// registerTargetRef (called here too) and TourContext's step-change
// re-measure effect cover: this is just what gets a target its first,
// reasonably-accurate value.
const SETTLE_MS = 650;

export function measureAndRegister(
  ref: RefObject<View | null>,
  key: string,
  registerTarget: (key: string, rect: TargetRect) => void,
  registerTargetRef: (key: string, ref: RefObject<View | null>) => void,
  extra?: Pick<TargetRect, 'shape' | 'radius'>
) {
  registerTargetRef(key, ref);
  const measure = () => {
    ref.current?.measureInWindow((x, y, width, height) => {
      if (width === 0 && height === 0) return; // not actually laid out yet
      registerTarget(key, { x, y, width, height, ...extra });
    });
  };
  measure();
  setTimeout(measure, SETTLE_MS);
}

import React, { useEffect, useRef } from 'react';
import { View, StyleSheet, BackHandler, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import RAnimated, { useSharedValue, useAnimatedStyle, withTiming, withSequence } from 'react-native-reanimated';
import { useTheme } from '../contexts/ThemeContext';
import { useTour, type TargetRect } from '../contexts/TourContext';
import { useReducedMotion } from './ui';
import { Spotlight } from './Spotlight';
import { OnboardingTooltip } from './OnboardingTooltip';
import { spacing } from '../theme/theme';

const PAD = 10; // breathing room between the spotlight cutout and the real target
const GAP = 16; // space between the spotlighted target and the tooltip card
const MIN_SPACE = 150; // minimum room a side needs before the card is placed there
const SCREEN_PADDING = spacing.lg; // horizontal inset of the tooltip from the screen edges

// Only the elements the brief explicitly says the tour must never cover
// count as obstacles here — the SOS card and the bottom nav tabs (which
// includes SOS again, by tab). Ordinary content blocks (the greeting,
// the Report Incident tile) are deliberately NOT treated as obstacles
// for other steps — e.g. the Profile step should still land in the
// normal space below the header rather than being pushed down to the
// fallback zone just because the greeting happens to sit near there.
function isProtectedObstacle(key: string): boolean {
  return key === 'sosCard' || key.startsWith('tab:');
}

// Raw distance-to-screen-edge isn't enough to know whether the tooltip
// safely fits below/above a target — Home's layout, for example, has
// hundreds of scrollable pixels below the greeting, but the real SOS
// card sits only ~20px under it. These scan the protected obstacles
// that horizontally overlap the current target and cap the usable gap
// at the nearest one, so a step's card never lands on top of SOS or
// the bottom nav just because there was room on the screen in the
// abstract.
function nearestGapBelow(target: TargetRect, all: Record<string, TargetRect>, currentKey: string): number {
  let min = Infinity;
  for (const [key, t] of Object.entries(all)) {
    if (key === currentKey || !isProtectedObstacle(key)) continue;
    const overlapsHorizontally = t.x < target.x + target.width && t.x + t.width > target.x;
    if (overlapsHorizontally && t.y >= target.y + target.height - 1) {
      min = Math.min(min, t.y - (target.y + target.height));
    }
  }
  return min;
}

function nearestGapAbove(target: TargetRect, all: Record<string, TargetRect>, currentKey: string): number {
  let min = Infinity;
  for (const [key, t] of Object.entries(all)) {
    if (key === currentKey || !isProtectedObstacle(key)) continue;
    const overlapsHorizontally = t.x < target.x + target.width && t.x + t.width > target.x;
    if (overlapsHorizontally && t.y + t.height <= target.y + 1) {
      min = Math.min(min, target.y - (t.y + t.height));
    }
  }
  return min;
}

interface Placement {
  slotStyle: { position: 'absolute'; left: number; right: number; top?: number; bottom?: number; justifyContent?: 'center' };
  arrowSide: 'top' | 'bottom' | null;
}

/**
 * Decides where the tooltip goes relative to `target`: below it if
 * there's real room there (checked against protected obstacles, not
 * just the literal screen edge), above it if not, or — only when
 * neither side has room without touching something protected — the
 * same safe zone every bottom-nav step already anchors to, just above
 * the lowest registered tab. Never a fixed/hardcoded position.
 */
function computePlacement(
  target: TargetRect | undefined,
  targets: Record<string, TargetRect>,
  targetKey: string | undefined,
  screenH: number,
  insetTop: number,
  insetBottom: number
): Placement {
  if (!target) {
    return {
      slotStyle: { position: 'absolute', left: SCREEN_PADDING, right: SCREEN_PADDING, top: insetTop, bottom: insetBottom, justifyContent: 'center' },
      arrowSide: null,
    };
  }

  const spaceBelow = Math.min(
    screenH - (target.y + target.height) - insetBottom,
    nearestGapBelow(target, targets, targetKey ?? '') - PAD - GAP
  );
  const spaceAbove = Math.min(target.y - insetTop, nearestGapAbove(target, targets, targetKey ?? '') - PAD - GAP);

  if (spaceBelow < MIN_SPACE && spaceAbove < MIN_SPACE) {
    const tabTops = Object.entries(targets)
      .filter(([key]) => key.startsWith('tab:'))
      .map(([, t]) => t.y);
    const fallbackTop = tabTops.length > 0 ? Math.min(...tabTops) - GAP : screenH - insetBottom - GAP;
    return {
      slotStyle: { position: 'absolute', left: SCREEN_PADDING, right: SCREEN_PADDING, bottom: screenH - fallbackTop },
      arrowSide: null,
    };
  }

  if (spaceBelow >= MIN_SPACE && spaceBelow >= spaceAbove) {
    return {
      slotStyle: { position: 'absolute', left: SCREEN_PADDING, right: SCREEN_PADDING, top: target.y + target.height + PAD + GAP },
      arrowSide: 'top',
    };
  }

  return {
    slotStyle: { position: 'absolute', left: SCREEN_PADDING, right: SCREEN_PADDING, bottom: screenH - (target.y - PAD) + GAP },
    arrowSide: 'bottom',
  };
}

export function TourOverlay() {
  const { active, stepIndex, steps, targets, next, skip } = useTour();
  const { palette } = useTheme();
  const reduced = useReducedMotion();
  const insets = useSafeAreaInsets();
  const { width: screenW, height: screenH } = useWindowDimensions();

  const opacity = useSharedValue(0);
  // A brief, independent dip-and-recover on the whole spotlight+card
  // cluster whenever the step changes — this is what makes moving from
  // one target to the next read as a smooth transition instead of
  // everything snapping instantly to new coordinates.
  const stepOpacity = useSharedValue(1);
  const stepTranslate = useSharedValue(0);
  const didMountStep = useRef(false);

  useEffect(() => {
    opacity.value = reduced ? (active ? 1 : 0) : withTiming(active ? 1 : 0, { duration: 220 });
  }, [active, reduced, opacity]);

  useEffect(() => {
    if (!didMountStep.current) {
      didMountStep.current = true;
      return;
    }
    if (reduced) return;
    stepOpacity.value = withSequence(withTiming(0, { duration: 90 }), withTiming(1, { duration: 160 }));
    stepTranslate.value = withSequence(withTiming(8, { duration: 90 }), withTiming(0, { duration: 160 }));
  }, [stepIndex, reduced, stepOpacity, stepTranslate]);

  useEffect(() => {
    if (!active) return;
    // Preserves the hardware-back behavior a Modal would normally give
    // for free (onRequestClose) now that this renders in-tree instead —
    // back always ends the tour rather than navigating underneath it.
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      skip();
      return true;
    });
    return () => sub.remove();
  }, [active, skip]);

  const fadeStyle = useAnimatedStyle(() => ({ opacity: opacity.value }));
  const stepStyle = useAnimatedStyle(() => ({ opacity: stepOpacity.value, transform: [{ translateY: stepTranslate.value }] }));

  if (!active) return null;

  const step = steps[stepIndex];
  const target = step.targetKey ? targets[step.targetKey] : undefined;
  const isLast = stepIndex === steps.length - 1;

  const { slotStyle, arrowSide } = computePlacement(target, targets, step.targetKey, screenH, insets.top, insets.bottom);

  const arrowOffset = target
    ? Math.min(Math.max(target.x + target.width / 2, SCREEN_PADDING + 20), screenW - SCREEN_PADDING - 20) - SCREEN_PADDING
    : 0;

  // Deliberately NOT a <Modal> — a Modal opens its own native window
  // with its own coordinate origin, which does not reliably line up
  // with the window every target was measured in via measureInWindow
  // (most visibly on Android, where the status bar can offset one
  // window's origin from the other). Rendering in-tree, in the exact
  // same window as the rest of the app (the same pattern AppLockGate
  // already uses for its own non-Modal children), guarantees the
  // numbers line up by construction.
  return (
    <RAnimated.View style={[StyleSheet.absoluteFill, fadeStyle, styles.root]} accessibilityViewIsModal pointerEvents="box-none">
      <RAnimated.View style={[StyleSheet.absoluteFill, stepStyle]} pointerEvents="box-none">
        <Spotlight target={target} screenWidth={screenW} screenHeight={screenH} padding={PAD} ringColor={palette.primary} />

        <View style={slotStyle} pointerEvents="box-none">
          <OnboardingTooltip
            title={step.title}
            body={step.body}
            stepIndex={stepIndex}
            stepCount={steps.length}
            isLast={isLast}
            onSkip={skip}
            onNext={next}
            arrowSide={arrowSide}
            arrowOffset={arrowOffset}
            surfaceColor={palette.surface}
            primaryColor={palette.primary}
            textColor={palette.text}
            mutedColor={palette.textMuted}
            borderColor={palette.border}
          />
        </View>
      </RAnimated.View>
    </RAnimated.View>
  );
}

const styles = StyleSheet.create({
  // High enough to sit above the tab bar's own elevation and any screen
  // content, without needing a separate native window.
  root: { zIndex: 1000, elevation: 1000 },
});

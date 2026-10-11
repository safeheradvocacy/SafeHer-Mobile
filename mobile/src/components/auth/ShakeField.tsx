import React, { useEffect } from 'react';
import Animated, { useSharedValue, useAnimatedStyle, withSequence, withTiming } from 'react-native-reanimated';

/**
 * Wraps a single field and gives it a brief, subtle horizontal shake
 * whenever `trigger` changes — used on the Login and Forgot Password
 * screens so a validation failure calls out the specific field involved
 * rather than the whole form. Pass an incrementing counter (not the error
 * string itself) as `trigger` so repeated identical failures still shake.
 * Skipped entirely under Reduce Motion — the field's error text alone
 * still communicates the failure.
 */
export function ShakeField({ trigger, reduced, children }: { trigger: number; reduced: boolean; children: React.ReactNode }) {
  const translateX = useSharedValue(0);
  useEffect(() => {
    if (!trigger || reduced) return;
    translateX.value = withSequence(
      withTiming(-6, { duration: 45 }),
      withTiming(6, { duration: 90 }),
      withTiming(-4, { duration: 90 }),
      withTiming(0, { duration: 60 })
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trigger]);
  const style = useAnimatedStyle(() => ({ transform: [{ translateX: translateX.value }] }));
  return <Animated.View style={style}>{children}</Animated.View>;
}

import React, { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, { useSharedValue, useAnimatedStyle, withRepeat, withSequence, withTiming, Easing } from 'react-native-reanimated';
import { useTheme } from '../../contexts/ThemeContext';

type Axis = 'horizontal' | 'vertical' | 'diagonal';

function Blob({
  size,
  top,
  left,
  color,
  axis,
  distance,
  duration,
  baseOpacity,
  reduced,
}: {
  size: number;
  top: number;
  left: number;
  color: string;
  axis: Axis;
  distance: number;
  duration: number;
  baseOpacity: number;
  reduced: boolean;
}) {
  const offset = useSharedValue(0);

  useEffect(() => {
    if (reduced) return;
    offset.value = withRepeat(
      withSequence(
        withTiming(1, { duration, easing: Easing.inOut(Easing.sin) }),
        withTiming(0, { duration, easing: Easing.inOut(Easing.sin) })
      ),
      -1,
      true
    );
  }, [offset, duration, reduced]);

  const animatedStyle = useAnimatedStyle(() => {
    const dx = axis === 'horizontal' || axis === 'diagonal' ? offset.value * distance : 0;
    const dy = axis === 'vertical' || axis === 'diagonal' ? offset.value * distance : 0;
    return {
      transform: [{ translateX: dx }, { translateY: dy }],
      opacity: baseOpacity + offset.value * 0.06,
    };
  });

  return (
    <Animated.View
      style={[
        {
          position: 'absolute',
          top,
          left,
          width: size,
          height: size,
          borderRadius: size / 2,
          backgroundColor: color,
        },
        animatedStyle,
      ]}
    />
  );
}

// Ambient, non-decorative-for-its-own-sake background: three soft,
// low-opacity circles that drift slowly (8-20px over 6-12s each). Kept
// tucked toward screen edges/corners and clear of the header-through-
// quick-actions zone specifically, where they'd otherwise sit directly
// behind the greeting text or the SOS/action cards and reduce contrast —
// these should be discovered on a second look, not noticed immediately.
// pointerEvents="none" so nothing here can ever intercept a touch, and it
// renders behind the ScrollView so it never moves with scrolled content.
// Skips the drift entirely under Reduce Motion — the blobs still render,
// just hold still, since they're low-opacity color, not motion.
export function AnimatedBackground({ reduced }: { reduced: boolean }) {
  const { palette } = useTheme();
  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      <Blob size={210} top={-95} left={-85} color={palette.primaryLight} axis="horizontal" distance={14} duration={7000} baseOpacity={0.10} reduced={reduced} />
      <Blob size={170} top={470} left={300} color={palette.accent} axis="vertical" distance={12} duration={8500} baseOpacity={0.08} reduced={reduced} />
      <Blob size={150} top={780} left={-75} color={palette.danger} axis="diagonal" distance={10} duration={9500} baseOpacity={0.045} reduced={reduced} />
    </View>
  );
}

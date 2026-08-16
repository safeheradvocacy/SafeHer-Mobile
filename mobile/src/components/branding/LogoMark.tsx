import React from 'react';
import { View, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '../../theme/theme';

/**
 * Single integration point for the official SafeHer logo. Every branded
 * screen (Splash, Welcome, Login, Register) renders through this component
 * instead of drawing its own badge — so once the real asset is in place at
 * src/assets/branding/safeher-logo.png, swapping the placeholder below for
 *   <Image source={require('../../assets/branding/safeher-logo.png')} style={{ width: dimension, height: dimension }} resizeMode="contain" />
 * updates the whole app in one place. Do not redraw the mark elsewhere.
 */

const SIZES = { sm: 40, md: 56, lg: 88 } as const;

export function LogoMark({
  size = 'md',
  tone = 'onLight',
}: {
  size?: keyof typeof SIZES | number;
  tone?: 'onLight' | 'onDark';
}) {
  const dimension = typeof size === 'number' ? size : SIZES[size];
  return (
    <View
      style={[
        styles.mark,
        {
          width: dimension,
          height: dimension,
          borderRadius: dimension / 2,
          backgroundColor: tone === 'onDark' ? colors.white : colors.primaryLight,
        },
      ]}
    >
      <Ionicons name="shield-checkmark" size={dimension * 0.46} color={colors.primary} />
    </View>
  );
}

const styles = StyleSheet.create({
  mark: { alignItems: 'center', justifyContent: 'center' },
});

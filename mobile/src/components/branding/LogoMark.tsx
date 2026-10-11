import React from 'react';
import { Text } from 'react-native';
import { useTheme } from '../../contexts/ThemeContext';

/**
 * The SafeSpace brand mark. No official logo graphic exists — the
 * previous "LogoMark" rendered the old SafeHer shield/mother-child
 * image (a purple-to-pink gradient PNG tied to the retired brand), which
 * has been removed outright rather than recolored or varied. Per the
 * brief: do not invent a replacement icon. This renders plain
 * typography instead — every former call site (Splash, Welcome, Home
 * header, Login, Email Verification, App Lock) still imports this same
 * component, just laid out without the circular badge/shadow wrapper
 * that used to frame the image (a wordmark needs no such frame).
 */
const SIZES = { sm: 16, md: 20, lg: 28 } as const;

export function LogoMark({ size = 'md' }: { size?: keyof typeof SIZES | number }) {
  const { palette } = useTheme();
  const fontSize = typeof size === 'number' ? size : SIZES[size];
  return (
    <Text
      style={{ fontFamily: 'PlusJakartaSans_700Bold', fontSize, color: palette.primaryDark, letterSpacing: 0.2, textAlign: 'center' }}
      accessibilityRole="text"
      accessibilityLabel="SafeSpace"
    >
      SafeSpace
    </Text>
  );
}

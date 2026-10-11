import React, { useRef, useState } from 'react';
import { View, Text, StyleSheet, Pressable, TextInput, useWindowDimensions } from 'react-native';
import { useTheme } from '../contexts/ThemeContext';
import { spacing, typography, radius } from '../theme/theme';

// Extracted from the original EmailVerificationScreen so the same
// paste-friendly, auto-advancing OTP box UI is shared by every email
// OTP flow in the app (signup email verification, change-password
// email OTP) instead of being copy-pasted per screen.
export const DEFAULT_CODE_LENGTH = 8;
const MIN_BOX_SIZE = 30;
const MAX_BOX_SIZE = 44;

/** Masks everything but the first couple characters of the local part —
 * enough to confirm "yes, this is my email" without displaying it in
 * full on a screen someone might be able to see over your shoulder.
 * `jo***@example.com` rather than `john.doe@example.com`. */
export function maskEmail(email: string): string {
  const [local, domain] = email.split('@');
  if (!local || !domain) return email;
  const visible = local.slice(0, Math.min(2, local.length));
  return `${visible}${'*'.repeat(Math.max(3, local.length - visible.length))}@${domain}`;
}

/**
 * CODE_LENGTH visual boxes over a single hidden TextInput — this is what
 * makes paste-the-whole-code, auto-advance-to-the-next-box, and
 * backspace-to-the-previous-box all work for free, rather than juggling
 * refs and onKeyPress backspace detection across separate per-digit
 * inputs (notoriously fiddly on Android, and paste support across
 * several inputs is worse still). There's only one real field — typing
 * or deleting a character naturally moves the "active box" highlight
 * forward/back since it's derived from the string's length. Tapping
 * anywhere in the row focuses the real input underneath.
 */
export function OtpInput({
  value,
  onChangeText,
  autoFocus,
  codeLength = DEFAULT_CODE_LENGTH,
}: {
  value: string;
  onChangeText: (v: string) => void;
  autoFocus?: boolean;
  codeLength?: number;
}) {
  const { palette } = useTheme();
  const { width: screenWidth } = useWindowDimensions();
  const inputRef = useRef<TextInput>(null);
  const [focused, setFocused] = useState(false);

  const gap = 6;
  const availableWidth = screenWidth - spacing.lg * 2 - 8;
  const rawBoxSize = (availableWidth - gap * (codeLength - 1)) / codeLength;
  const boxSize = Math.max(MIN_BOX_SIZE, Math.min(MAX_BOX_SIZE, Math.floor(rawBoxSize)));
  const digitFontSize = Math.max(16, Math.min(22, Math.round(boxSize * 0.5)));

  return (
    <Pressable onPress={() => inputRef.current?.focus()} style={[styles.otpRow, { gap }]} accessibilityRole="none">
      <TextInput
        ref={inputRef}
        value={value}
        onChangeText={(v) => onChangeText(v.replace(/[^0-9]/g, '').slice(0, codeLength))}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        keyboardType="number-pad"
        maxLength={codeLength}
        autoFocus={autoFocus}
        textContentType="oneTimeCode"
        style={styles.hiddenInput}
        accessibilityLabel={`${codeLength}-digit verification code`}
        caretHidden
      />
      {Array.from({ length: codeLength }).map((_, i) => {
        const isCursor = focused && i === value.length;
        const filled = i < value.length;
        return (
          <View
            key={i}
            style={[
              styles.otpBox,
              { width: boxSize, height: boxSize * 1.18, borderColor: palette.border, backgroundColor: palette.surface },
              (isCursor || filled) ? { borderColor: palette.primary } : null,
            ]}
          >
            <Text style={[styles.otpDigit, { color: palette.text, fontSize: digitFontSize, lineHeight: digitFontSize * 1.2 }]}>
              {value[i] ?? ''}
            </Text>
          </View>
        );
      })}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  otpRow: { flexDirection: 'row', justifyContent: 'center' },
  hiddenInput: { position: 'absolute', width: '100%', height: '100%', opacity: 0 },
  otpBox: {
    borderRadius: radius.sm,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  otpDigit: { fontFamily: typography.heading.fontFamily },
});

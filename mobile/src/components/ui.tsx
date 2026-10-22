import React, { useEffect, useState } from 'react';
import {
  AccessibilityInfo,
  ActivityIndicator,
  FlatList,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  TextInputProps,
  View,
  ScrollView,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import Animated, { useSharedValue, useAnimatedStyle, withTiming, withDelay, Easing } from 'react-native-reanimated';
import { colors, radius, shadows, spacing, statusColors, typography } from '../theme/theme';
import { useTheme } from '../contexts/ThemeContext';

export type IoniconName = React.ComponentProps<typeof Ionicons>['name'];

/** True once we know the OS reduce-motion preference; defaults to false
 * (full animation) until the async check resolves, which on real devices
 * happens well before the first paint that would use it. */
export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    let mounted = true;
    AccessibilityInfo.isReduceMotionEnabled?.().then((v) => mounted && setReduced(v));
    const sub = AccessibilityInfo.addEventListener?.('reduceMotionChanged', setReduced);
    return () => {
      mounted = false;
      sub?.remove?.();
    };
  }, []);
  return reduced;
}

/** Fade + slight upward rise, staggered by `delay` — the shared entrance
 * effect used across auth screens so a sequence reads as one
 * choreographed reveal rather than several different animations. */
export function FadeInUp({
  delay = 0,
  duration = 380,
  distance = 14,
  reduced,
  style,
  children,
}: {
  delay?: number;
  duration?: number;
  distance?: number;
  reduced: boolean;
  style?: object;
  children: React.ReactNode;
}) {
  const progress = useSharedValue(0);
  useEffect(() => {
    // Reduce Motion removes the rise (translateY below is gated on
    // `reduced` too) but still gets a quick plain fade rather than an
    // instant snap-into-place — a fade carries no directional/spatial
    // motion, so it stays within what Reduce Motion asks for while still
    // keeping the entrance from feeling abrupt.
    if (reduced) {
      progress.value = withDelay(delay, withTiming(1, { duration: 180 }));
      return;
    }
    progress.value = withDelay(delay, withTiming(1, { duration, easing: Easing.out(Easing.cubic) }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reduced]);
  const animatedStyle = useAnimatedStyle(() => ({
    opacity: progress.value,
    transform: [{ translateY: reduced ? 0 : (1 - progress.value) * distance }],
  }));
  return <Animated.View style={[style, animatedStyle]}>{children}</Animated.View>;
}

/**
 * Shared 1.00 -> 0.97 press-scale feedback for any tappable element —
 * quick action cards, the SOS card, header icon buttons, "View all" links,
 * case cards. Wraps a single child in a Pressable + Animated.View so
 * callers don't each hand-roll their own shared value.
 */
export function PressableScale({
  onPress,
  style,
  children,
  accessibilityLabel,
  accessibilityHint,
  accessibilityRole = 'button',
  disabled,
  hitSlop,
  pressScale = 0.97,
}: {
  onPress: () => void;
  style?: object;
  children: React.ReactNode;
  accessibilityLabel?: string;
  accessibilityHint?: string;
  accessibilityRole?: React.ComponentProps<typeof Pressable>['accessibilityRole'];
  disabled?: boolean;
  hitSlop?: number;
  /** How far the element compresses on press (1 = no shrink). Default
   * 0.97 suits most controls; more tactile "clay" controls (e.g. the
   * onboarding header's circular buttons) use a more pronounced ~0.94. */
  pressScale?: number;
}) {
  const scale = useSharedValue(1);
  const animatedStyle = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));

  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      hitSlop={hitSlop}
      onPressIn={() => {
        scale.value = withTiming(pressScale, { duration: 100 });
      }}
      onPressOut={() => {
        scale.value = withTiming(1, { duration: 120 });
      }}
      accessibilityRole={accessibilityRole}
      accessibilityLabel={accessibilityLabel}
      accessibilityHint={accessibilityHint}
    >
      <Animated.View style={[style, animatedStyle]}>{children}</Animated.View>
    </Pressable>
  );
}

export function Screen({ children, scroll = true }: { children: React.ReactNode; scroll?: boolean }) {
  const { palette } = useTheme();
  const Wrapper = scroll ? ScrollView : View;
  return (
    <SafeAreaView style={[styles.screen, { backgroundColor: palette.background }]}>
      <KeyboardAvoidingView style={styles.flexFill} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <Wrapper
          contentContainerStyle={scroll ? styles.scrollContent : styles.flexFill}
          style={styles.flexFill}
          keyboardShouldPersistTaps="handled"
        >
          {children}
        </Wrapper>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

export function Card({ children, style }: { children: React.ReactNode; style?: object }) {
  const { palette } = useTheme();
  return <View style={[styles.card, { backgroundColor: palette.surface, borderColor: palette.border }, style]}>{children}</View>;
}

/**
 * Press feedback for the primary (gradient) button specifically: a slight
 * scale-down plus the elevation shadow softening, rather than just an
 * opacity dip — reads as "this surface is being pressed" instead of
 * "this is fading out". Kept separate from PressableScale because the
 * shadow lives on the OUTER Pressable (styles.buttonShadow) while the
 * gradient fill is a child, so both need to animate together.
 */
function PrimaryPressable({
  onPress,
  disabled,
  loading,
  label,
  shadowStyle,
  fillStyle,
  reduced = false,
  children,
}: {
  onPress: () => void;
  disabled?: boolean;
  loading?: boolean;
  label: string;
  /** Overrides for the "large/clay" CTA variant — layered after the base
   * styles so callers only need to specify what differs (radius/height),
   * not redeclare the whole shadow/gradient setup. */
  shadowStyle?: object;
  fillStyle?: object;
  /** Under Reduce Motion, skip the scale/translateY "physical push" but
   * keep the shadow-softening — a non-spatial cue so the button still
   * visibly responds to touch instead of giving no feedback at all. */
  reduced?: boolean;
  children: React.ReactNode;
}) {
  const { palette } = useTheme();
  const scale = useSharedValue(1);
  const translateY = useSharedValue(0);
  const shadowOpacity = useSharedValue(0.28);
  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }, { translateY: translateY.value }],
    shadowOpacity: shadowOpacity.value,
  }));

  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled, busy: loading }}
      onPressIn={() => {
        if (!reduced) {
          scale.value = withTiming(0.97, { duration: 120 });
          translateY.value = withTiming(2, { duration: 120 });
        }
        shadowOpacity.value = withTiming(0.14, { duration: reduced ? 80 : 120 });
      }}
      onPressOut={() => {
        if (!reduced) {
          scale.value = withTiming(1, { duration: 200 });
          translateY.value = withTiming(0, { duration: 200 });
        }
        shadowOpacity.value = withTiming(0.28, { duration: reduced ? 120 : 200 });
      }}
    >
      <Animated.View style={[styles.buttonShadow, { shadowColor: palette.primaryDark }, shadowStyle, animatedStyle, disabled ? { opacity: 0.5 } : null]}>
        <LinearGradient colors={[palette.primary, palette.primaryDark]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={[styles.button, fillStyle]}>
          {/* Soft upper-portion sheen — the "gentle highlight" that reads
              as a physical, slightly convex surface rather than a flat
              gradient fill. */}
          <LinearGradient
            colors={['rgba(255,255,255,0.24)', 'rgba(255,255,255,0)']}
            start={{ x: 0, y: 0 }}
            end={{ x: 0, y: 0.85 }}
            style={StyleSheet.absoluteFill}
            pointerEvents="none"
          />
          {children}
        </LinearGradient>
      </Animated.View>
    </Pressable>
  );
}

export function PrimaryButton({
  title,
  loadingTitle,
  onPress,
  loading,
  disabled,
  variant = 'primary',
  icon,
  size = 'md',
  reduced = false,
}: {
  title: string;
  /** Shown alongside the spinner while `loading` is true (e.g. "Logging
   * in..."). Falls back to `title` if omitted. */
  loadingTitle?: string;
  onPress: () => void;
  loading?: boolean;
  disabled?: boolean;
  variant?: 'primary' | 'danger' | 'outline' | 'tertiary';
  icon?: IoniconName;
  /** 'lg' is the hero-CTA treatment (bigger, more rounded, more
   * pronounced clay shadow) — currently used by onboarding's Next/Get
   * Started. 'md' (default) is unchanged from before. Only affects the
   * primary variant. */
  size?: 'md' | 'lg';
  /** Reduce Motion: skips the primary variant's scale/translateY press
   * feedback (keeps the shadow-softening). Defaults to false so existing
   * callers that don't track a reduced-motion preference are unaffected. */
  reduced?: boolean;
}) {
  const { palette } = useTheme();
  // Only used by the 'tertiary' branch below, but declared unconditionally
  // per the rules of hooks — a plain opacity dim read as "fading out"
  // rather than "being pressed", so Log in (and any other tertiary
  // action) now gets the same very-subtle-scale tactile language as
  // every other interactive element, without becoming a raised button.
  const tertiaryScale = useSharedValue(1);
  const tertiaryAnimatedStyle = useAnimatedStyle(() => ({ transform: [{ scale: tertiaryScale.value }] }));

  const textColor = variant === 'outline' || variant === 'tertiary' ? palette.primary : palette.white;
  const content = loading ? (
    <View style={styles.buttonContent}>
      <ActivityIndicator color={textColor} style={{ marginRight: spacing.xs }} />
      <Text style={[typography.button, size === 'lg' ? styles.buttonTextLg : null, { color: textColor }]}>{loadingTitle ?? title}</Text>
    </View>
  ) : (
    <View style={styles.buttonContent}>
      {icon ? <Ionicons name={icon} size={18} color={textColor} style={{ marginRight: spacing.xs }} /> : null}
      <Text style={[typography.button, size === 'lg' ? styles.buttonTextLg : null, { color: textColor }]}>{title}</Text>
    </View>
  );

  if (variant === 'primary') {
    return (
      <PrimaryPressable
        onPress={onPress}
        disabled={disabled || loading}
        loading={loading}
        label={title}
        shadowStyle={size === 'lg' ? styles.buttonShadowLg : undefined}
        fillStyle={size === 'lg' ? styles.buttonLg : undefined}
        reduced={reduced}
      >
        {content}
      </PrimaryPressable>
    );
  }

  if (variant === 'tertiary') {
    return (
      <Pressable
        onPress={onPress}
        disabled={disabled || loading}
        hitSlop={8}
        accessibilityRole="button"
        accessibilityLabel={title}
        accessibilityState={{ disabled: disabled || loading, busy: loading }}
        onPressIn={() => {
          if (!reduced) tertiaryScale.value = withTiming(0.97, { duration: 100 });
        }}
        onPressOut={() => {
          if (!reduced) tertiaryScale.value = withTiming(1, { duration: 160 });
        }}
        style={({ pressed }) => [styles.buttonTertiary, { opacity: pressed ? 0.7 : disabled ? 0.4 : 1 }]}
      >
        <Animated.View style={tertiaryAnimatedStyle}>{content}</Animated.View>
      </Pressable>
    );
  }

  const bg = variant === 'danger' ? palette.danger : 'transparent';
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled || loading}
      accessibilityRole="button"
      accessibilityLabel={title}
      accessibilityState={{ disabled: disabled || loading, busy: loading }}
      style={({ pressed }) => [
        styles.button,
        { backgroundColor: bg, marginTop: spacing.sm, opacity: pressed ? 0.85 : disabled ? 0.5 : 1 },
        variant === 'outline' ? [styles.buttonOutline, { borderColor: palette.primary }] : null,
      ]}
    >
      {content}
    </Pressable>
  );
}

export function IconContainer({
  icon,
  size = 56,
  tint,
  tone = 'soft',
}: {
  icon: IoniconName;
  size?: number;
  tint?: string;
  tone?: 'soft' | 'solid';
}) {
  const { palette } = useTheme();
  const resolvedTint = tint ?? palette.primary;
  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: tone === 'solid' ? resolvedTint : resolvedTint + '1F',
      }}
    >
      <Ionicons name={icon} size={size * 0.42} color={tone === 'solid' ? palette.white : resolvedTint} />
    </View>
  );
}

export function Input(
  props: TextInputProps & { label?: string; error?: string; icon?: IoniconName; rightElement?: React.ReactNode }
) {
  const { palette } = useTheme();
  const { label, error, icon, rightElement, style, onFocus, onBlur, ...rest } = props;
  const [focused, setFocused] = useState(false);
  return (
    <View style={{ marginBottom: spacing.md }}>
      {label ? <Text style={[styles.inputLabel, { color: palette.text }]}>{label}</Text> : null}
      <View style={styles.inputRow}>
        {icon ? (
          <View style={styles.inputIconLeft} pointerEvents="none">
            <Ionicons name={icon} size={18} color={focused ? palette.primary : palette.textMuted} />
          </View>
        ) : null}
        <TextInput
          placeholderTextColor={palette.textMuted}
          style={[
            styles.input,
            { borderColor: palette.border, color: palette.text, backgroundColor: palette.surface },
            icon ? styles.inputPaddedLeft : null,
            rightElement ? styles.inputPaddedRight : null,
            focused ? [styles.inputFocused, { borderColor: palette.primary, shadowColor: palette.primary }] : null,
            error ? { borderColor: palette.danger } : null,
            style,
          ]}
          onFocus={(e) => {
            setFocused(true);
            onFocus?.(e);
          }}
          onBlur={(e) => {
            setFocused(false);
            onBlur?.(e);
          }}
          {...rest}
        />
        {rightElement ? <View style={styles.inputIconRight}>{rightElement}</View> : null}
      </View>
      {error ? <Text style={[styles.errorText, { color: palette.danger }]}>{error}</Text> : null}
    </View>
  );
}

/** Eye / eye-off crossfade rather than an instant icon swap — both icons
 * are stacked in the same spot and cross-dissolve with a slight scale, so
 * the toggle reads as one control changing state rather than a flicker.
 * Same Ionicons "outline" family and size as the field's own lock icon
 * for visual consistency; padded to a real ~44px touch target. */
function PasswordVisibilityToggle({ visible, onToggle }: { visible: boolean; onToggle: () => void }) {
  const { palette } = useTheme();
  // progress: 0 = password hidden (show the slashed "eye-off" icon),
  // 1 = password visible (show the open "eye" icon). Both icons are
  // driven off this one value derived directly from `visible` — the same
  // boolean that controls secureTextEntry on the field itself — so the
  // icon can never drift out of sync with the actual masking state.
  const progress = useSharedValue(visible ? 1 : 0);
  React.useEffect(() => {
    progress.value = withTiming(visible ? 1 : 0, { duration: 180 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);
  // Open eye fades in as the password becomes visible (progress -> 1).
  const eyeOpenStyle = useAnimatedStyle(() => ({ opacity: progress.value, transform: [{ scale: 0.88 + progress.value * 0.12 }] }));
  // Slashed eye fades in as the password becomes hidden (progress -> 0).
  const eyeOffStyle = useAnimatedStyle(() => ({ opacity: 1 - progress.value, transform: [{ scale: 1 - progress.value * 0.12 }] }));

  return (
    <Pressable
      onPress={onToggle}
      hitSlop={10}
      style={styles.passwordToggle}
      accessibilityRole="button"
      accessibilityLabel={visible ? 'Hide password' : 'Show password'}
    >
      <View style={styles.passwordToggleIconBox}>
        <Animated.View style={[StyleSheet.absoluteFill, styles.passwordToggleIcon, eyeOffStyle]}>
          <Ionicons name="eye-off-outline" size={18} color={palette.textMuted} />
        </Animated.View>
        <Animated.View style={[StyleSheet.absoluteFill, styles.passwordToggleIcon, eyeOpenStyle]}>
          <Ionicons name="eye-outline" size={18} color={palette.textMuted} />
        </Animated.View>
      </View>
    </Pressable>
  );
}

export function PasswordInput(props: TextInputProps & { label?: string; error?: string; showStrength?: boolean }) {
  const { showStrength, value, ...rest } = props;
  const [visible, setVisible] = useState(false);
  return (
    <View>
      <Input
        {...rest}
        value={value}
        secureTextEntry={!visible}
        icon="lock-closed-outline"
        rightElement={<PasswordVisibilityToggle visible={visible} onToggle={() => setVisible((v) => !v)} />}
      />
      {showStrength ? <PasswordStrengthMeter password={typeof value === 'string' ? value : ''} /> : null}
    </View>
  );
}

const PASSWORD_RULES: { label: string; test: (pw: string) => boolean }[] = [
  { label: 'At least 8 characters', test: (pw) => pw.length >= 8 },
  { label: 'One uppercase letter', test: (pw) => /[A-Z]/.test(pw) },
  { label: 'One number', test: (pw) => /[0-9]/.test(pw) },
];

const STRENGTH_LABELS = ['Too weak', 'Weak', 'Fair', 'Good', 'Strong'];

function scorePassword(pw: string) {
  if (!pw) return 0;
  let score = PASSWORD_RULES.filter((r) => r.test(pw)).length;
  if (pw.length >= 12) score += 1;
  return Math.min(score, 4);
}

export function PasswordStrengthMeter({ password }: { password: string }) {
  const { palette } = useTheme();
  const score = scorePassword(password);
  const strengthColors = [palette.danger, palette.danger, palette.warning, palette.info, palette.success];
  const tint = strengthColors[score];
  return (
    <View style={styles.strengthWrap}>
      <View style={styles.strengthBar}>
        {[0, 1, 2, 3].map((i) => (
          <View key={i} style={[styles.strengthSegment, { backgroundColor: i < score ? tint : palette.border }]} />
        ))}
      </View>
      {password ? <Text style={[styles.strengthLabel, { color: tint }]}>{STRENGTH_LABELS[score]}</Text> : null}
      <View style={styles.requirementsList}>
        {PASSWORD_RULES.map((rule) => {
          const met = rule.test(password);
          return (
            <View key={rule.label} style={styles.requirementRow}>
              <Ionicons
                name={met ? 'checkmark-circle' : 'ellipse-outline'}
                size={14}
                color={met ? palette.success : palette.textMuted}
              />
              <Text style={[styles.requirementText, { color: palette.textMuted }, met ? { color: palette.text } : null]}>{rule.label}</Text>
            </View>
          );
        })}
      </View>
    </View>
  );
}

/**
 * A compact trigger field (label, current value, chevron-down) that opens
 * a proper bottom-sheet drawer — slide-up, dimmed backdrop, rounded top
 * corners, drag handle, safe-area-aware bottom padding, optional search —
 * instead of a plain centered dialog. Every existing caller (incident
 * timing, third-party age range, and others) keeps working with the exact
 * same required props; `indicator`/`searchable` are additive and default
 * to the previous look (a trailing checkmark, no search row), so this is
 * a visual/behavioral upgrade of the one existing component, not a new
 * one — every screen using DropdownInput gets the drawer treatment for
 * free rather than each needing its own bespoke picker.
 */
export function DropdownInput({
  label,
  placeholder = 'Select an option',
  value,
  options,
  onSelect,
  error,
  disabled,
  searchable = false,
  /** 'check' (default, unchanged) shows a trailing checkmark on the
   * selected row. 'radio' shows a leading radio-button icon instead —
   * used where the drawer is explicitly a single-choice list the brief
   * wants presented with a radio control (e.g. case type). */
  indicator = 'check',
}: {
  label?: string;
  placeholder?: string;
  value: string | null;
  options: { label: string; value: string }[];
  onSelect: (value: string) => void;
  error?: string;
  disabled?: boolean;
  searchable?: boolean;
  indicator?: 'check' | 'radio';
}) {
  const { palette } = useTheme();
  const insets = useSafeAreaInsets();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const selected = options.find((o) => o.value === value);
  const filtered = searchable && query.trim() ? options.filter((o) => o.label.toLowerCase().includes(query.trim().toLowerCase())) : options;

  const close = () => {
    setOpen(false);
    setQuery('');
  };

  return (
    <View style={{ marginBottom: spacing.md }}>
      {label ? <Text style={[styles.inputLabel, { color: palette.text }]}>{label}</Text> : null}
      <Pressable
        onPress={() => !disabled && setOpen(true)}
        style={[
          styles.input,
          styles.dropdownTrigger,
          { borderColor: palette.border, backgroundColor: palette.surface },
          error ? { borderColor: palette.danger } : null,
          disabled ? { opacity: 0.5 } : null,
        ]}
        accessibilityRole="button"
        accessibilityLabel={label ?? placeholder}
        accessibilityHint={`Opens a list to choose ${(label ?? placeholder).toLowerCase()}`}
      >
        <Text style={[selected ? styles.dropdownValue : styles.dropdownPlaceholder, { color: selected ? palette.text : palette.textMuted }]} numberOfLines={1}>
          {selected ? selected.label : placeholder}
        </Text>
        <Ionicons name="chevron-down" size={18} color={palette.textMuted} />
      </Pressable>
      {error ? <Text style={[styles.errorText, { color: palette.danger }]}>{error}</Text> : null}

      <Modal visible={open} transparent animationType="slide" onRequestClose={close}>
        <Pressable style={styles.modalBackdrop} onPress={close} accessibilityViewIsModal accessibilityLabel={`${label ?? 'Selection'} options`}>
          {/* Swallows taps so touching the sheet itself (its padding, the
              title, between list rows) doesn't fall through to the
              backdrop's onPress and close the drawer unexpectedly — the
              bug the previous centered-dialog version had. */}
          <Pressable style={[styles.modalSheet, { backgroundColor: palette.surface, paddingBottom: Math.max(spacing.xl, insets.bottom + spacing.md) }]} onPress={(e) => e.stopPropagation()}>
            <View style={[styles.sheetHandle, { backgroundColor: palette.border }]} />
            <Text style={[styles.modalTitle, { color: palette.text }]}>{label ?? 'Select an option'}</Text>

            {searchable ? (
              <View style={[styles.sheetSearchRow, { backgroundColor: palette.surfaceMuted }]}>
                <Ionicons name="search" size={17} color={palette.textMuted} />
                <TextInput
                  value={query}
                  onChangeText={setQuery}
                  placeholder="Search"
                  placeholderTextColor={palette.textMuted}
                  style={[styles.sheetSearchInput, { color: palette.text }]}
                  accessibilityLabel={`Search ${label ?? 'options'}`}
                />
                {query.length > 0 ? (
                  <Pressable onPress={() => setQuery('')} hitSlop={8} accessibilityLabel="Clear search">
                    <Ionicons name="close-circle" size={17} color={palette.textMuted} />
                  </Pressable>
                ) : null}
              </View>
            ) : null}

            {filtered.length === 0 ? (
              <Text style={[styles.dropdownPlaceholder, { color: palette.textMuted, paddingVertical: spacing.lg, textAlign: 'center' }]}>
                No matches found.
              </Text>
            ) : (
              <FlatList
                data={filtered}
                keyExtractor={(o) => o.value}
                style={{ maxHeight: 360 }}
                keyboardShouldPersistTaps="handled"
                showsVerticalScrollIndicator={false}
                renderItem={({ item }) => {
                  const active = item.value === value;
                  return (
                    <Pressable
                      onPress={() => {
                        onSelect(item.value);
                        close();
                      }}
                      style={({ pressed }) => [styles.modalOption, pressed ? { opacity: 0.7 } : null]}
                      accessibilityRole={indicator === 'radio' ? 'radio' : 'button'}
                      accessibilityState={{ selected: active, checked: indicator === 'radio' ? active : undefined }}
                      accessibilityLabel={item.label}
                    >
                      {indicator === 'radio' ? (
                        <Ionicons name={active ? 'radio-button-on' : 'radio-button-off'} size={18} color={active ? palette.primary : palette.textMuted} style={{ marginRight: spacing.sm }} />
                      ) : null}
                      <Text style={[styles.modalOptionText, { color: active ? palette.primary : palette.text, flex: 1 }]}>{item.label}</Text>
                      {indicator === 'check' && active ? <Ionicons name="checkmark" size={18} color={palette.primary} /> : null}
                    </Pressable>
                  );
                }}
              />
            )}
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}

export function AlertMessage({
  variant = 'error',
  title,
  message,
  onRetry,
}: {
  variant?: 'error' | 'info' | 'success';
  title: string;
  message?: string;
  onRetry?: () => void;
}) {
  const { palette } = useTheme();
  const tint = variant === 'error' ? palette.danger : variant === 'success' ? palette.success : palette.info;
  const iconName = variant === 'error' ? 'alert-circle' : variant === 'success' ? 'checkmark-circle' : 'information-circle';
  return (
    <View style={[styles.alert, { borderColor: tint, backgroundColor: tint + '11' }]}>
      <Ionicons name={iconName} size={20} color={tint} />
      <View style={{ flex: 1, marginLeft: spacing.sm }}>
        <Text style={[styles.alertTitle, { color: tint }]}>{title}</Text>
        {message ? <Text style={[styles.alertMessage, { color: palette.textMuted }]}>{message}</Text> : null}
        {onRetry ? (
          <Pressable onPress={onRetry} hitSlop={8} style={{ marginTop: spacing.xs }}>
            <Text style={[styles.alertRetry, { color: tint }]}>Retry</Text>
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

export function PrivacyNotice({ heading, text }: { heading?: string; text?: string }) {
  const { palette } = useTheme();
  return (
    <View style={[styles.privacyCard, { backgroundColor: palette.primaryLight, shadowColor: palette.primaryDark }]}>
      <IconContainer icon="lock-closed" size={36} tint={palette.primary} />
      <View style={{ flex: 1, marginLeft: spacing.sm }}>
        {heading ? <Text style={[styles.privacyCardHeading, { color: palette.primaryDark }]}>{heading}</Text> : null}
        <Text style={[styles.privacyCardText, { color: palette.text }]}>
          {text ??
            'Your information is encrypted and only visible to authorized SafeSpace staff in your municipality.'}
        </Text>
      </View>
    </View>
  );
}

export function FeatureCard({
  icon,
  title,
  description,
  tint,
}: {
  icon: IoniconName;
  title: string;
  description: string;
  tint?: string;
}) {
  const { palette } = useTheme();
  return (
    <View style={[styles.featureCard, { backgroundColor: palette.surface }]}>
      <IconContainer icon={icon} size={40} tint={tint ?? palette.primary} />
      <Text style={[styles.featureTitle, { color: palette.text }]}>{title}</Text>
      <Text style={[styles.featureDescription, { color: palette.textMuted }]}>{description}</Text>
    </View>
  );
}

// `icon` is optional so every existing call site keeps working
// unchanged, but new callers (account/phone/identity verification
// states) pass one deliberately — status must never be conveyed by
// color alone, per SafeHer's accessibility requirement.
export function StatusBadge({ label, icon }: { label: string; icon?: IoniconName }) {
  const { palette } = useTheme();
  const bg = statusColors[label] ?? palette.textMuted;
  return (
    <View style={[styles.badge, { backgroundColor: bg + '22', borderColor: bg }]}>
      {icon ? <Ionicons name={icon} size={13} color={bg} style={{ marginRight: 4 }} /> : null}
      <Text style={[styles.badgeText, { color: bg }]}>{label}</Text>
    </View>
  );
}

export function EmptyState({ title, subtitle }: { title: string; subtitle?: string }) {
  const { palette } = useTheme();
  return (
    <View style={styles.empty}>
      <Text style={[styles.emptyTitle, { color: palette.text }]}>{title}</Text>
      {subtitle ? <Text style={[styles.emptySubtitle, { color: palette.textMuted }]}>{subtitle}</Text> : null}
    </View>
  );
}

export function SectionHeader({ title }: { title: string }) {
  const { palette } = useTheme();
  return <Text style={[styles.sectionHeader, { color: palette.text }]}>{title}</Text>;
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  flexFill: { flex: 1 },
  scrollContent: { padding: spacing.lg, paddingBottom: spacing.xxl },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: spacing.md,
    marginBottom: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
    ...shadows.sm,
  },
  button: {
    paddingVertical: 14,
    borderRadius: radius.button,
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonContent: { flexDirection: 'row', alignItems: 'center' },
  buttonShadow: {
    borderRadius: radius.button,
    marginTop: spacing.sm,
    shadowColor: colors.primaryDark,
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.28,
    shadowRadius: 10,
    elevation: 6,
  },
  // "Hero CTA" clay variant — taller, more rounded, a softer/broader
  // shadow than the standard button so it reads as the single most
  // tactile control on the screen (onboarding's Next/Get Started).
  buttonLg: { paddingVertical: 19, borderRadius: 20 },
  buttonShadowLg: {
    borderRadius: 20,
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.24,
    shadowRadius: 16,
    elevation: 8,
  },
  buttonTextLg: { fontSize: 18 },
  buttonOutline: { borderWidth: 1.5, borderColor: colors.primary },
  buttonTertiary: { paddingVertical: 10, alignItems: 'center', justifyContent: 'center' },
  inputLabel: { ...typography.bodyMedium, color: colors.text, marginBottom: spacing.xs },
  inputRow: { position: 'relative', justifyContent: 'center' },
  input: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: 12,
    ...typography.body,
    color: colors.text,
    backgroundColor: colors.surface,
  },
  inputFocused: {
    borderColor: colors.primary,
    borderWidth: 1.5,
    shadowColor: colors.primary,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.16,
    shadowRadius: 6,
    elevation: 2,
  },
  inputPaddedLeft: { paddingLeft: 44 },
  inputPaddedRight: { paddingRight: 44 },
  // Spans the full input height and centers its content via flex rather
  // than a fixed pixel offset — stays correctly centered regardless of
  // the exact rendered height of the icon/toggle inside it.
  inputIconLeft: { position: 'absolute', left: spacing.md, top: 0, bottom: 0, justifyContent: 'center', alignItems: 'center', zIndex: 1 },
  inputIconRight: { position: 'absolute', right: spacing.xs, top: 0, bottom: 0, justifyContent: 'center', alignItems: 'center', zIndex: 1 },
  // 44x44 real touch target (18px icon + 13px padding on each side).
  passwordToggle: { padding: 13, alignItems: 'center', justifyContent: 'center' },
  passwordToggleIconBox: { width: 18, height: 18 },
  passwordToggleIcon: { alignItems: 'center', justifyContent: 'center' },
  strengthWrap: { marginTop: -spacing.sm, marginBottom: spacing.md },
  strengthBar: { flexDirection: 'row', gap: 4 },
  strengthSegment: { flex: 1, height: 4, borderRadius: 2 },
  strengthLabel: { ...typography.caption, marginTop: spacing.xs, fontFamily: 'Inter_600SemiBold' as any },
  requirementsList: { marginTop: spacing.xs },
  requirementRow: { flexDirection: 'row', alignItems: 'center', marginTop: 2 },
  requirementText: { ...typography.caption, color: colors.textMuted, marginLeft: spacing.xs },
  requirementTextMet: { color: colors.text },
  errorText: { color: colors.danger, ...typography.caption, marginTop: spacing.xs },
  dropdownTrigger: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  dropdownValue: { ...typography.body, color: colors.text, flex: 1, marginRight: spacing.sm },
  dropdownPlaceholder: { ...typography.body, color: colors.textMuted, flex: 1, marginRight: spacing.sm },
  modalBackdrop: { flex: 1, backgroundColor: 'rgba(43,37,48,0.4)', justifyContent: 'flex-end' },
  modalSheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    padding: spacing.lg,
    paddingBottom: spacing.xl,
  },
  modalTitle: { ...typography.heading, color: colors.text, marginBottom: spacing.sm },
  sheetHandle: { width: 36, height: 4, borderRadius: 2, alignSelf: 'center', marginBottom: spacing.sm },
  sheetSearchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: radius.sm,
    paddingHorizontal: spacing.sm,
    height: 44,
    marginBottom: spacing.sm,
    gap: spacing.xs,
  },
  sheetSearchInput: { flex: 1, ...typography.body, height: '100%' },
  modalOption: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  modalOptionText: { ...typography.body, color: colors.text },
  modalOptionTextActive: { ...typography.bodyMedium, color: colors.primary },
  alert: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    borderWidth: 1,
    borderRadius: radius.md,
    padding: spacing.md,
    marginBottom: spacing.md,
  },
  alertTitle: { ...typography.bodyMedium },
  alertMessage: { ...typography.caption, color: colors.textMuted, marginTop: 2 },
  alertRetry: { ...typography.bodyMedium },
  privacyCard: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    backgroundColor: colors.primaryLight,
    borderRadius: radius.md,
    padding: spacing.md,
    marginTop: spacing.sm,
    marginBottom: spacing.md,
    ...shadows.sm,
  },
  privacyCardHeading: { ...typography.bodyMedium, color: colors.primaryDark, marginBottom: 2 },
  privacyCardText: { ...typography.caption, color: colors.text, flex: 1, lineHeight: 18 },
  featureCard: {
    flex: 1,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    ...shadows.sm,
  },
  featureTitle: { ...typography.bodyMedium, color: colors.text, marginTop: spacing.sm, marginBottom: 2 },
  featureDescription: { ...typography.caption, color: colors.textMuted, lineHeight: 16 },
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
    borderRadius: radius.pill,
    borderWidth: 1,
  },
  badgeText: { ...typography.caption, fontFamily: 'Inter_600SemiBold' as any },
  empty: { alignItems: 'center', paddingVertical: spacing.xxl },
  emptyTitle: { ...typography.subheading, color: colors.text },
  emptySubtitle: { ...typography.caption, color: colors.textMuted, marginTop: spacing.xs, textAlign: 'center' },
  sectionHeader: { ...typography.heading, color: colors.text, marginBottom: spacing.sm },
});

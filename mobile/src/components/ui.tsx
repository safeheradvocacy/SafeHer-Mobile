import React, { useState } from 'react';
import {
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
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { colors, radius, shadows, spacing, statusColors, typography } from '../theme/theme';

export type IoniconName = React.ComponentProps<typeof Ionicons>['name'];

export function Screen({ children, scroll = true }: { children: React.ReactNode; scroll?: boolean }) {
  const Wrapper = scroll ? ScrollView : View;
  return (
    <SafeAreaView style={styles.screen}>
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
  return <View style={[styles.card, style]}>{children}</View>;
}

export function PrimaryButton({
  title,
  onPress,
  loading,
  disabled,
  variant = 'primary',
  icon,
}: {
  title: string;
  onPress: () => void;
  loading?: boolean;
  disabled?: boolean;
  variant?: 'primary' | 'danger' | 'outline' | 'tertiary';
  icon?: IoniconName;
}) {
  const textColor = variant === 'outline' || variant === 'tertiary' ? colors.primary : colors.white;
  const content = loading ? (
    <ActivityIndicator color={textColor} />
  ) : (
    <View style={styles.buttonContent}>
      {icon ? <Ionicons name={icon} size={18} color={textColor} style={{ marginRight: spacing.xs }} /> : null}
      <Text style={[typography.button, { color: textColor }]}>{title}</Text>
    </View>
  );

  if (variant === 'primary') {
    return (
      <Pressable
        onPress={onPress}
        disabled={disabled || loading}
        style={({ pressed }) => [styles.buttonShadow, { opacity: pressed ? 0.9 : disabled ? 0.5 : 1 }]}
      >
        <LinearGradient
          colors={[colors.primary, colors.primaryDark]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={styles.button}
        >
          {content}
        </LinearGradient>
      </Pressable>
    );
  }

  if (variant === 'tertiary') {
    return (
      <Pressable
        onPress={onPress}
        disabled={disabled || loading}
        hitSlop={8}
        style={({ pressed }) => [styles.buttonTertiary, { opacity: pressed ? 0.6 : disabled ? 0.4 : 1 }]}
      >
        {content}
      </Pressable>
    );
  }

  const bg = variant === 'danger' ? colors.danger : 'transparent';
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled || loading}
      style={({ pressed }) => [
        styles.button,
        { backgroundColor: bg, marginTop: spacing.sm, opacity: pressed ? 0.85 : disabled ? 0.5 : 1 },
        variant === 'outline' && styles.buttonOutline,
      ]}
    >
      {content}
    </Pressable>
  );
}

export function IconContainer({
  icon,
  size = 56,
  tint = colors.primary,
  tone = 'soft',
}: {
  icon: IoniconName;
  size?: number;
  tint?: string;
  tone?: 'soft' | 'solid';
}) {
  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: tone === 'solid' ? tint : tint + '1F',
      }}
    >
      <Ionicons name={icon} size={size * 0.42} color={tone === 'solid' ? colors.white : tint} />
    </View>
  );
}

export function Input(
  props: TextInputProps & { label?: string; error?: string; icon?: IoniconName; rightElement?: React.ReactNode }
) {
  const { label, error, icon, rightElement, style, onFocus, onBlur, ...rest } = props;
  const [focused, setFocused] = useState(false);
  return (
    <View style={{ marginBottom: spacing.md }}>
      {label ? <Text style={styles.inputLabel}>{label}</Text> : null}
      <View style={styles.inputRow}>
        {icon ? (
          <Ionicons
            name={icon}
            size={18}
            color={focused ? colors.primary : colors.textMuted}
            style={styles.inputIconLeft}
          />
        ) : null}
        <TextInput
          placeholderTextColor={colors.textMuted}
          style={[
            styles.input,
            icon ? styles.inputPaddedLeft : null,
            rightElement ? styles.inputPaddedRight : null,
            focused ? styles.inputFocused : null,
            error ? { borderColor: colors.danger } : null,
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
      {error ? <Text style={styles.errorText}>{error}</Text> : null}
    </View>
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
        rightElement={
          <Pressable onPress={() => setVisible((v) => !v)} hitSlop={8} style={styles.passwordToggle}>
            <Ionicons name={visible ? 'eye-off-outline' : 'eye-outline'} size={18} color={colors.textMuted} />
          </Pressable>
        }
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
const STRENGTH_COLORS = [colors.danger, colors.danger, colors.warning, colors.info, colors.success];

function scorePassword(pw: string) {
  if (!pw) return 0;
  let score = PASSWORD_RULES.filter((r) => r.test(pw)).length;
  if (pw.length >= 12) score += 1;
  return Math.min(score, 4);
}

export function PasswordStrengthMeter({ password }: { password: string }) {
  const score = scorePassword(password);
  const tint = STRENGTH_COLORS[score];
  return (
    <View style={styles.strengthWrap}>
      <View style={styles.strengthBar}>
        {[0, 1, 2, 3].map((i) => (
          <View key={i} style={[styles.strengthSegment, { backgroundColor: i < score ? tint : colors.border }]} />
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
                color={met ? colors.success : colors.textMuted}
              />
              <Text style={[styles.requirementText, met ? styles.requirementTextMet : null]}>{rule.label}</Text>
            </View>
          );
        })}
      </View>
    </View>
  );
}

export function DropdownInput({
  label,
  placeholder = 'Select an option',
  value,
  options,
  onSelect,
  error,
  disabled,
}: {
  label?: string;
  placeholder?: string;
  value: string | null;
  options: { label: string; value: string }[];
  onSelect: (value: string) => void;
  error?: string;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const selected = options.find((o) => o.value === value);

  return (
    <View style={{ marginBottom: spacing.md }}>
      {label ? <Text style={styles.inputLabel}>{label}</Text> : null}
      <Pressable
        onPress={() => !disabled && setOpen(true)}
        style={[
          styles.input,
          styles.dropdownTrigger,
          error ? { borderColor: colors.danger } : null,
          disabled ? { opacity: 0.5 } : null,
        ]}
      >
        <Text style={selected ? styles.dropdownValue : styles.dropdownPlaceholder} numberOfLines={1}>
          {selected ? selected.label : placeholder}
        </Text>
        <Ionicons name="chevron-down" size={18} color={colors.textMuted} />
      </Pressable>
      {error ? <Text style={styles.errorText}>{error}</Text> : null}

      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <Pressable style={styles.modalBackdrop} onPress={() => setOpen(false)}>
          <View style={styles.modalSheet}>
            <Text style={styles.modalTitle}>{label ?? 'Select an option'}</Text>
            <FlatList
              data={options}
              keyExtractor={(o) => o.value}
              style={{ maxHeight: 320 }}
              renderItem={({ item }) => (
                <Pressable
                  onPress={() => {
                    onSelect(item.value);
                    setOpen(false);
                  }}
                  style={styles.modalOption}
                >
                  <Text style={[styles.modalOptionText, item.value === value && styles.modalOptionTextActive]}>
                    {item.label}
                  </Text>
                  {item.value === value ? <Ionicons name="checkmark" size={18} color={colors.primary} /> : null}
                </Pressable>
              )}
            />
          </View>
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
  variant?: 'error' | 'info';
  title: string;
  message?: string;
  onRetry?: () => void;
}) {
  const tint = variant === 'error' ? colors.danger : colors.info;
  return (
    <View style={[styles.alert, { borderColor: tint, backgroundColor: tint + '11' }]}>
      <Ionicons name={variant === 'error' ? 'alert-circle' : 'information-circle'} size={20} color={tint} />
      <View style={{ flex: 1, marginLeft: spacing.sm }}>
        <Text style={[styles.alertTitle, { color: tint }]}>{title}</Text>
        {message ? <Text style={styles.alertMessage}>{message}</Text> : null}
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
  return (
    <View style={styles.privacyCard}>
      <IconContainer icon="lock-closed" size={36} tint={colors.primary} />
      <View style={{ flex: 1, marginLeft: spacing.sm }}>
        {heading ? <Text style={styles.privacyCardHeading}>{heading}</Text> : null}
        <Text style={styles.privacyCardText}>
          {text ??
            'Your information is encrypted and only visible to authorized SafeHer staff in your municipality.'}
        </Text>
      </View>
    </View>
  );
}

export function FeatureCard({
  icon,
  title,
  description,
  tint = colors.primary,
}: {
  icon: IoniconName;
  title: string;
  description: string;
  tint?: string;
}) {
  return (
    <View style={styles.featureCard}>
      <IconContainer icon={icon} size={40} tint={tint} />
      <Text style={styles.featureTitle}>{title}</Text>
      <Text style={styles.featureDescription}>{description}</Text>
    </View>
  );
}

export function StatusBadge({ label }: { label: string }) {
  const bg = statusColors[label] ?? colors.textMuted;
  return (
    <View style={[styles.badge, { backgroundColor: bg + '22', borderColor: bg }]}>
      <Text style={[styles.badgeText, { color: bg }]}>{label}</Text>
    </View>
  );
}

export function EmptyState({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <View style={styles.empty}>
      <Text style={styles.emptyTitle}>{title}</Text>
      {subtitle ? <Text style={styles.emptySubtitle}>{subtitle}</Text> : null}
    </View>
  );
}

export function SectionHeader({ title }: { title: string }) {
  return <Text style={styles.sectionHeader}>{title}</Text>;
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
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonContent: { flexDirection: 'row', alignItems: 'center' },
  buttonShadow: {
    borderRadius: radius.pill,
    marginTop: spacing.sm,
    shadowColor: colors.primaryDark,
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.28,
    shadowRadius: 10,
    elevation: 6,
  },
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
  inputFocused: { borderColor: colors.primary, borderWidth: 1.5 },
  inputPaddedLeft: { paddingLeft: 44 },
  inputPaddedRight: { paddingRight: 44 },
  inputIconLeft: { position: 'absolute', left: spacing.md, zIndex: 1 },
  inputIconRight: { position: 'absolute', right: spacing.sm, zIndex: 1 },
  passwordToggle: { padding: 4 },
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

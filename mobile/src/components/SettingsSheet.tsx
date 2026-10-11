import React, { useEffect, useState } from 'react';
import { View, Text, Pressable, Modal, Switch, ScrollView, Alert, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Constants from 'expo-constants';
import { useNavigation } from '@react-navigation/native';
import { useSharedValue, useAnimatedStyle, withTiming } from 'react-native-reanimated';
import { spacing, typography, radius } from '../theme/theme';
import { ClaySurface } from '../theme/clay';
import { ClayPalette, AppearancePreference } from '../theme/clay';
import { AppLanguage } from '../lib/preferences';
import { isAppLockAvailable, authenticate } from '../lib/appLock';
import { useTheme } from '../contexts/ThemeContext';
import { PrimaryButton, IconContainer } from './ui';

function SettingsToggleRow({ label, desc, value, onChange, palette }: { label: string; desc: string; value: boolean; onChange: (v: boolean) => void; palette: ClayPalette }) {
  return (
    <View style={styles.row}>
      <View style={{ flex: 1, marginRight: spacing.md }}>
        <Text style={[styles.rowLabel, { color: palette.text }]}>{label}</Text>
        <Text style={[styles.rowDesc, { color: palette.textMuted }]}>{desc}</Text>
      </View>
      <Switch
        value={value}
        onValueChange={onChange}
        trackColor={{ false: palette.border, true: palette.primary }}
        thumbColor={palette.white}
        accessibilityLabel={label}
      />
    </View>
  );
}

function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  palette,
}: {
  options: { key: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
  palette: ClayPalette;
}) {
  return (
    <View style={[styles.segmented, { backgroundColor: palette.surfaceMuted }]}>
      {options.map((opt) => {
        const active = opt.key === value;
        return (
          <Pressable
            key={opt.key}
            onPress={() => onChange(opt.key)}
            style={[styles.segmentedOption, active ? { backgroundColor: palette.primary } : null]}
            accessibilityRole="button"
            accessibilityState={{ selected: active }}
            accessibilityLabel={opt.label}
          >
            <Text style={[styles.segmentedOptionText, { color: active ? palette.white : palette.textMuted }]}>{opt.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const APPEARANCE_OPTIONS: { key: AppearancePreference; icon: string; label: string; subtitle: string }[] = [
  { key: 'light', icon: '☀️', label: 'Light', subtitle: 'Clean and bright' },
  { key: 'dark', icon: '🌙', label: 'Dark', subtitle: 'Comfortable, low light' },
  { key: 'system', icon: '◐', label: 'System', subtitle: 'Follow device' },
];

function AppearanceCard({
  icon,
  label,
  subtitle,
  active,
  onPress,
  palette,
}: {
  icon: string;
  label: string;
  subtitle: string;
  active: boolean;
  onPress: () => void;
  palette: ClayPalette;
}) {
  const progress = useSharedValue(active ? 1 : 0);
  useEffect(() => {
    progress.value = withTiming(active ? 1 : 0, { duration: 220 });
  }, [active, progress]);
  const cardStyle = useAnimatedStyle(() => ({ transform: [{ scale: 1 + progress.value * 0.02 }] }));

  return (
    <Pressable
      onPress={onPress}
      style={styles.appearanceCardWrap}
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      accessibilityLabel={`${label}, ${subtitle}`}
    >
      <ClaySurface
        radius={16}
        tint={active ? palette.primaryLight : palette.surfaceMuted}
        shadowTint={active ? palette.primary : palette.primaryDark}
        intensity={active ? 'md' : 'sm'}
        style={styles.appearanceCardShadow}
        innerStyle={[styles.appearanceCardInner, active ? { borderWidth: 1.5, borderColor: palette.primary } : null]}
        highlightOpacity={active ? 0.4 : 0.15}
        animatedStyle={cardStyle}
      >
        <View style={styles.appearanceCardTop}>
          <Text style={styles.appearanceIcon}>{icon}</Text>
          {active ? <Ionicons name="checkmark-circle" size={16} color={palette.primary} /> : null}
        </View>
        <Text style={[styles.appearanceLabel, { color: palette.text }]}>{label}</Text>
        <Text style={[styles.appearanceSubtitle, { color: palette.textMuted }]} numberOfLines={1}>
          {subtitle}
        </Text>
      </ClaySurface>
    </Pressable>
  );
}

/**
 * Shared accessibility/appearance/language/privacy bottom sheet — the
 * ONE Settings surface used across Onboarding, Welcome, Login, Register,
 * Forgot Password, and Home. Reads palette/prefs straight from
 * ThemeContext (the same single source of truth every other themed
 * component uses) rather than taking them as props, so every call site
 * stays just `<SettingsSheet visible={...} onClose={...} />` and there's
 * no risk of a screen accidentally wiring up its own separate preferences
 * instance. Deliberately compact: only options that are genuinely
 * implemented (no toggle that does nothing, no link with nowhere to go).
 */
export function SettingsSheet({
  visible,
  onClose,
  title = 'Settings',
}: {
  visible: boolean;
  onClose: () => void;
  title?: string;
}) {
  const { palette, prefs, updatePreference: onUpdate } = useTheme();
  const navigation = useNavigation();
  const [lockAvailable, setLockAvailable] = useState<boolean | null>(null);
  const [lockBusy, setLockBusy] = useState(false);
  const appVersion = Constants.expoConfig?.version ?? '1.0.0';

  useEffect(() => {
    if (!visible) return;
    let mounted = true;
    isAppLockAvailable().then((available) => {
      if (mounted) setLockAvailable(available);
    });
    return () => {
      mounted = false;
    };
  }, [visible]);

  const toggleAppLock = async (next: boolean) => {
    if (next && lockAvailable === false) {
      Alert.alert(
        'App Lock unavailable',
        'This device has no fingerprint or face recognition set up. Set one up in your device settings, then try again.'
      );
      return;
    }
    setLockBusy(true);
    const { success, error } = await authenticate(next ? 'Confirm to turn on App Lock' : 'Confirm to turn off App Lock');
    setLockBusy(false);
    if (success) {
      onUpdate('appLockEnabled', next);
      return;
    }
    // Turning OFF: if biometrics are no longer enrolled on this device,
    // requiring a successful auth to disable would strand the user with
    // no way to turn off a lock they can no longer pass — let it through.
    if (!next && (error === 'not_enrolled' || error === 'not_available')) {
      onUpdate('appLockEnabled', false);
    }
  };

  const toggleEmergencyAlerts = (next: boolean) => {
    if (!next) {
      Alert.alert(
        'Turn off Emergency Alerts?',
        "You will stop seeing SOS and case-status notifications on this device. The SOS button and your case status tracking are not affected.",
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Turn off', style: 'destructive', onPress: () => onUpdate('emergencyAlertsEnabled', false) },
        ]
      );
      return;
    }
    onUpdate('emergencyAlertsEnabled', true);
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} accessibilityViewIsModal>
        <Pressable style={[styles.card, { backgroundColor: palette.surface }]} onPress={(e) => e.stopPropagation()}>
          <View style={[styles.handle, { backgroundColor: palette.border }]} />
          <ScrollView showsVerticalScrollIndicator={false}>
            <Text style={[styles.title, { color: palette.text }]}>{title}</Text>

            <Text style={[styles.sectionLabel, { color: palette.textMuted }]}>Appearance</Text>
            <View style={styles.appearanceRow}>
              {APPEARANCE_OPTIONS.map((opt) => (
                <AppearanceCard
                  key={opt.key}
                  icon={opt.icon}
                  label={opt.label}
                  subtitle={opt.subtitle}
                  active={prefs.appearance === opt.key}
                  onPress={() => onUpdate('appearance', opt.key)}
                  palette={palette}
                />
              ))}
            </View>

            <View style={[styles.divider, { backgroundColor: palette.border }]} />

            <Text style={[styles.sectionLabel, { color: palette.textMuted }]}>Accessibility</Text>
            <SettingsToggleRow
              label="Reduce Motion"
              desc="Turn off floating, parallax, and spring animations."
              value={prefs.reduceMotion}
              onChange={(v) => onUpdate('reduceMotion', v)}
              palette={palette}
            />
            <SettingsToggleRow
              label="Larger Text"
              desc="Increase title and description text size."
              value={prefs.largerText}
              onChange={(v) => onUpdate('largerText', v)}
              palette={palette}
            />
            <SettingsToggleRow
              label="High Contrast"
              desc="Stronger text and border contrast."
              value={prefs.highContrast}
              onChange={(v) => onUpdate('highContrast', v)}
              palette={palette}
            />

            <View style={[styles.divider, { backgroundColor: palette.border }]} />

            <Text style={[styles.sectionLabel, { color: palette.textMuted }]}>Language</Text>
            <SegmentedControl<AppLanguage>
              palette={palette}
              value={prefs.language}
              onChange={(v) => onUpdate('language', v)}
              options={[
                { key: 'en', label: 'English' },
                { key: 'fil', label: 'Filipino' },
              ]}
            />

            <View style={[styles.divider, { backgroundColor: palette.border }]} />

            <Text style={[styles.sectionLabel, { color: palette.textMuted }]}>Notifications</Text>
            <SettingsToggleRow
              label="Notification badge"
              desc="Show the unread-count badge and highlight on Home."
              value={prefs.inAppBadgeEnabled}
              onChange={(v) => onUpdate('inAppBadgeEnabled', v)}
              palette={palette}
            />
            <SettingsToggleRow
              label="Emergency Alerts"
              desc="Show SOS and case-status alerts on this device."
              value={prefs.emergencyAlertsEnabled}
              onChange={toggleEmergencyAlerts}
              palette={palette}
            />

            <View style={[styles.divider, { backgroundColor: palette.border }]} />

            <Text style={[styles.sectionLabel, { color: palette.textMuted }]}>Privacy & Security</Text>
            <SettingsToggleRow
              label="App Lock"
              desc={
                lockAvailable === false
                  ? 'Unavailable — no fingerprint or face recognition set up on this device.'
                  : 'Require Face ID / fingerprint to open SafeSpace.'
              }
              value={prefs.appLockEnabled}
              onChange={toggleAppLock}
              palette={palette}
            />
            {lockBusy ? <Text style={[styles.rowDesc, { color: palette.textMuted, marginTop: -spacing.xs, marginBottom: spacing.xs }]}>Confirming…</Text> : null}
            <View style={styles.privacyRow}>
              <IconContainer icon="lock-closed" size={34} tint={palette.primary} />
              <Text style={[styles.rowDesc, { flex: 1, marginLeft: spacing.sm, color: palette.textMuted }]}>
                Your information is handled securely and shared only with authorized personnel when applicable.
              </Text>
            </View>

            <View style={[styles.divider, { backgroundColor: palette.border }]} />

            <Text style={[styles.sectionLabel, { color: palette.textMuted }]}>About SafeSpace</Text>
            <View style={styles.aboutRow}>
              <Text style={[styles.rowLabel, { color: palette.text }]}>Version</Text>
              <Text style={[styles.rowDesc, { color: palette.textMuted }]}>{appVersion}</Text>
            </View>
            <Pressable
              onPress={() => {
                onClose();
                // @ts-expect-error — this sheet is mounted from both the
                // pre-auth (Auth) and authenticated (App) stacks, which
                // type navigation against two different param lists;
                // 'Terms' exists, with no params, in both.
                navigation.navigate('Terms');
              }}
              style={styles.aboutRow}
              accessibilityRole="button"
              accessibilityLabel="Terms and Conditions"
            >
              <Text style={[styles.rowLabel, { color: palette.text }]}>Terms and Conditions</Text>
              <Ionicons name="chevron-forward" size={16} color={palette.textMuted} />
            </Pressable>

            <View style={{ marginTop: spacing.lg }}>
              <PrimaryButton title="Done" variant="outline" onPress={onClose} />
            </View>
          </ScrollView>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(32,32,32,0.42)', justifyContent: 'flex-end' },
  card: {
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    padding: spacing.lg,
    paddingBottom: spacing.xl,
    maxHeight: '85%',
  },
  handle: { width: 36, height: 4, borderRadius: 2, alignSelf: 'center', marginBottom: spacing.md },
  title: { ...typography.heading, fontSize: 18, marginBottom: spacing.sm },
  sectionLabel: { ...typography.caption, fontFamily: 'Inter_600SemiBold' as any, textTransform: 'uppercase', letterSpacing: 0.4, marginTop: spacing.sm, marginBottom: spacing.xs },
  row: { flexDirection: 'row', alignItems: 'center', paddingVertical: spacing.sm },
  rowLabel: { ...typography.bodyMedium },
  rowDesc: { ...typography.caption, marginTop: 2 },
  divider: { height: 1, marginVertical: spacing.sm },
  privacyRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: spacing.xs },
  aboutRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: spacing.sm },
  segmented: { flexDirection: 'row', borderRadius: radius.button, padding: 4, gap: 4 },
  segmentedOption: { flex: 1, paddingVertical: 10, borderRadius: radius.button - 4, alignItems: 'center', justifyContent: 'center' },
  segmentedOptionText: { ...typography.bodyMedium, fontSize: 13 },

  appearanceRow: { flexDirection: 'row', gap: spacing.sm },
  appearanceCardWrap: { flex: 1 },
  appearanceCardShadow: { borderRadius: 16 },
  appearanceCardInner: { padding: spacing.sm, borderRadius: 16 },
  appearanceCardTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  appearanceIcon: { fontSize: 20 },
  appearanceLabel: { ...typography.bodyMedium, fontSize: 14, marginTop: spacing.xs },
  appearanceSubtitle: { ...typography.caption, fontSize: 11, marginTop: 1 },
});

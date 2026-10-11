import React, { useEffect, useRef, useState } from 'react';
import { View, Text, StyleSheet, Pressable, Modal, AppState, AppStateStatus } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { ClaySurface } from '../theme/clay';
import { useTheme } from '../contexts/ThemeContext';
import { authenticate } from '../lib/appLock';
import { spacing, typography, radius } from '../theme/theme';

/**
 * Overlays a lock screen on top of the app (via Modal, not a conditional
 * unmount) when Settings > Privacy & Security > App Lock is on. `children`
 * — the whole NavigationContainer — stay mounted underneath at all times,
 * so backgrounding mid-flow (e.g. partway through Report Incident) never
 * loses navigation/form state just because the app got locked and
 * unlocked. Locks on cold start and whenever the app returns to the
 * foreground from background/inactive.
 */
export function AppLockGate({ children }: { children: React.ReactNode }) {
  const { palette, prefs, prefsLoaded, updatePreference } = useTheme();
  // Pessimistic default: locked until we've actually read the stored
  // preference, so a stored `appLockEnabled: true` can never lose the
  // race and reveal an unlocked overlay first.
  const [locked, setLocked] = useState(true);
  const [authenticating, setAuthenticating] = useState(false);
  const [failed, setFailed] = useState(false);
  const appState = useRef(AppState.currentState);
  const initialized = useRef(false);

  useEffect(() => {
    if (!prefsLoaded || initialized.current) return;
    initialized.current = true;
    setLocked(prefs.appLockEnabled);
  }, [prefsLoaded, prefs.appLockEnabled]);

  useEffect(() => {
    if (!prefs.appLockEnabled) {
      setLocked(false);
      return;
    }
    const subscription = AppState.addEventListener('change', (next: AppStateStatus) => {
      if (appState.current.match(/active/) && next.match(/inactive|background/)) {
        setLocked(true);
        setFailed(false);
      }
      appState.current = next;
    });
    return () => subscription.remove();
  }, [prefs.appLockEnabled]);

  const tryUnlock = async () => {
    setAuthenticating(true);
    setFailed(false);
    const { success, error } = await authenticate('Unlock SafeSpace');
    setAuthenticating(false);
    if (success) {
      setLocked(false);
      return;
    }
    if (error === 'not_enrolled' || error === 'not_available') {
      // Biometrics were removed from this device after App Lock was
      // turned on (e.g. Face ID/fingerprint reset) — insisting on an
      // auth method that no longer exists would permanently strand the
      // user out of their own safety app, so this turns App Lock back
      // off and lets them in rather than trapping them.
      updatePreference('appLockEnabled', false);
      setLocked(false);
      return;
    }
    setFailed(true);
  };

  const showOverlay = !prefsLoaded || (prefs.appLockEnabled && locked);

  useEffect(() => {
    // Gated on prefsLoaded too — otherwise this would fire a real
    // biometric prompt on every cold start before we even know App Lock
    // is enabled, for the majority of users who never turned it on.
    if (prefsLoaded && prefs.appLockEnabled && locked && !authenticating) {
      tryUnlock();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [locked, prefsLoaded]);

  return (
    <>
      {children}
      <Modal visible={showOverlay} animationType="fade" statusBarTranslucent onRequestClose={() => {}}>
        <View style={[styles.screen, { backgroundColor: palette.background }]}>
          {prefsLoaded ? (
            <ClaySurface radius={28} tint={palette.surface} shadowTint={palette.primaryDark} intensity="lg" style={styles.cardShadow} innerStyle={styles.cardInner} highlightOpacity={0.2}>
              <View style={[styles.lockIconWrap, { backgroundColor: palette.primaryLight }]}>
                <Ionicons name="lock-closed" size={26} color={palette.primaryDark} />
              </View>
              <Text style={[styles.title, { color: palette.text }]}>SafeSpace is locked</Text>
              <Text style={[styles.body, { color: palette.textMuted }]}>
                {failed ? "That didn't work. Try again to continue." : 'Authenticate to keep your information private.'}
              </Text>
              <Pressable
                onPress={tryUnlock}
                disabled={authenticating}
                style={[styles.unlockBtn, { backgroundColor: palette.primary }]}
                accessibilityRole="button"
                accessibilityLabel="Unlock"
              >
                <Ionicons name="finger-print-outline" size={18} color={palette.white} />
                <Text style={styles.unlockBtnText}>{authenticating ? 'Checking…' : 'Unlock'}</Text>
              </Pressable>
            </ClaySurface>
          ) : null}
        </View>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xl },
  cardShadow: { width: '100%', maxWidth: 340 },
  cardInner: { padding: spacing.xl, alignItems: 'center' },
  lockIconWrap: { width: 52, height: 52, borderRadius: 26, alignItems: 'center', justifyContent: 'center' },
  title: { ...typography.heading, fontSize: 19, marginTop: spacing.md },
  body: { ...typography.body, textAlign: 'center', marginTop: spacing.xs, marginBottom: spacing.lg },
  unlockBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    width: '100%',
    paddingVertical: 14,
    borderRadius: radius.button,
  },
  unlockBtnText: { ...typography.button, color: '#FFFFFF' },
});

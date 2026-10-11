import React, { useEffect, useRef, useState } from 'react';
import { View, Text, StyleSheet, Pressable, Modal, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import RAnimated, { useSharedValue, useAnimatedStyle, withRepeat, withSequence, withTiming, Easing } from 'react-native-reanimated';
import { ClaySurface } from '../../theme/clay';
import { useTheme } from '../../contexts/ThemeContext';
import { useSosTrigger } from '../../lib/useSosTrigger';
import { locationQuality } from '../../lib/sosLocation';
import { spacing, typography, radius } from '../../theme/theme';
import type { SosAlert } from '../../types/database.types';

const COUNTDOWN_SECONDS = 5;

type SheetState = 'confirm' | 'countdown' | 'activating';

const LOCATION_ISSUE_MESSAGE: Record<'services-disabled' | 'permission-denied' | 'unavailable', string> = {
  'services-disabled': 'Your device\'s location services are turned off, so we couldn\'t determine your current location.',
  'permission-denied': 'SafeSpace doesn\'t have permission to access your location, so we couldn\'t determine where you are.',
  unavailable: 'We couldn\'t determine your current location.',
};

/**
 * Emergency SOS confirmation — never fires on a single tap. Confirm →
 * cancellable countdown → the SAME real trigger (useSosTrigger) SosScreen
 * itself uses, so this sheet is a UI wrapper around existing backend
 * logic, not a parallel implementation. On success, hands the created
 * alert back to the caller (HomeScreen navigates to the SOS tab, which
 * already shows the live "help is on the way" state for it).
 */
export function SosConfirmSheet({
  visible,
  onClose,
  profileId,
  onActivated,
}: {
  visible: boolean;
  onClose: () => void;
  profileId: string | undefined;
  onActivated: (sos: SosAlert) => void;
}) {
  const { palette, prefs } = useTheme();
  const reduced = prefs.reduceMotion;
  const sosTrigger = useSosTrigger(profileId);
  const [state, setState] = useState<SheetState>('confirm');
  const [secondsLeft, setSecondsLeft] = useState(COUNTDOWN_SECONDS);
  const countdownRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const pulse = useSharedValue(0);
  useEffect(() => {
    if (!visible || reduced) return;
    pulse.value = withRepeat(withSequence(withTiming(1, { duration: 1400, easing: Easing.inOut(Easing.sin) }), withTiming(0, { duration: 1400, easing: Easing.inOut(Easing.sin) })), -1, false);
  }, [visible, reduced, pulse]);
  const pulseGlowStyle = useAnimatedStyle(() => ({
    opacity: 0.25 + pulse.value * 0.25,
    transform: [{ scale: 1 + pulse.value * 0.12 }],
  }));
  const pulseIconStyle = useAnimatedStyle(() => ({ transform: [{ scale: 1 + pulse.value * 0.06 }] }));

  useEffect(() => {
    if (visible) {
      setState('confirm');
      setSecondsLeft(COUNTDOWN_SECONDS);
      sosTrigger.reset();
    } else if (countdownRef.current) {
      clearTimeout(countdownRef.current);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  useEffect(() => {
    if (state !== 'countdown') return;
    if (secondsLeft <= 0) {
      setState('activating');
      sosTrigger.start();
      return;
    }
    countdownRef.current = setTimeout(() => setSecondsLeft((s) => s - 1), 1000);
    return () => {
      if (countdownRef.current) clearTimeout(countdownRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state, secondsLeft]);

  // Hand off to the caller the moment the alert is actually saved —
  // separate effect so it fires exactly once per successful save.
  useEffect(() => {
    if (sosTrigger.phase === 'done' && sosTrigger.sos) {
      onActivated(sosTrigger.sos);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sosTrigger.phase, sosTrigger.sos]);

  const startCountdown = () => {
    setSecondsLeft(COUNTDOWN_SECONDS);
    setState('countdown');
  };

  const cancelCountdown = () => {
    if (countdownRef.current) clearTimeout(countdownRef.current);
    setState('confirm');
  };

  const cancelActivation = () => {
    sosTrigger.reset();
    setState('confirm');
  };

  const quality = sosTrigger.locationResult ? locationQuality(sosTrigger.locationResult.accuracy) : null;

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={state === 'countdown' ? cancelCountdown : onClose}>
      <Pressable
        style={styles.backdrop}
        onPress={state === 'confirm' || sosTrigger.phase === 'error' ? onClose : undefined}
        accessibilityViewIsModal
      >
        <Pressable onPress={(e) => e.stopPropagation()}>
          <ClaySurface radius={24} tint={palette.surface} shadowTint={palette.dangerDark} intensity="lg" style={styles.cardShadow} innerStyle={styles.cardInner} highlightOpacity={0.2}>
            <View style={styles.iconWrap}>
              {!reduced ? <RAnimated.View style={[styles.iconGlow, { backgroundColor: palette.danger }, pulseGlowStyle]} /> : null}
              <RAnimated.View style={[styles.iconCircle, { backgroundColor: palette.danger }, reduced ? null : pulseIconStyle]}>
                <Ionicons name="alert" size={30} color={palette.white} />
              </RAnimated.View>
            </View>

            {state === 'confirm' ? (
              <>
                <Text style={[styles.title, { color: palette.text }]}>Activate Emergency SOS?</Text>
                <Text style={[styles.body, { color: palette.textMuted }]}>
                  Your location will be shared with authorized SafeSpace responders to help identify where assistance may be
                  needed, and an emergency record will be created immediately. Only do this if you need urgent help.
                </Text>
                <Pressable
                  onPress={startCountdown}
                  style={[styles.primaryBtn, { backgroundColor: palette.danger }]}
                  accessibilityRole="button"
                  accessibilityLabel="Activate SOS"
                >
                  <Text style={styles.primaryBtnText}>Activate SOS</Text>
                </Pressable>
                <Pressable onPress={onClose} style={styles.secondaryBtn} accessibilityRole="button" accessibilityLabel="Cancel">
                  <Text style={[styles.secondaryBtnText, { color: palette.textMuted }]}>Cancel</Text>
                </Pressable>
              </>
            ) : null}

            {state === 'countdown' ? (
              <>
                <Text style={[styles.title, { color: palette.text }]}>SOS activating in {secondsLeft}…</Text>
                <Text style={[styles.body, { color: palette.textMuted }]}>Tap Cancel if you don't need help right now.</Text>
                <Pressable
                  onPress={cancelCountdown}
                  style={[styles.primaryBtn, { backgroundColor: palette.surfaceMuted }]}
                  accessibilityRole="button"
                  accessibilityLabel="Cancel SOS activation"
                >
                  <Text style={[styles.primaryBtnText, { color: palette.text }]}>Cancel</Text>
                </Pressable>
              </>
            ) : null}

            {state === 'activating' && (sosTrigger.phase === 'locating' || sosTrigger.phase === 'saving') ? (
              <>
                <Text style={[styles.title, { color: palette.text }]}>
                  {sosTrigger.phase === 'locating' ? 'Getting your location…' : 'Sending your alert…'}
                </Text>
                <ActivityIndicator color={palette.danger} style={{ marginTop: spacing.md }} />
              </>
            ) : null}

            {state === 'activating' && sosTrigger.phase === 'located' ? (
              <>
                <Text style={[styles.title, { color: palette.text }]}>Location detected</Text>
                <Text style={[styles.body, { color: palette.textMuted }]}>
                  {quality && quality !== 'Unavailable' ? `Accuracy: ${quality.toLowerCase()}` : 'Sending your alert…'}
                </Text>
                <ActivityIndicator color={palette.danger} style={{ marginTop: spacing.sm }} />
              </>
            ) : null}

            {state === 'activating' && sosTrigger.phase === 'location-unavailable' ? (
              <>
                <Text style={[styles.title, { color: palette.text }]}>Location unavailable</Text>
                <Text style={[styles.body, { color: palette.textMuted }]}>
                  {LOCATION_ISSUE_MESSAGE[sosTrigger.locationIssue ?? 'unavailable']} Your emergency alert can still be sent.
                </Text>
                <Pressable
                  onPress={sosTrigger.retryLocation}
                  style={[styles.primaryBtn, { backgroundColor: palette.surfaceMuted }]}
                  accessibilityRole="button"
                  accessibilityLabel="Retry location"
                >
                  <Text style={[styles.primaryBtnText, { color: palette.text }]}>Retry Location</Text>
                </Pressable>
                <Pressable
                  onPress={sosTrigger.sendWithoutLocation}
                  style={[styles.primaryBtn, { backgroundColor: palette.danger }]}
                  accessibilityRole="button"
                  accessibilityLabel="Send SOS without location"
                >
                  <Text style={styles.primaryBtnText}>Send SOS Without Location</Text>
                </Pressable>
                <Pressable onPress={cancelActivation} style={styles.secondaryBtn} accessibilityRole="button" accessibilityLabel="Cancel">
                  <Text style={[styles.secondaryBtnText, { color: palette.textMuted }]}>Cancel</Text>
                </Pressable>
              </>
            ) : null}

            {state === 'activating' && sosTrigger.phase === 'error' ? (
              <>
                <Text style={[styles.title, { color: palette.text }]}>Couldn't send SOS</Text>
                <Text style={[styles.body, { color: palette.textMuted }]}>{sosTrigger.errorMessage ?? 'Please try again or call 911 directly.'}</Text>
                <Pressable
                  onPress={sosTrigger.start}
                  style={[styles.primaryBtn, { backgroundColor: palette.danger }]}
                  accessibilityRole="button"
                  accessibilityLabel="Try again"
                >
                  <Text style={styles.primaryBtnText}>Try again</Text>
                </Pressable>
                <Pressable onPress={onClose} style={styles.secondaryBtn} accessibilityRole="button" accessibilityLabel="Cancel">
                  <Text style={[styles.secondaryBtnText, { color: palette.textMuted }]}>Cancel</Text>
                </Pressable>
              </>
            ) : null}
          </ClaySurface>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(32,26,45,0.5)', alignItems: 'center', justifyContent: 'center', padding: spacing.xl },
  cardShadow: { width: '100%', maxWidth: 360 },
  cardInner: { padding: spacing.lg, alignItems: 'center' },
  iconWrap: { width: 72, height: 72, alignItems: 'center', justifyContent: 'center', marginBottom: spacing.md },
  iconGlow: { position: 'absolute', width: 72, height: 72, borderRadius: 36 },
  iconCircle: { width: 56, height: 56, borderRadius: 28, alignItems: 'center', justifyContent: 'center' },
  title: { ...typography.heading, fontSize: 19, textAlign: 'center', marginBottom: spacing.xs },
  body: { ...typography.body, textAlign: 'center', marginBottom: spacing.lg },
  primaryBtn: { width: '100%', paddingVertical: 15, borderRadius: radius.button, alignItems: 'center', justifyContent: 'center', marginBottom: spacing.sm },
  primaryBtnText: { ...typography.button, color: '#FFFFFF' },
  secondaryBtn: { marginTop: spacing.xs, paddingVertical: 10, paddingHorizontal: spacing.md },
  secondaryBtnText: { ...typography.bodyMedium },
});

import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, Pressable, Modal, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { ClaySurface } from '../../theme/clay';
import { useTheme } from '../../contexts/ThemeContext';
import { spacing, typography, radius } from '../../theme/theme';

type SheetState = 'confirm' | 'submitting' | 'success' | 'error';

/**
 * Confirmation step for "Talk to an Expert" — a custom sheet rather than
 * a native Alert because the backend call needs a real loading state
 * (disable the confirm button, keep the sheet open on failure with a
 * retry) that Alert.alert cannot represent. Same multi-state-card shape
 * as SosConfirmSheet (confirm -> processing -> outcome), recolored to
 * the ordinary SafeSpace blue since requesting a support expert is not
 * an emergency action the way SOS is.
 *
 * Submission itself still goes through the existing useSupportChat
 * requestExpertSupport() — this component owns presentation only, never
 * a second write path into expert_support_requests.
 */
export function ExpertSupportConfirmSheet({
  visible,
  onClose,
  onConfirm,
}: {
  visible: boolean;
  onClose: () => void;
  /** Resolves once the backend call completes — { error: null } on success. */
  onConfirm: () => Promise<{ error: string | null }>;
}) {
  const { palette } = useTheme();
  const [state, setState] = useState<SheetState>('confirm');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    if (visible) {
      setState('confirm');
      setErrorMessage(null);
    }
  }, [visible]);

  const submit = async () => {
    setState('submitting');
    const { error } = await onConfirm();
    if (error) {
      setErrorMessage(error);
      setState('error');
    } else {
      setState('success');
    }
  };

  const canDismissViaBackdrop = state === 'confirm' || state === 'error';

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={canDismissViaBackdrop ? onClose : undefined}>
      <Pressable style={styles.backdrop} onPress={canDismissViaBackdrop ? onClose : undefined} accessibilityViewIsModal>
        <Pressable onPress={(e) => e.stopPropagation()}>
          <ClaySurface radius={24} tint={palette.surface} shadowTint={palette.primaryDark} intensity="lg" style={styles.cardShadow} innerStyle={styles.cardInner} highlightOpacity={0.2}>
            <View style={[styles.iconCircle, { backgroundColor: state === 'success' ? palette.success : palette.primary }]}>
              <Ionicons name={state === 'success' ? 'checkmark' : 'person-circle-outline'} size={28} color={palette.white} />
            </View>

            {state === 'confirm' && (
              <>
                <Text style={[styles.title, { color: palette.text }]}>Request Human Support?</Text>
                <Text style={[styles.body, { color: palette.textMuted }]}>
                  Would you like to connect with a human support expert? Your support conversation will be submitted for
                  review by an authorized support expert. You can continue with your current chat if you're not ready.
                </Text>
                <Pressable
                  onPress={submit}
                  style={[styles.primaryBtn, { backgroundColor: palette.primary }]}
                  accessibilityRole="button"
                  accessibilityLabel="Request Expert Support"
                >
                  <Text style={styles.primaryBtnText}>Request Expert Support</Text>
                </Pressable>
                <Pressable onPress={onClose} style={styles.secondaryBtn} accessibilityRole="button" accessibilityLabel="Cancel">
                  <Text style={[styles.secondaryBtnText, { color: palette.textMuted }]}>Cancel</Text>
                </Pressable>
              </>
            )}

            {state === 'submitting' && (
              <>
                <Text style={[styles.title, { color: palette.text }]}>Submitting your request…</Text>
                <ActivityIndicator color={palette.primary} style={{ marginTop: spacing.sm }} />
                <View
                  style={[styles.primaryBtn, styles.disabledBtn, { backgroundColor: palette.surfaceMuted, marginTop: spacing.lg }]}
                  accessibilityElementsHidden
                >
                  <Text style={[styles.primaryBtnText, { color: palette.textMuted }]}>Please wait…</Text>
                </View>
              </>
            )}

            {state === 'success' && (
              <>
                <Text style={[styles.title, { color: palette.text }]}>Request Submitted</Text>
                <Text style={[styles.body, { color: palette.textMuted }]}>
                  Your request for human support has been submitted. A support expert will review your request.
                </Text>
                <Pressable
                  onPress={onClose}
                  style={[styles.primaryBtn, { backgroundColor: palette.primary }]}
                  accessibilityRole="button"
                  accessibilityLabel="Done"
                >
                  <Text style={styles.primaryBtnText}>Done</Text>
                </Pressable>
              </>
            )}

            {state === 'error' && (
              <>
                <Text style={[styles.title, { color: palette.text }]}>Couldn't Submit Your Request</Text>
                <Text style={[styles.body, { color: palette.textMuted }]}>{errorMessage ?? 'Please try again.'}</Text>
                <Pressable
                  onPress={submit}
                  style={[styles.primaryBtn, { backgroundColor: palette.primary }]}
                  accessibilityRole="button"
                  accessibilityLabel="Try again"
                >
                  <Text style={styles.primaryBtnText}>Try Again</Text>
                </Pressable>
                <Pressable onPress={onClose} style={styles.secondaryBtn} accessibilityRole="button" accessibilityLabel="Cancel">
                  <Text style={[styles.secondaryBtnText, { color: palette.textMuted }]}>Cancel</Text>
                </Pressable>
              </>
            )}
          </ClaySurface>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(23,32,51,0.5)', alignItems: 'center', justifyContent: 'center', padding: spacing.xl },
  cardShadow: { width: '100%', maxWidth: 360 },
  cardInner: { padding: spacing.lg, alignItems: 'center' },
  iconCircle: { width: 56, height: 56, borderRadius: 28, alignItems: 'center', justifyContent: 'center', marginBottom: spacing.md },
  title: { ...typography.heading, fontSize: 19, textAlign: 'center', marginBottom: spacing.xs },
  body: { ...typography.body, textAlign: 'center', marginBottom: spacing.lg },
  primaryBtn: { width: '100%', paddingVertical: 15, borderRadius: radius.button, alignItems: 'center', justifyContent: 'center', marginBottom: spacing.sm },
  disabledBtn: { opacity: 0.7 },
  primaryBtnText: { ...typography.button, color: '#FFFFFF' },
  secondaryBtn: { marginTop: spacing.xs, paddingVertical: 10, paddingHorizontal: spacing.md },
  secondaryBtnText: { ...typography.bodyMedium },
});

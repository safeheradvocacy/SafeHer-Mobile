import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { typography } from '../theme/theme';

const TOOLTIP_RADIUS = 24;

export interface OnboardingTooltipProps {
  title: string;
  body: string;
  stepIndex: number;
  stepCount: number;
  isLast: boolean;
  onSkip: () => void;
  onNext: () => void;
  /** Which edge of the card the connector arrow points from — 'top'
   * when the target is above the card (arrow points up), 'bottom' when
   * the target is below (arrow points down), or null when the card
   * isn't adjacent to a specific target (the Welcome step, or the
   * no-room-nearby fallback position). */
  arrowSide: 'top' | 'bottom' | null;
  /** Arrow's horizontal center, relative to the card's own left edge —
   * already clamped by the caller to stay within the card's bounds. */
  arrowOffset: number;
  surfaceColor: string;
  primaryColor: string;
  textColor: string;
  mutedColor: string;
  borderColor: string;
}

/**
 * The instruction card — title, short body, step dots, Skip/Next — plus
 * its own directional connector arrow. Pulled out of TourOverlay as its
 * own component so the positioning logic (where the card goes) and the
 * presentation (what the card looks like) aren't tangled in one file.
 */
export function OnboardingTooltip({
  title,
  body,
  stepIndex,
  stepCount,
  isLast,
  onSkip,
  onNext,
  arrowSide,
  arrowOffset,
  surfaceColor,
  primaryColor,
  textColor,
  mutedColor,
  borderColor,
}: OnboardingTooltipProps) {
  return (
    <View>
      {arrowSide === 'top' && (
        <View style={[styles.arrowUp, { left: arrowOffset - 8, borderBottomColor: surfaceColor }]} />
      )}
      <View style={[styles.card, { backgroundColor: surfaceColor, shadowColor: primaryColor }]}>
        <Text style={[styles.title, { color: textColor }]} numberOfLines={1}>
          {title}
        </Text>
        <Text style={[styles.body, { color: mutedColor }]}>{body}</Text>

        <View style={styles.footer}>
          <View style={styles.dots}>
            {Array.from({ length: stepCount }).map((_, i) => (
              <View
                key={i}
                style={[styles.dot, i === stepIndex ? styles.dotActive : null, { backgroundColor: i === stepIndex ? primaryColor : borderColor }]}
              />
            ))}
          </View>
          <View style={styles.actions}>
            <Pressable onPress={onSkip} accessibilityRole="button" accessibilityLabel="Skip tour" style={styles.skipBtn} hitSlop={8}>
              <Text style={[styles.skipText, { color: mutedColor }]}>Skip</Text>
            </Pressable>
            <Pressable
              onPress={onNext}
              accessibilityRole="button"
              accessibilityLabel={isLast ? 'Done' : 'Next'}
              style={[styles.nextBtn, { backgroundColor: primaryColor }]}
            >
              <Text style={styles.nextText}>{isLast ? 'Done' : 'Next'}</Text>
            </Pressable>
          </View>
        </View>
      </View>
      {arrowSide === 'bottom' && (
        <View style={[styles.arrowDown, { left: arrowOffset - 8, borderTopColor: surfaceColor }]} />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: TOOLTIP_RADIUS,
    paddingHorizontal: 20,
    paddingVertical: 18,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.1,
    shadowRadius: 10,
    elevation: 3,
  },
  arrowUp: {
    position: 'absolute',
    top: -8,
    width: 0,
    height: 0,
    borderLeftWidth: 8,
    borderRightWidth: 8,
    borderBottomWidth: 9,
    borderLeftColor: 'transparent',
    borderRightColor: 'transparent',
  },
  arrowDown: {
    position: 'absolute',
    bottom: -8,
    width: 0,
    height: 0,
    borderLeftWidth: 8,
    borderRightWidth: 8,
    borderTopWidth: 9,
    borderLeftColor: 'transparent',
    borderRightColor: 'transparent',
  },
  title: { ...typography.subheading, fontSize: 17 },
  body: { ...typography.body, fontSize: 14, lineHeight: 20, marginTop: 8 },
  footer: { marginTop: 16 },
  dots: { flexDirection: 'row', gap: 6, marginBottom: 14, alignItems: 'center' },
  dot: { width: 6, height: 6, borderRadius: 3 },
  dotActive: { width: 16 },
  actions: { flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', gap: 20 },
  skipBtn: { paddingVertical: 10, paddingHorizontal: 4, minHeight: 44, justifyContent: 'center' },
  skipText: { ...typography.bodyMedium, fontSize: 14 },
  nextBtn: { paddingVertical: 10, paddingHorizontal: 22, minWidth: 88, borderRadius: 14, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  nextText: { ...typography.button, color: '#FFFFFF', fontSize: 14.5 },
});

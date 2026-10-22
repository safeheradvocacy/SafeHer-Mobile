import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { StatusBadge } from '../ui';
import { useTheme } from '../../contexts/ThemeContext';
import { spacing, typography, radius } from '../../theme/theme';
import type { SosAlert } from '../../types/database.types';

function elapsedLabel(iso: string): string {
  const mins = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 60000));
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

// Real, existing statuses only (SosStatus = 'Triggered'|'Responding'|
// 'Resolved') — no 'Cancelled'/'Assigned' etc. invented. "Awaiting
// responder assignment" is shown whenever acknowledged_by is still null,
// regardless of status, so the survivor is never told help is already on
// the way when nobody has actually acknowledged the alert yet.
function statusCopy(sos: SosAlert): { title: string; body: string } {
  if (sos.status === 'Resolved') {
    return { title: 'This alert has been resolved', body: 'Your emergency alert has been marked resolved.' };
  }
  if (sos.acknowledged_by) {
    return {
      title: sos.status === 'Responding' ? 'A responder is handling your alert' : 'Your alert has been acknowledged',
      body: 'Your alert is being processed. View the latest available response information below.',
    };
  }
  return {
    title: 'Awaiting responder assignment',
    body: 'Your location has been sent. No responder has acknowledged this alert yet.',
  };
}

export function SosAlertStatusCard({ sos }: { sos: SosAlert }) {
  const { palette } = useTheme();
  const copy = statusCopy(sos);

  return (
    <View style={[styles.card, { backgroundColor: palette.surface, borderColor: palette.border }]}>
      <View style={styles.headRow}>
        <Text style={[styles.eyebrow, { color: palette.textMuted }]}>SOS ALERT</Text>
        <StatusBadge label={sos.status} />
      </View>
      <Text style={[styles.title, { color: palette.text }]}>{copy.title}</Text>
      <Text style={[styles.body, { color: palette.textMuted }]}>{copy.body}</Text>

      <View style={[styles.divider, { backgroundColor: palette.border }]} />

      <View style={styles.factRow}>
        <Text style={[styles.factLabel, { color: palette.textMuted }]}>Created</Text>
        <Text style={[styles.factValue, { color: palette.text }]}>
          {new Date(sos.triggered_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} · {elapsedLabel(sos.triggered_at)}
        </Text>
      </View>
      {/* No formal responder/office assignment table exists for SOS alerts
          (module19 — direct, unconditional province-wide officer access,
          not a per-alert assignment record), so this never names a
          specific responder or office — only whether *someone* has
          acknowledged it, which is the real, existing signal. */}
      <View style={styles.factRow}>
        <Text style={[styles.factLabel, { color: palette.textMuted }]}>Responder</Text>
        <Text style={[styles.factValue, { color: palette.text }]}>
          {sos.acknowledged_by ? `Acknowledged ${elapsedLabel(sos.acknowledged_at ?? sos.triggered_at)}` : 'Awaiting responder assignment'}
        </Text>
      </View>
      {sos.resolved_at ? (
        <View style={styles.factRow}>
          <Text style={[styles.factLabel, { color: palette.textMuted }]}>Resolved</Text>
          <Text style={[styles.factValue, { color: palette.text }]}>
            {new Date(sos.resolved_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
          </Text>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderWidth: 1, borderRadius: radius.lg, padding: spacing.md },
  headRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: spacing.xs },
  eyebrow: { ...typography.caption, fontFamily: 'Inter_600SemiBold' as any, letterSpacing: 0.5 },
  title: { ...typography.heading, fontSize: 18, marginTop: spacing.xs },
  body: { ...typography.body, marginTop: 4 },
  divider: { height: 1, marginVertical: spacing.sm },
  factRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 4 },
  factLabel: { ...typography.caption },
  factValue: { ...typography.caption, fontFamily: 'Inter_600SemiBold' as any },
});

import React, { useMemo } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../../contexts/ThemeContext';
import { SectionHeader, IoniconName } from '../ui';
import { spacing, typography } from '../../theme/theme';
import type { SosAlert } from '../../types/database.types';

interface TimelineEvent {
  key: string;
  at: string;
  icon: IoniconName;
  label: string;
}

/**
 * Every entry here is read directly off the real sos_alerts row — nothing
 * fabricated. There is no separate SOS status-history/event table in this
 * schema (confirmed: sos_alerts only gained acknowledged_by/acknowledged_at
 * in module19, on top of the pre-existing status/resolved_at; audit_logs
 * exists but is SELECT-restricted to provincial technical admins, so a
 * survivor's own client can't read it even if it wanted to). That makes
 * this the complete, honest set of events a survivor's own record can
 * support today: creation, the location fix taken for it, acknowledgment,
 * and resolution — never a fabricated "responder assigned"/"en route"
 * step this schema has no real data for.
 */
function buildTimeline(sos: SosAlert): TimelineEvent[] {
  const events: TimelineEvent[] = [{ key: 'created', at: sos.triggered_at, icon: 'alert-circle', label: 'SOS alert created' }];

  if (sos.location_timestamp && sos.location_timestamp !== sos.triggered_at) {
    events.push({ key: 'location', at: sos.location_timestamp, icon: 'location', label: 'Location recorded' });
  }
  if (sos.acknowledged_at) {
    events.push({ key: 'acknowledged', at: sos.acknowledged_at, icon: 'checkmark-circle', label: 'Alert acknowledged by a responder' });
  }
  if (sos.status === 'Resolved' && sos.resolved_at) {
    events.push({ key: 'resolved', at: sos.resolved_at, icon: 'shield-checkmark', label: 'Alert resolved' });
  }

  return events.sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime());
}

export function SosAlertTimeline({ sos }: { sos: SosAlert }) {
  const { palette } = useTheme();
  const events = useMemo(() => buildTimeline(sos), [sos]);

  return (
    <View style={{ marginTop: spacing.lg }}>
      <SectionHeader title="Alert Timeline" />
      <View style={{ marginTop: spacing.xs }}>
        {events.map((e, i) => (
          <View key={e.key} style={styles.row}>
            <View style={styles.rail}>
              <View style={[styles.dot, { backgroundColor: palette.primary }]}>
                <Ionicons name={e.icon} size={12} color={palette.white} />
              </View>
              {i < events.length - 1 ? <View style={[styles.line, { backgroundColor: palette.border }]} /> : null}
            </View>
            <View style={{ flex: 1, paddingBottom: spacing.md }}>
              <Text style={[styles.time, { color: palette.textMuted }]}>{new Date(e.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</Text>
              <Text style={[styles.label, { color: palette.text }]}>{e.label}</Text>
            </View>
          </View>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row' },
  rail: { alignItems: 'center', marginRight: spacing.sm },
  dot: { width: 22, height: 22, borderRadius: 11, alignItems: 'center', justifyContent: 'center' },
  line: { width: 2, flex: 1, marginTop: 2 },
  time: { ...typography.caption },
  label: { ...typography.bodyMedium, marginTop: 1 },
});

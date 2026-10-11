import React from 'react';
import { View, Text, StyleSheet, Pressable } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { StatusBadge } from '../../components/ui';
import { ClaySurface } from '../../theme/clay';
import { useTheme } from '../../contexts/ThemeContext';
import { spacing, typography } from '../../theme/theme';
import type { CaseReport, CaseStatus } from '../../types/database.types';

const STAGE_LABELS = ['Submitted', 'Reviewing', 'In Progress', 'Resolved'] as const;

// Maps the real, backend-defined CaseStatus values onto the compact
// 4-stage strip a Home card has room for — this is a display
// simplification only; the actual status (shown via StatusBadge, e.g.
// "Referred" or "Assigned") is never hidden, just summarized.
function stageIndexForStatus(status: CaseStatus): number {
  switch (status) {
    case 'Pending':
      return 0;
    case 'Under Review':
    case 'Assigned':
      return 1;
    case 'In Progress':
    case 'Referred':
      return 2;
    case 'Resolved':
    case 'Closed':
      return 3;
    default:
      return 0;
  }
}

function formatRelative(dateStr: string): string {
  const then = new Date(dateStr).getTime();
  const diffMs = Date.now() - then;
  const diffMin = Math.floor(diffMs / 60000);
  if (diffMin < 1) return 'just now';
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return diffHr === 1 ? '1 hour ago' : `${diffHr} hours ago`;
  const diffDay = Math.floor(diffHr / 24);
  if (diffDay === 1) return 'yesterday';
  if (diffDay < 7) return `${diffDay} days ago`;
  return new Date(dateStr).toLocaleDateString();
}

function ProgressStrip({ stage }: { stage: number }) {
  const { palette } = useTheme();
  return (
    <View style={styles.progressRow}>
      {STAGE_LABELS.map((label, i) => (
        <React.Fragment key={label}>
          {i > 0 ? <View style={[styles.progressLine, { backgroundColor: i <= stage ? palette.primary : palette.border }]} /> : null}
          <View style={[styles.progressDot, { backgroundColor: i <= stage ? palette.primary : palette.border }]} />
        </React.Fragment>
      ))}
    </View>
  );
}

export function CaseSummaryCard({ caseReport, onPress }: { caseReport: CaseReport; onPress: () => void }) {
  const { palette } = useTheme();
  const stage = stageIndexForStatus(caseReport.status);
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`Case ${caseReport.case_number}`}
      accessibilityHint={`Status: ${caseReport.status}. Opens case details.`}
    >
      <ClaySurface radius={20} tint={palette.surface} shadowTint={palette.primaryDark} intensity="sm" innerStyle={styles.cardInner} highlightOpacity={0.24}>
        <View style={styles.topRow}>
          <Text style={[styles.caseNumber, { color: palette.text }]}>{caseReport.case_number}</Text>
          <StatusBadge label={caseReport.status} />
        </View>
        <Text style={[styles.updated, { color: palette.textMuted }]}>Last updated {formatRelative(caseReport.updated_at)}</Text>
        <ProgressStrip stage={stage} />
        <View style={styles.footerRow}>
          {STAGE_LABELS.map((label, i) => (
            <Text key={label} style={[styles.stageLabel, { color: i === stage ? palette.primary : palette.textMuted }]} numberOfLines={1}>
              {label}
            </Text>
          ))}
        </View>
      </ClaySurface>
    </Pressable>
  );
}

/** Compact empty state — one card, not a large centered block. Matches
 * CaseSummaryCard's own footprint so swapping between "has a case" and
 * "no cases yet" doesn't jump the layout around. */
export function EmptyCaseCard({ onReport }: { onReport: () => void }) {
  const { palette } = useTheme();
  return (
    <ClaySurface radius={20} tint={palette.surface} shadowTint={palette.primaryDark} intensity="sm" innerStyle={styles.emptyInner} highlightOpacity={0.24}>
      <View style={styles.emptyRow}>
        <View style={[styles.emptyIconWrap, { backgroundColor: palette.primaryLight }]}>
          <Ionicons name="document-text-outline" size={17} color={palette.primary} />
        </View>
        <View style={{ flex: 1, marginLeft: spacing.sm }}>
          <Text style={[styles.emptyTitle, { color: palette.text }]}>No cases yet</Text>
          <Text style={[styles.emptyBody, { color: palette.textMuted }]} numberOfLines={1}>
            Your submitted reports will appear here.
          </Text>
        </View>
      </View>
      <Pressable onPress={onReport} style={styles.emptyBtn} accessibilityRole="button" accessibilityLabel="Report an incident">
        <Text style={[styles.emptyBtnText, { color: palette.primary }]}>Report an incident</Text>
        <Ionicons name="chevron-forward" size={14} color={palette.primary} />
      </Pressable>
    </ClaySurface>
  );
}

export function CaseSectionHeader({ activeCount }: { activeCount: number }) {
  const { palette } = useTheme();
  return (
    <View style={styles.sectionBadgeRow}>
      <Ionicons name="folder-outline" size={14} color={palette.primary} />
      <Text style={[styles.sectionBadgeText, { color: palette.primary }]}>
        {activeCount === 0 ? 'No active cases' : activeCount === 1 ? '1 active case' : `${activeCount} active cases`}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  cardInner: { padding: spacing.md },
  topRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  caseNumber: { ...typography.subheading },
  updated: { ...typography.caption, marginTop: 2, marginBottom: spacing.sm },
  progressRow: { flexDirection: 'row', alignItems: 'center' },
  progressDot: { width: 8, height: 8, borderRadius: 4 },
  progressLine: { flex: 1, height: 2, marginHorizontal: 4 },
  footerRow: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 6 },
  stageLabel: { ...typography.caption, fontSize: 10, flex: 1, textAlign: 'center' },
  sectionBadgeRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  sectionBadgeText: { ...typography.caption, fontFamily: 'Inter_600SemiBold' as any },

  emptyInner: { padding: spacing.md },
  emptyRow: { flexDirection: 'row', alignItems: 'center' },
  emptyIconWrap: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  emptyTitle: { ...typography.bodyMedium },
  emptyBody: { ...typography.caption, marginTop: 1 },
  emptyBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4, marginTop: spacing.sm, paddingVertical: 4 },
  emptyBtnText: { ...typography.bodyMedium, fontSize: 13 },
});

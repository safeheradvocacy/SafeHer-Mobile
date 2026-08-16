import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, StyleSheet, Pressable, RefreshControl, ScrollView } from 'react-native';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { BottomTabNavigationProp } from '@react-navigation/bottom-tabs';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { CompositeNavigationProp } from '@react-navigation/native';
import { useAuth } from '../../contexts/AuthContext';
import { supabase } from '../../lib/supabase';
import { Card, StatusBadge } from '../../components/ui';
import { colors, radius, spacing, typography } from '../../theme/theme';
import { AppStackParamList, AppTabParamList } from '../../navigation/types';
import type { CaseReport } from '../../types/database.types';

type Nav = CompositeNavigationProp<
  BottomTabNavigationProp<AppTabParamList, 'HomeTab'>,
  NativeStackNavigationProp<AppStackParamList>
>;

const ACTIONS: { key: string; label: string; screen: keyof AppTabParamList | keyof AppStackParamList; danger?: boolean }[] = [
  { key: 'sos', label: 'Emergency SOS', screen: 'SosTab', danger: true },
  { key: 'report', label: 'Report Incident', screen: 'ReportIncident' },
  { key: 'cases', label: 'Track My Cases', screen: 'CasesTab' },
  { key: 'chat', label: 'AI Chatbot', screen: 'ChatTab' },
  { key: 'shelters', label: 'Shelter Locator', screen: 'SheltersTab' },
  { key: 'notifications', label: 'Notifications', screen: 'Notifications' },
];

export function HomeScreen() {
  const navigation = useNavigation<Nav>();
  const { profile } = useAuth();
  const [recentCase, setRecentCase] = useState<CaseReport | null>(null);
  const [unreadCount, setUnreadCount] = useState(0);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    if (!profile) return;

    if (profile.role === 'survivor') {
      const { data: survivorRow } = await supabase
        .from('survivors')
        .select('survivor_id')
        .eq('profile_id', profile.profile_id)
        .single();

      if (survivorRow) {
        const { data: caseRows } = await supabase
          .from('case_reports')
          .select('*')
          .eq('survivor_id', survivorRow.survivor_id)
          .order('reported_at', { ascending: false })
          .limit(1);
        setRecentCase(caseRows?.[0] ?? null);
      }
    }

    const { count } = await supabase
      .from('notifications')
      .select('*', { count: 'exact', head: true })
      .eq('profile_id', profile.profile_id)
      .eq('is_read', false);
    setUnreadCount(count ?? 0);
  }, [profile]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  const onRefresh = async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  };

  const goTo = (screen: string) => {
    if (screen === 'HomeTab' || screen === 'CasesTab' || screen === 'SosTab' || screen === 'ChatTab' || screen === 'SheltersTab') {
      navigation.navigate(screen as keyof AppTabParamList);
    } else {
      navigation.navigate(screen as any);
    }
  };

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={{ padding: spacing.lg, paddingBottom: spacing.xxl }}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
    >
      <Text style={styles.greeting}>Hi, {profile?.first_name ?? 'there'}</Text>
      <Text style={styles.subtitle}>What do you need right now?</Text>

      <View style={styles.grid}>
        {ACTIONS.map((action) => (
          <Pressable
            key={action.key}
            style={[styles.actionTile, action.danger && styles.actionTileDanger]}
            onPress={() => goTo(action.screen as string)}
          >
            <Text style={[styles.actionLabel, action.danger && styles.actionLabelDanger]}>{action.label}</Text>
            {action.key === 'notifications' && unreadCount > 0 && (
              <View style={styles.badgeDot}>
                <Text style={styles.badgeDotText}>{unreadCount}</Text>
              </View>
            )}
          </Pressable>
        ))}
      </View>

      {recentCase && (
        <>
          <Text style={styles.sectionTitle}>Your most recent report</Text>
          <Pressable onPress={() => navigation.navigate('CaseDetail', { caseId: recentCase.case_id })}>
            <Card>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                <Text style={styles.caseNumber}>{recentCase.case_number}</Text>
                <StatusBadge label={recentCase.status} />
              </View>
              <Text style={styles.caseType}>{recentCase.case_type}</Text>
            </Card>
          </Pressable>
        </>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  greeting: { ...typography.display, fontSize: 24, color: colors.text },
  subtitle: { ...typography.body, color: colors.textMuted, marginTop: spacing.xs, marginBottom: spacing.lg },
  grid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between' },
  actionTile: {
    width: '48%',
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    marginBottom: spacing.md,
    minHeight: 84,
    justifyContent: 'center',
  },
  actionTileDanger: { backgroundColor: colors.danger },
  actionLabel: { ...typography.subheading, color: colors.text },
  actionLabelDanger: { color: colors.white },
  badgeDot: {
    position: 'absolute',
    top: spacing.sm,
    right: spacing.sm,
    backgroundColor: colors.dangerDark,
    borderRadius: radius.pill,
    minWidth: 20,
    height: 20,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 4,
  },
  badgeDotText: { color: colors.white, fontSize: 11, fontFamily: 'Inter_600SemiBold' as any },
  sectionTitle: { ...typography.heading, color: colors.text, marginTop: spacing.md, marginBottom: spacing.sm },
  caseNumber: { ...typography.subheading, color: colors.text },
  caseType: { ...typography.caption, color: colors.textMuted, marginTop: spacing.xs },
});

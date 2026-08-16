import React, { useCallback, useState } from 'react';
import { View, Text, StyleSheet, FlatList, Pressable, RefreshControl, ActivityIndicator } from 'react-native';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { CompositeNavigationProp } from '@react-navigation/native';
import { BottomTabNavigationProp } from '@react-navigation/bottom-tabs';
import { useAuth } from '../../contexts/AuthContext';
import { supabase } from '../../lib/supabase';
import { Card, EmptyState, StatusBadge } from '../../components/ui';
import { colors, spacing, typography } from '../../theme/theme';
import { AppStackParamList, AppTabParamList } from '../../navigation/types';
import type { CaseReport } from '../../types/database.types';

type Nav = CompositeNavigationProp<
  BottomTabNavigationProp<AppTabParamList, 'CasesTab'>,
  NativeStackNavigationProp<AppStackParamList>
>;

export function CaseListScreen() {
  const navigation = useNavigation<Nav>();
  const { profile } = useAuth();
  const [cases, setCases] = useState<CaseReport[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    if (!profile) return;
    const { data: survivorRow } = await supabase
      .from('survivors')
      .select('survivor_id')
      .eq('profile_id', profile.profile_id)
      .single();
    if (!survivorRow) {
      setCases([]);
      setLoading(false);
      return;
    }
    const { data } = await supabase
      .from('case_reports')
      .select('*')
      .eq('survivor_id', survivorRow.survivor_id)
      .order('reported_at', { ascending: false });
    setCases(data ?? []);
    setLoading(false);
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

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }

  return (
    <FlatList
      style={styles.screen}
      contentContainerStyle={{ padding: spacing.lg, flexGrow: 1 }}
      data={cases}
      keyExtractor={(item) => item.case_id}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
      ListHeaderComponent={<Text style={styles.title}>My cases</Text>}
      ListEmptyComponent={
        <EmptyState title="No reports yet" subtitle="Reports you submit will appear here so you can track their progress." />
      }
      renderItem={({ item }) => (
        <Pressable onPress={() => navigation.navigate('CaseDetail', { caseId: item.case_id })}>
          <Card>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
              <Text style={styles.caseNumber}>{item.case_number}</Text>
              <StatusBadge label={item.status} />
            </View>
            <Text style={styles.caseType}>{item.case_type}</Text>
            <View style={{ flexDirection: 'row', marginTop: spacing.xs }}>
              <StatusBadge label={item.priority_level} />
            </View>
          </Card>
        </Pressable>
      )}
    />
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.background },
  title: { ...typography.display, fontSize: 24, color: colors.text, marginBottom: spacing.lg },
  caseNumber: { ...typography.subheading, color: colors.text },
  caseType: { ...typography.caption, color: colors.textMuted, marginTop: spacing.xs, marginBottom: spacing.xs },
});

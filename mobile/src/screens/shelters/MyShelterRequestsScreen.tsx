import React, { useCallback, useState } from 'react';
import { View, Text, StyleSheet, FlatList, RefreshControl, ActivityIndicator, Pressable, Alert } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { useAuth } from '../../contexts/AuthContext';
import { supabase } from '../../lib/supabase';
import { StatusBadge, EmptyState, AlertMessage } from '../../components/ui';
import { useTheme } from '../../contexts/ThemeContext';
import { radius, spacing, typography } from '../../theme/theme';
import type { ShelterRequest, ShelterRequestStatus } from '../../types/database.types';

type Row = ShelterRequest & { shelters?: { shelter_name: string } | null };

const CANCELLABLE: ShelterRequestStatus[] = ['Submitted', 'Under Review', 'Awaiting Information'];

// Plain, honest next-step copy derived from the real, existing status
// value — never a guarantee of outcome or timing (brief: "do not
// promise approval, immediate placement, or availability that has not
// been confirmed").
function nextStepCopy(status: ShelterRequestStatus): string {
  switch (status) {
    case 'Submitted':
      return 'Waiting for the shelter to review your request.';
    case 'Under Review':
      return 'The shelter is reviewing your request.';
    case 'Awaiting Information':
      return 'The shelter needs more information from you — check your notifications.';
    case 'Accepted':
      return 'Your request was accepted. The shelter will follow up on next steps.';
    case 'Placement Confirmed':
      return 'Your placement has been confirmed.';
    case 'Declined':
      return 'This request was declined.';
    case 'Cancelled':
      return 'You cancelled this request.';
    case 'Completed':
      return 'This request has been completed.';
    default:
      return '';
  }
}

export function MyShelterRequestsScreen() {
  const { profile } = useAuth();
  const { palette } = useTheme();
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(false);
  const [cancellingId, setCancellingId] = useState<string | null>(null);

  const load = useCallback(
    async (isRefresh = false) => {
      if (!profile) return;
      if (isRefresh) setRefreshing(true);
      setError(false);
      const { data, error: err } = await supabase
        .from('shelter_requests')
        .select('*, shelters(shelter_name)')
        .eq('profile_id', profile.profile_id)
        .order('created_at', { ascending: false });
      if (err) {
        console.error('[MyShelterRequestsScreen] load:', err.message);
        setError(true);
      } else {
        setRows((data as Row[]) ?? []);
      }
      setLoading(false);
      setRefreshing(false);
    },
    [profile]
  );

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  const cancel = (row: Row) => {
    Alert.alert('Cancel this request?', 'The shelter will no longer review this request. This cannot be undone.', [
      { text: 'Keep request', style: 'cancel' },
      {
        text: 'Cancel request',
        style: 'destructive',
        onPress: async () => {
          setCancellingId(row.request_id);
          const { error: err } = await supabase.from('shelter_requests').update({ status: 'Cancelled' }).eq('request_id', row.request_id);
          setCancellingId(null);
          if (err) {
            console.error('[MyShelterRequestsScreen] cancel:', err.message);
            Alert.alert("Couldn't cancel this request", 'Please try again.');
            return;
          }
          load();
        },
      },
    ]);
  };

  if (loading) {
    return (
      <View style={[styles.center, { backgroundColor: palette.background }]}>
        <ActivityIndicator color={palette.primary} />
      </View>
    );
  }

  return (
    <View style={[styles.screen, { backgroundColor: palette.background }]}>
      {error ? (
        <AlertMessage variant="error" title="Couldn't load your shelter requests" message="Please check your connection and try again." onRetry={() => load()} />
      ) : null}
      <FlatList
        data={rows}
        keyExtractor={(r) => r.request_id}
        contentContainerStyle={{ padding: spacing.lg }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => load(true)} tintColor={palette.primary} />}
        ListEmptyComponent={
          !error ? <EmptyState title="No shelter requests yet" subtitle="Requests you submit will appear here." /> : null
        }
        renderItem={({ item }) => (
          <View style={[styles.row, { borderColor: palette.border, backgroundColor: palette.surface }]}>
            <View style={styles.rowHead}>
              <Text style={[styles.rowTitle, { color: palette.text }]}>{item.shelters?.shelter_name ?? 'Shelter'}</Text>
              <StatusBadge label={item.status} />
            </View>
            <Text style={[styles.rowMeta, { color: palette.textMuted }]}>
              {new Date(item.created_at).toLocaleString([], { month: 'long', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
            </Text>
            <Text style={[styles.rowMeta, { color: palette.textMuted }]}>{nextStepCopy(item.status)}</Text>
            {CANCELLABLE.includes(item.status) ? (
              <Pressable onPress={() => cancel(item)} disabled={cancellingId === item.request_id} style={{ marginTop: spacing.xs }}>
                <Text style={[styles.cancelLink, { color: palette.danger }]}>
                  {cancellingId === item.request_id ? 'Cancelling...' : 'Cancel request'}
                </Text>
              </Pressable>
            ) : null}
          </View>
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  row: { borderWidth: 1, borderRadius: radius.md, padding: spacing.md, marginBottom: spacing.sm },
  rowHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 },
  rowTitle: { ...typography.bodyMedium },
  rowMeta: { ...typography.caption, marginTop: 2 },
  cancelLink: { ...typography.bodyMedium },
});

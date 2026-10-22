import React, { useCallback, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable, Linking, ActivityIndicator, RefreshControl } from 'react-native';
import { useRoute, RouteProp, useNavigation, useFocusEffect } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '../../lib/supabase';
import { AlertMessage, PrimaryButton, SectionHeader } from '../../components/ui';
import { ShelterPhoto } from '../../components/shelters/ShelterPhoto';
import { useTheme } from '../../contexts/ThemeContext';
import { radius, spacing, typography } from '../../theme/theme';
import { AppStackParamList } from '../../navigation/types';
import type { Shelter } from '../../types/database.types';

function availabilityLabel(s: Shelter): { text: string; tone: 'success' | 'warning' | 'muted' } {
  if (s.capacity == null) return { text: 'Capacity information not available', tone: 'muted' };
  const available = s.capacity - s.current_occupancy;
  if (available > 0) return { text: `${available} space${available === 1 ? '' : 's'} available`, tone: 'success' };
  return { text: 'Currently at full capacity', tone: 'warning' };
}

function InfoRow({ icon, label, value }: { icon: React.ComponentProps<typeof Ionicons>['name']; label: string; value: string }) {
  const { palette } = useTheme();
  return (
    <View style={styles.infoRow}>
      <Ionicons name={icon} size={16} color={palette.textMuted} style={{ marginTop: 2 }} />
      <View style={{ flex: 1, marginLeft: spacing.sm }}>
        <Text style={[styles.infoLabel, { color: palette.textMuted }]}>{label}</Text>
        <Text style={[styles.infoValue, { color: palette.text }]}>{value}</Text>
      </View>
    </View>
  );
}

export function ShelterDetailScreen() {
  const route = useRoute<RouteProp<AppStackParamList, 'ShelterDetail'>>();
  const navigation = useNavigation<NativeStackNavigationProp<AppStackParamList>>();
  const { palette } = useTheme();
  const [shelter, setShelter] = useState<Shelter | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [notFound, setNotFound] = useState(false);

  const load = useCallback(
    async (isRefresh = false) => {
      if (isRefresh) setRefreshing(true);
      const { data } = await supabase.from('shelters').select('*').eq('shelter_id', route.params.shelterId).maybeSingle();
      setShelter(data ?? null);
      setNotFound(!data);
      setLoading(false);
      setRefreshing(false);
    },
    [route.params.shelterId]
  );

  // Refresh on return — picks up an administrator's photo/detail change
  // without the user needing to leave and re-enter Shelters.
  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  if (loading) {
    return (
      <View style={[styles.center, { backgroundColor: palette.background }]}>
        <ActivityIndicator color={palette.primary} />
      </View>
    );
  }

  if (notFound || !shelter) {
    return (
      <View style={[styles.screen, { backgroundColor: palette.background, padding: spacing.lg }]}>
        <AlertMessage variant="error" title="Shelter not found" message="This shelter is unavailable or no longer active." />
      </View>
    );
  }

  const services = (shelter.services_available ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const avail = availabilityLabel(shelter);
  const hasCoords = shelter.latitude != null && shelter.longitude != null;

  return (
    <ScrollView
      style={[styles.screen, { backgroundColor: palette.background }]}
      contentContainerStyle={{ paddingBottom: spacing.xxl }}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => load(true)} tintColor={palette.primary} />}
    >
      <ShelterPhoto path={shelter.photo_path} style={styles.hero} iconSize={48} />

      <View style={{ padding: spacing.lg }}>
        <Text style={[styles.name, { color: palette.text }]}>{shelter.shelter_name}</Text>
        {!shelter.is_active ? <Text style={[styles.inactiveNote, { color: palette.danger }]}>This shelter is not currently active.</Text> : null}

        <View
          style={[
            styles.availBadge,
            {
              backgroundColor: (avail.tone === 'success' ? palette.success : avail.tone === 'warning' ? palette.warning : palette.textMuted) + '1A',
            },
          ]}
        >
          <Text style={[styles.availText, { color: avail.tone === 'success' ? palette.success : avail.tone === 'warning' ? palette.warning : palette.textMuted }]}>
            {avail.text}
          </Text>
        </View>

        <SectionHeader title="Shelter Information" />
        {shelter.address ? <InfoRow icon="location-outline" label="Address" value={shelter.address} /> : null}
        {services.length > 0 ? <InfoRow icon="hand-left-outline" label="Services" value={services.join(', ')} /> : null}
        {shelter.contact_number ? <InfoRow icon="call-outline" label="Contact number" value={shelter.contact_number} /> : null}
        {shelter.email ? <InfoRow icon="mail-outline" label="Email" value={shelter.email} /> : null}
        {shelter.capacity != null ? (
          <InfoRow icon="people-outline" label="Capacity" value={`${shelter.current_occupancy} of ${shelter.capacity} occupied`} />
        ) : null}
        {/* No operating-hours/intake-schedule field exists on shelters
            (confirmed: schema has no such column) — that section is
            omitted entirely rather than shown empty, per the brief's own
            "hide sections for missing optional fields" instruction. */}

        <View style={styles.actionsRow}>
          {shelter.contact_number ? (
            <Pressable onPress={() => Linking.openURL(`tel:${shelter.contact_number}`)} style={[styles.actionBtn, { borderColor: palette.border }]}>
              <Ionicons name="call" size={16} color={palette.primary} />
              <Text style={[styles.actionText, { color: palette.primary }]}>Call</Text>
            </Pressable>
          ) : null}
          {hasCoords ? (
            <Pressable
              onPress={() => Linking.openURL(`https://www.google.com/maps/dir/?api=1&destination=${shelter.latitude},${shelter.longitude}`)}
              style={[styles.actionBtn, { borderColor: palette.border }]}
            >
              <Ionicons name="navigate" size={16} color={palette.primary} />
              <Text style={[styles.actionText, { color: palette.primary }]}>Directions</Text>
            </Pressable>
          ) : null}
        </View>

        <View style={{ marginTop: spacing.lg }}>
          <PrimaryButton title="Request Shelter" onPress={() => navigation.navigate('RequestShelter', { shelterId: shelter.shelter_id })} />
          <Text style={[styles.disclaimer, { color: palette.textMuted }]}>
            Submitting a request does not guarantee admission — the shelter will review it and follow up with you.
          </Text>
        </View>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  hero: { width: '100%', height: 200 },
  name: { ...typography.display, fontSize: 22 },
  inactiveNote: { ...typography.caption, marginTop: 4 },
  availBadge: { alignSelf: 'flex-start', borderRadius: radius.pill, paddingHorizontal: spacing.sm, paddingVertical: 4, marginTop: spacing.sm },
  availText: { ...typography.caption, fontFamily: 'Inter_600SemiBold' as any },
  infoRow: { flexDirection: 'row', marginTop: spacing.sm },
  infoLabel: { ...typography.caption },
  infoValue: { ...typography.body, marginTop: 1 },
  actionsRow: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.md },
  actionBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, borderWidth: 1, borderRadius: radius.pill, paddingHorizontal: spacing.md, paddingVertical: 8 },
  actionText: { ...typography.bodyMedium },
  disclaimer: { ...typography.caption, textAlign: 'center', marginTop: spacing.sm },
});

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { View, Text, StyleSheet, Pressable, RefreshControl, ScrollView } from 'react-native';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { BottomTabNavigationProp } from '@react-navigation/bottom-tabs';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { CompositeNavigationProp } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useNetworkState } from 'expo-network';
import RAnimated, { useSharedValue, useAnimatedStyle, withTiming, withRepeat, withSequence, Easing } from 'react-native-reanimated';
import { useAuth } from '../../contexts/AuthContext';
import { supabase } from '../../lib/supabase';
import { useGoToReportIncident } from '../../lib/reportIncidentGuard';
import { PressableScale, AlertMessage, FadeInUp, useReducedMotion } from '../../components/ui';
import { HeaderActions } from '../../components/ScreenHeader';
import { LogoMark } from '../../components/branding/LogoMark';
import { useTour } from '../../contexts/TourContext';
import { measureAndRegister } from '../../lib/tourMeasure';
import { ClaySurface } from '../../theme/clay';
import { useTheme } from '../../contexts/ThemeContext';
import { spacing, radius, typography } from '../../theme/theme';
import { AppStackParamList, AppTabParamList } from '../../navigation/types';
import type { CaseReport } from '../../types/database.types';
import { AnimatedBackground } from './AnimatedBackground';
import { QuickActionCard } from './QuickActionCard';
import { CaseSummaryCard, CaseSectionHeader, EmptyCaseCard } from './CaseSummaryCard';
import { SosConfirmSheet } from './SosConfirmSheet';

type Nav = CompositeNavigationProp<
  BottomTabNavigationProp<AppTabParamList, 'HomeTab'>,
  NativeStackNavigationProp<AppStackParamList>
>;

const ACTIVE_CASE_STATUSES = ['Pending', 'Under Review', 'Assigned', 'In Progress', 'Referred'];

function getGreeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return 'Good morning';
  if (hour < 18) return 'Good afternoon';
  return 'Good evening';
}

/** Very subtle breathing pulse for the SOS icon — icon gently scales, a
 * soft outer glow expands slightly, both return to rest, slow loop. Never
 * runs under Reduce Motion. This is the ONLY continuously-looping
 * animation on Home, deliberately restrained so the card reads as "help
 * is available" rather than a constant, anxious warning. */
function SosIcon({ reduced }: { reduced: boolean }) {
  const { palette } = useTheme();
  const pulse = useSharedValue(0);
  useEffect(() => {
    if (reduced) return;
    pulse.value = withRepeat(withSequence(withTiming(1, { duration: 1800, easing: Easing.inOut(Easing.sin) }), withTiming(0, { duration: 1800, easing: Easing.inOut(Easing.sin) })), -1, false);
  }, [reduced, pulse]);
  const glowStyle = useAnimatedStyle(() => ({ opacity: 0.16 + pulse.value * 0.16, transform: [{ scale: 1 + pulse.value * 0.14 }] }));
  const iconStyle = useAnimatedStyle(() => ({ transform: [{ scale: 1 + pulse.value * 0.05 }] }));
  return (
    <View style={styles.sosIconWrap}>
      {!reduced ? <RAnimated.View style={[styles.sosIconGlow, glowStyle]} /> : null}
      <RAnimated.View style={[styles.sosIconCircle, iconStyle]}>
        <Ionicons name="alert" size={22} color={palette.white} />
      </RAnimated.View>
    </View>
  );
}

export function HomeScreen() {
  const navigation = useNavigation<Nav>();
  const goToReportIncident = useGoToReportIncident();
  const insets = useSafeAreaInsets();
  const { profile } = useAuth();
  const systemReducedMotion = useReducedMotion();
  const { palette, prefs } = useTheme();
  const reduced = systemReducedMotion || prefs.reduceMotion;
  // isConnected is `undefined` until the first real reading comes back —
  // treat that as "online" rather than flashing the banner on every
  // mount. Only a confirmed `false` counts as offline.
  const isOffline = useNetworkState().isConnected === false;

  const [recentCase, setRecentCase] = useState<CaseReport | null>(null);
  const [activeCaseCount, setActiveCaseCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [showSosConfirm, setShowSosConfirm] = useState(false);

  const load = useCallback(async () => {
    if (!profile) return;
    setLoadError(false);
    try {
      if (profile.role === 'survivor') {
        const { data: survivorRow } = await supabase
          .from('survivors')
          .select('survivor_id')
          .eq('profile_id', profile.profile_id)
          .single();

        if (survivorRow) {
          const [{ data: caseRows }, { count }] = await Promise.all([
            supabase
              .from('case_reports')
              .select('*')
              .eq('survivor_id', survivorRow.survivor_id)
              .order('reported_at', { ascending: false })
              .limit(1),
            supabase
              .from('case_reports')
              .select('*', { count: 'exact', head: true })
              .eq('survivor_id', survivorRow.survivor_id)
              .in('status', ACTIVE_CASE_STATUSES),
          ]);
          setRecentCase(caseRows?.[0] ?? null);
          setActiveCaseCount(count ?? 0);
        }
      }
    } catch {
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  }, [profile]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  const { startIfNeeded, registerTarget, registerTargetRef, skip: skipTour, active: tourActive } = useTour();
  const reportIncidentRef = useRef<View>(null);
  const greetingRef = useRef<View>(null);
  const sosCardRef = useRef<View>(null);
  const scrollRef = useRef<ScrollView>(null);

  useEffect(() => {
    if (profile) startIfNeeded(profile.profile_id);
  }, [profile, startIfNeeded]);

  useEffect(() => {
    // Every Home target the tour spotlights (the greeting, Report
    // Incident, the SOS obstacle) sits near the top of this screen's
    // content by design — scrolling back to the top whenever the tour
    // starts guarantees they're all actually on screen to measure and
    // highlight, regardless of where the user had scrolled to before
    // (e.g. replaying the tour from Profile after having scrolled Home
    // earlier in the session, since the ScrollView stays mounted and
    // keeps its offset across tab switches). No animation — this should
    // already be the resting position by the time anyone sees it.
    if (tourActive) scrollRef.current?.scrollTo({ y: 0, animated: false });
  }, [tourActive]);

  const onRefresh = async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  };

  return (
    <View style={[styles.screen, { backgroundColor: palette.background }]}>
      <AnimatedBackground reduced={reduced} />
      <ScrollView
        ref={scrollRef}
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingTop: insets.top + spacing.sm, paddingBottom: spacing.xxl }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={palette.primary} />}
        // Locked while the tour is active — every spotlighted element on
        // Home is reachable without scrolling by design, and letting the
        // page move during a step would both look wrong and, previously,
        // was the actual cause of later steps (Profile, the furthest from
        // its own registration) drifting from their real on-screen
        // position: a scroll offset change doesn't trigger onLayout, so a
        // coordinate captured before the scroll just goes stale.
        scrollEnabled={!tourActive}
      >
        {/* Header */}
        <FadeInUp reduced={reduced} delay={0} duration={320} style={styles.header}>
          <LogoMark size="md" />
          <View style={{ flex: 1 }} />
          <HeaderActions />
        </FadeInUp>

        <View style={styles.content}>
          {isOffline ? (
            <View style={[styles.offlineBanner, { backgroundColor: palette.warning + '1A', borderColor: palette.warning + '55' }]}>
              <Ionicons name="cloud-offline-outline" size={15} color={palette.warning} />
              <View style={{ flex: 1, marginLeft: spacing.xs }}>
                <Text style={[styles.offlineTitle, { color: palette.text }]}>You're offline</Text>
                <Text style={[styles.offlineBody, { color: palette.textMuted }]}>Some services may be temporarily unavailable.</Text>
              </View>
            </View>
          ) : null}

          {/* Greeting */}
          <FadeInUp reduced={reduced} delay={60} duration={320}>
            <View
              ref={greetingRef}
              onLayout={() => {
                measureAndRegister(greetingRef, 'home', registerTarget, registerTargetRef, { shape: 'rounded', radius: 16 });
              }}
            >
              <Text style={[styles.greeting, { color: palette.text }]}>
                {getGreeting()},{'\n'}
                {profile?.first_name ?? 'there'}
              </Text>
              <Text style={[styles.subtitle, { color: palette.textMuted }]}>How can we help you today?</Text>
            </View>
          </FadeInUp>

          {/* Emergency SOS */}
          <FadeInUp reduced={reduced} delay={120} duration={320}>
            <Pressable
              ref={sosCardRef}
              onLayout={() => {
                // Registered purely as a layout obstacle (never a
                // spotlighted step) — this is what lets the tour overlay
                // detect that the Home/Report Incident steps sit directly
                // above this card and keep its tooltip from landing on
                // top of it, since SOS must never be covered by the tour.
                measureAndRegister(sosCardRef, 'sosCard', registerTarget, registerTargetRef);
              }}
              onPress={() => {
                // Pressing the real SOS action always hands control back
                // to the real app immediately — the tour never gets in
                // the way of an actual emergency action, on this card or
                // the SOS tab alike.
                skipTour();
                setShowSosConfirm(true);
              }}
              accessibilityRole="button"
              accessibilityLabel="Emergency SOS"
              accessibilityHint="Opens the emergency SOS confirmation"
            >
              <ClaySurface radius={24} tint="transparent" shadowTint={palette.dangerDark} intensity="lg" style={styles.sosCardShadow} innerStyle={styles.sosCardInner} highlightOpacity={0}>
                <LinearGradient
                  colors={[palette.danger, palette.dangerDark]}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 1 }}
                  style={StyleSheet.absoluteFill}
                  pointerEvents="none"
                />
                {/* Controlled upper-portion sheen, same physical-surface
                    language as the primary auth CTA — not the generic
                    diagonal white gloss, which read as messy over a
                    saturated fill in an earlier pass on this palette. */}
                <LinearGradient
                  colors={['rgba(255,255,255,0.16)', 'rgba(255,255,255,0)']}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 0, y: 0.85 }}
                  style={StyleSheet.absoluteFill}
                  pointerEvents="none"
                />
                <SosIcon reduced={reduced} />
                <Text style={styles.sosTitle}>Emergency SOS</Text>
                <Text style={styles.sosSubtitle}>Get immediate help when needed</Text>
              </ClaySurface>
            </Pressable>
          </FadeInUp>

          {/* Quick Actions */}
          <FadeInUp reduced={reduced} delay={180} duration={320}>
            <Text style={[styles.sectionTitle, { color: palette.text }]}>Quick Actions</Text>
            <View style={styles.actionsGrid}>
              <View style={styles.actionsRow}>
                <View
                  style={{ flex: 1 }}
                  ref={reportIncidentRef}
                  onLayout={() => {
                    measureAndRegister(reportIncidentRef, 'reportIncident', registerTarget, registerTargetRef, { shape: 'rounded', radius: 18 });
                  }}
                >
                  <QuickActionCard
                    icon="document-text"
                    tint={palette.primary}
                    title="Report Incident"
                    description="Submit a report"
                    reduced={reduced}
                    onPress={goToReportIncident}
                  />
                </View>
                <QuickActionCard
                  icon="clipboard"
                  tint={palette.primary}
                  title="Track My Cases"
                  description="View case status"
                  badge={loading ? undefined : activeCaseCount === 0 ? 'No active cases' : activeCaseCount === 1 ? '1 active case' : `${activeCaseCount} active cases`}
                  reduced={reduced}
                  onPress={() => navigation.navigate('CasesTab')}
                />
              </View>
              <View style={styles.actionsRow}>
                <QuickActionCard
                  icon="chatbubble-ellipses"
                  tint={palette.primary}
                  title="AI Assistant"
                  description="Chat with support"
                  reduced={reduced}
                  onPress={() => navigation.navigate('ChatTab')}
                />
                <QuickActionCard
                  icon="home"
                  tint={palette.primary}
                  title="Shelter Locator"
                  description="Find nearby shelters"
                  reduced={reduced}
                  onPress={() => navigation.navigate('SheltersTab')}
                />
              </View>
              <View style={styles.actionsRow}>
                <QuickActionCard
                  icon="megaphone"
                  tint={palette.primary}
                  title="Announcements"
                  description="Provincial updates"
                  reduced={reduced}
                  onPress={() => navigation.navigate('Announcements')}
                />
                <View style={{ flex: 1 }} />
              </View>
            </View>
          </FadeInUp>

          {/* Your Cases */}
          <FadeInUp reduced={reduced} delay={240} duration={320}>
            <View style={styles.sectionHeaderRow}>
              <View>
                <Text style={[styles.sectionTitle, { color: palette.text }]}>Your Cases</Text>
                {!loading && !loadError ? <CaseSectionHeader activeCount={activeCaseCount} /> : null}
              </View>
              <PressableScale onPress={() => navigation.navigate('CasesTab')} hitSlop={8} style={styles.viewAllButton}>
                <Text style={[styles.viewAllLink, { color: palette.primary }]}>View all</Text>
              </PressableScale>
            </View>

            {loading ? (
              <View style={[styles.skeleton, { backgroundColor: palette.surfaceMuted }]} />
            ) : loadError ? (
              <AlertMessage variant="error" title="We couldn't load your cases" message="Please check your connection and try again." onRetry={load} />
            ) : recentCase ? (
              <CaseSummaryCard caseReport={recentCase} onPress={() => navigation.navigate('CaseDetail', { caseId: recentCase.case_id })} />
            ) : (
              <EmptyCaseCard onReport={goToReportIncident} />
            )}
          </FadeInUp>

          {/* Privacy indicator */}
          <FadeInUp reduced={reduced} delay={300} style={{ alignItems: 'center', marginTop: spacing.xl }}>
            <Pressable onPress={() => navigation.navigate('Profile')} accessibilityRole="button" accessibilityLabel="Privacy and security">
              <ClaySurface radius={18} tint={palette.primaryLight} shadowTint={palette.primaryDark} intensity="sm" style={undefined} innerStyle={styles.privacyPillInner} highlightOpacity={0.2}>
                <Ionicons name="lock-closed" size={13} color={palette.primaryDark} />
                <Text style={[styles.privacyPillText, { color: palette.primaryDark }]}>Your information is protected</Text>
              </ClaySurface>
            </Pressable>
          </FadeInUp>
        </View>
      </ScrollView>

      <SosConfirmSheet
        visible={showSosConfirm}
        onClose={() => setShowSosConfirm(false)}
        profileId={profile?.profile_id}
        onActivated={() => {
          setShowSosConfirm(false);
          navigation.navigate('SosTab');
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 24,
    paddingBottom: spacing.sm,
    gap: spacing.sm,
  },
  content: { paddingHorizontal: 24 },
  offlineBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderRadius: radius.md,
    paddingVertical: 8,
    paddingHorizontal: spacing.sm,
    marginTop: spacing.sm,
  },
  offlineTitle: { ...typography.bodyMedium, fontSize: 12.5 },
  offlineBody: { ...typography.caption, fontSize: 11, marginTop: 1 },
  greeting: { ...typography.display, fontSize: 27, lineHeight: 33, marginTop: spacing.md },
  subtitle: { ...typography.body, fontSize: 15, marginTop: spacing.sm, marginBottom: 20 },

  sosCardShadow: { borderRadius: 24, marginBottom: 24 },
  sosCardInner: { height: 112, paddingHorizontal: spacing.lg, alignItems: 'center', justifyContent: 'center' },
  sosIconWrap: { width: 46, height: 46, alignItems: 'center', justifyContent: 'center', marginBottom: 6 },
  sosIconGlow: { position: 'absolute', width: 46, height: 46, borderRadius: 23, backgroundColor: 'rgba(255,255,255,0.6)' },
  sosIconCircle: { width: 40, height: 40, borderRadius: 20, backgroundColor: 'rgba(255,255,255,0.2)', alignItems: 'center', justifyContent: 'center' },
  sosTitle: { ...typography.heading, fontSize: 18, color: '#FFFFFF' },
  sosSubtitle: { ...typography.caption, fontSize: 12.5, color: 'rgba(255,255,255,0.88)', marginTop: 2 },

  sectionTitle: { ...typography.heading, fontSize: 20 },
  sectionHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginTop: 28,
    marginBottom: 12,
  },
  viewAllButton: { paddingVertical: 4, paddingHorizontal: 4 },
  viewAllLink: { ...typography.bodyMedium },
  actionsGrid: { marginTop: 12, gap: spacing.md },
  actionsRow: { flexDirection: 'row', gap: spacing.md },
  skeleton: { height: 96, borderRadius: radius.lg },

  privacyPillInner: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14, paddingVertical: 9 },
  privacyPillText: { ...typography.caption, fontSize: 12, marginLeft: 6, fontFamily: 'Inter_500Medium' as any },
});

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useToast } from '../contexts/ToastContext';
import { supabase } from '../lib/supabase';
import { useAutoRefresh } from './useAutoRefresh';
import type { ReferralStatus, ShelterReferral, ShelterRequest, ShelterRequestStatus } from '../types/database.types';

export type ReferralRow = ShelterReferral & { case_reports?: { case_number: string } | null };

// Only ONE of these is ever set — a union discriminated by which table the
// selected inbox row came from, so one detail modal can render either
// shape without the two request/referral types needing to be merged into
// one artificial schema. Shared with ShelterAdminDashboard's review modal
// and ShelterRequestsReferralsPage's.
export type SelectedShelterItem = { kind: 'request'; row: ShelterRequest } | { kind: 'referral'; row: ReferralRow };

// A single normalized shape purely for the unified table/filters/search —
// the underlying request/referral rows (and their very different status
// vocabularies) are never actually merged, just projected into this for
// display. `item` always carries the real row back for actions.
export interface PipelineItem {
  key: string;
  source: 'request' | 'referral';
  displayId: string;
  title: string;
  priority: string;
  receivedAt: string;
  statusLabel: string;
  isTerminal: boolean;
  isPending: boolean;
  isAccepted: boolean;
  isActive: boolean;
  item: SelectedShelterItem;
}

const REQUEST_TERMINAL: ShelterRequestStatus[] = ['Declined', 'Cancelled', 'Completed'];
const REFERRAL_TERMINAL: ReferralStatus[] = ['Declined', 'Completed'];
export const HIGH_PRIORITY_URGENCY = ['Urgent', 'Emergency'];

/**
 * The shared fetch/derive/mutate layer behind every shelter_admin page
 * (Dashboard, Occupancy & Placement, Requests & Referrals) — extracted
 * from what used to be one large ShelterAdminDashboard.tsx so splitting
 * it into dedicated navigation pages (master prompt: "Separate SafeSpace
 * Shelter Administrator Functions into Dedicated Navigation Pages")
 * doesn't mean three independent copies of the same queries/derivations
 * that could silently drift apart. Every query here is scoped by
 * profile.shelter_id; RLS (module4_shelter_admin.sql) enforces the same
 * boundary server-side regardless of what any consuming page does or
 * doesn't filter client-side.
 */
export function useShelterAdminData() {
  const { profile, shelter, refreshProfile } = useAuth();
  const { showToast } = useToast();
  const [requests, setRequests] = useState<ShelterRequest[]>([]);
  const [referrals, setReferrals] = useState<ReferralRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<number | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const load = useCallback(
    async (isRefresh: boolean = false) => {
      if (!profile?.shelter_id) return;
      if (isRefresh) setRefreshing(true);
      setLoadError(null);
      const [reqRes, refRes] = await Promise.all([
        supabase.from('shelter_requests').select('*').eq('shelter_id', profile.shelter_id).order('created_at', { ascending: false }),
        supabase
          .from('shelter_referrals')
          .select('*, case_reports(case_number)')
          .eq('shelter_id', profile.shelter_id)
          .order('referred_at', { ascending: false }),
      ]);
      if (reqRes.error || refRes.error) {
        setLoadError('Some shelter data failed to load. You can retry below.');
      }
      setRequests(reqRes.data ?? []);
      setReferrals((refRes.data as ReferralRow[] | null) ?? []);
      setLoading(false);
      setRefreshing(false);
      setLastUpdated(Date.now());
    },
    [profile?.shelter_id]
  );

  useEffect(() => {
    load();
  }, [load]);

  // No realtime subscription exists here (unlike ShelterStaff/
  // SupportExpert/LawEnforcement's own hooks), so this 60s poll is the
  // primary sync mechanism for every page using this hook, not a fallback.
  useAutoRefresh(() => load(true));

  const pipelineItems: PipelineItem[] = useMemo(() => {
    const fromRequests: PipelineItem[] = requests.map((r) => ({
      key: `req-${r.request_id}`,
      source: 'request',
      displayId: `SH-${r.request_id.slice(0, 6).toUpperCase()}`,
      title: r.contact_name,
      priority: r.urgency,
      receivedAt: r.created_at,
      statusLabel: r.status,
      isTerminal: REQUEST_TERMINAL.includes(r.status),
      isPending: r.status === 'Submitted',
      isAccepted: r.status === 'Accepted',
      isActive: r.status === 'Accepted' || r.status === 'Placement Confirmed',
      item: { kind: 'request', row: r },
    }));
    const fromReferrals: PipelineItem[] = referrals.map((r) => ({
      key: `ref-${r.referral_id}`,
      source: 'referral',
      displayId: `RF-${r.referral_id.slice(0, 6).toUpperCase()}`,
      title: r.case_reports?.case_number ?? 'Case referral',
      priority: 'Normal',
      receivedAt: r.referred_at,
      statusLabel: r.referral_status,
      isTerminal: REFERRAL_TERMINAL.includes(r.referral_status),
      isPending: r.referral_status === 'Pending',
      isAccepted: r.referral_status === 'Accepted',
      isActive: r.referral_status === 'Accepted',
      item: { kind: 'referral', row: r },
    }));
    return [...fromRequests, ...fromReferrals].sort((a, b) => new Date(b.receivedAt).getTime() - new Date(a.receivedAt).getTime());
  }, [requests, referrals]);

  const stats = useMemo(() => {
    const pendingRequests = requests.filter((r) => r.status === 'Submitted').length;
    const pendingReferrals = referrals.filter((r) => r.referral_status === 'Pending').length;
    const awaitingReview = requests.filter((r) => r.status === 'Under Review' || r.status === 'Awaiting Information').length;
    // Direct requests only — "Accepted" there means approved in principle,
    // distinct from "Placement Confirmed" (the survivor is actually
    // physically present, the only status that increments
    // current_occupancy — see bumpOccupancy below). Referrals have no
    // equivalent distinction: their 'Accepted' already bumps occupancy
    // immediately (unchanged existing behavior), so they belong with
    // activePlacements below, not this "still waiting to be placed" count.
    const acceptedAwaitingPlacement = requests.filter((r) => r.status === 'Accepted').length;
    const activePlacements = requests.filter((r) => r.status === 'Placement Confirmed').length;
    const availableCapacity = shelter ? Math.max(0, (shelter.capacity ?? 0) - (shelter.current_occupancy ?? 0)) : 0;
    const occupancyRate = shelter?.capacity ? Math.round(((shelter.current_occupancy ?? 0) / shelter.capacity) * 100) : 0;
    const isOverCapacity = !!shelter?.capacity && (shelter.current_occupancy ?? 0) > shelter.capacity;
    return { pendingRequests, pendingReferrals, awaitingReview, acceptedAwaitingPlacement, activePlacements, availableCapacity, occupancyRate, isOverCapacity };
  }, [requests, referrals, shelter]);

  const pipelineStages = useMemo(
    () => [
      { label: 'New', count: requests.filter((r) => r.status === 'Submitted').length },
      { label: 'Under Review', count: requests.filter((r) => r.status === 'Under Review' || r.status === 'Awaiting Information').length },
      { label: 'Accepted', count: requests.filter((r) => r.status === 'Accepted').length },
      { label: 'Placement', count: requests.filter((r) => r.status === 'Placement Confirmed').length },
      { label: 'Completed', count: requests.filter((r) => r.status === 'Completed').length },
    ],
    [requests]
  );

  const needsAttention = useMemo(() => {
    return pipelineItems.filter((i) => !i.isTerminal && (i.isPending || HIGH_PRIORITY_URGENCY.includes(i.priority))).slice(0, 5);
  }, [pipelineItems]);

  // Bumps current_occupancy — matches the existing, unmodified
  // ShelterReferralPage.tsx behavior for referrals (increments on
  // 'Accepted'). For direct requests, the richer status set lets us wait
  // for the more precise 'Placement Confirmed' state instead, so
  // "approved in principle" is never conflated with "physically here".
  // This remains the ONLY existing occupancy-changing mechanism — there
  // is no separate "discharge" workflow in the current schema; decrements
  // go through the same manual capacity/occupancy edit on the Occupancy
  // & Placement page (see ShelterOccupancyPage.tsx), not invented here.
  const bumpOccupancy = async (delta: number) => {
    if (!shelter) return;
    await supabase
      .from('shelters')
      .update({ current_occupancy: Math.max(0, shelter.current_occupancy + delta) })
      .eq('shelter_id', shelter.shelter_id);
    await refreshProfile();
  };

  const updateRequestStatus = async (row: ShelterRequest, status: ShelterRequestStatus, decisionNotes: string) => {
    if (!profile) return false;
    await supabase
      .from('shelter_requests')
      .update({
        status,
        reviewed_by: profile.profile_id,
        reviewed_at: new Date().toISOString(),
        review_notes: decisionNotes || row.review_notes,
      })
      .eq('request_id', row.request_id);

    if (status === 'Placement Confirmed') await bumpOccupancy(1);

    const NOTICE: Partial<Record<ShelterRequestStatus, { title: string; message: string }>> = {
      'Under Review': { title: 'Your shelter request is under review', message: `${shelter?.shelter_name ?? 'The shelter'} is reviewing your request.` },
      'Awaiting Information': { title: 'More information needed', message: decisionNotes || 'The shelter has requested more information about your request.' },
      Accepted: { title: 'Your shelter request was accepted', message: `${shelter?.shelter_name ?? 'The shelter'} has accepted your request. They will confirm your placement soon.` },
      Declined: { title: 'Your shelter request was declined', message: decisionNotes || 'This shelter is unable to accommodate your request right now.' },
      'Placement Confirmed': { title: 'Your shelter placement is confirmed', message: `Your placement at ${shelter?.shelter_name ?? 'the shelter'} has been confirmed.` },
      Completed: { title: 'Shelter placement completed', message: 'Your shelter placement has been marked as completed.' },
    };
    const notice = NOTICE[status];
    if (notice) {
      await supabase.from('notifications').insert({
        profile_id: row.profile_id,
        notification_type: 'Referral',
        title: notice.title,
        message: notice.message,
        is_read: false,
      });
    }

    load();
    showToast('success', `Request marked ${status}.`);
    return true;
  };

  // NOTE: unlike updateRequestStatus above, this does not send the
  // survivor a notification — shelter_referrals only stores case_id, not
  // the survivor's profile_id (see module4_shelter_admin.sql's design
  // notes on data minimization).
  const updateReferralStatus = async (row: ReferralRow, status: ReferralStatus, decisionNotes: string) => {
    await supabase.from('shelter_referrals').update({ referral_status: status, notes: decisionNotes || row.notes }).eq('referral_id', row.referral_id);
    if (status === 'Accepted') await bumpOccupancy(1);
    load();
    showToast('success', `Referral marked ${status}.`);
    return true;
  };

  return {
    profile,
    shelter,
    refreshProfile,
    requests,
    referrals,
    loading,
    refreshing,
    lastUpdated,
    loadError,
    reload: load,
    pipelineItems,
    stats,
    pipelineStages,
    needsAttention,
    updateRequestStatus,
    updateReferralStatus,
  };
}

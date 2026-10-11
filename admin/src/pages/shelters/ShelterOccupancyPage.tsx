import React, { useEffect, useState } from 'react';
import { Clock, Home, Percent, Users } from 'lucide-react';
import { useToast } from '../../contexts/ToastContext';
import { supabase } from '../../lib/supabase';
import { AnimatedNumber } from '../../components/AnimatedNumber';
import { EmptyState, Modal, PageHeader } from '../../components/ui';
import { DashboardHeaderActions } from '../../components/dashboard/DashboardHeaderActions';
import { useShelterAdminData } from '../../hooks/useShelterAdminData';

// Occupancy & Placement (master prompt) — detailed capacity/placement
// view moved out of the Dashboard. "Accepted" (approved in principle)
// and "Placement Confirmed" (survivor physically present, the only
// request status that increments current_occupancy) are kept as
// genuinely distinct numbers per the brief's "separate accepted requests
// from confirmed admissions" — not merged into one "active" figure.
// There is no dedicated "discharge" workflow in the existing schema (no
// status/action decrements current_occupancy anywhere); the only
// existing mechanism to correct it is the same direct capacity/occupancy
// edit this page exposes, unchanged from what the old combined "Manage
// Shelter" modal already did.
export function ShelterOccupancyPage() {
  const { showToast } = useToast();
  const { profile, shelter, refreshProfile, requests, loading, refreshing, lastUpdated, loadError, reload, stats, pipelineStages } = useShelterAdminData();

  const [form, setForm] = useState({ capacity: '', current_occupancy: '' });
  const [editOpen, setEditOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!shelter) return;
    setForm({ capacity: String(shelter.capacity ?? ''), current_occupancy: String(shelter.current_occupancy ?? 0) });
  }, [shelter]);

  const submit = async () => {
    if (!shelter) return;
    setSaving(true);
    const { error } = await supabase
      .from('shelters')
      .update({ capacity: form.capacity ? Number(form.capacity) : null, current_occupancy: Number(form.current_occupancy) || 0 })
      .eq('shelter_id', shelter.shelter_id);
    await refreshProfile();
    setSaving(false);
    if (error) {
      showToast('error', 'Could not save capacity.');
      return;
    }
    setEditOpen(false);
    showToast('success', 'Capacity updated.');
  };

  if (!profile?.shelter_id) {
    return (
      <div>
        <PageHeader title="Occupancy & Placement" />
        <EmptyState title="No shelter assigned" subtitle="Contact your provincial administrator to have a shelter assigned to your account." />
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        title="Occupancy & Placement"
        subtitle={shelter?.shelter_name}
        actions={<DashboardHeaderActions lastUpdated={lastUpdated} refreshing={refreshing} onRefresh={() => reload(true)} />}
      />

      {loadError && (
        <div className="card" style={{ marginBottom: 20, borderColor: 'var(--color-danger)' }}>
          <p style={{ color: 'var(--color-danger)', fontSize: 13, marginBottom: 8 }}>{loadError}</p>
          <button className="btn btn-outline btn-sm" onClick={() => reload()}>
            Retry
          </button>
        </div>
      )}

      <div className="dash-kpi-grid" style={{ gridTemplateColumns: 'repeat(4, 1fr)', marginBottom: 20 }}>
        {loading ? (
          Array.from({ length: 4 }).map((_, i) => <KpiSkeletonCard key={i} />)
        ) : (
          <>
            <KpiCard icon={Home} label="Available Capacity" value={stats.availableCapacity} context={`of ${shelter?.capacity ?? '—'} total`} color="var(--color-success)" tint="var(--kpi-tint-success)" iconBg="var(--kpi-icon-success)" />
            <KpiCard icon={Percent} label="Occupancy Rate" value={stats.occupancyRate} context="Of total capacity" color="var(--color-primary-dark)" tint="var(--kpi-tint-primary)" iconBg="var(--kpi-icon-primary)" formatter={(n) => `${n}%`} />
            <KpiCard icon={Clock} label="Accepted — Awaiting Placement" value={stats.acceptedAwaitingPlacement} context="Approved, not yet physically admitted" color="var(--color-info)" tint="var(--kpi-tint-info)" iconBg="var(--kpi-icon-info)" />
            <KpiCard icon={Users} label="Active Placements" value={stats.activePlacements} context="Currently housed" color="var(--color-primary)" tint="var(--kpi-tint-primary)" iconBg="var(--kpi-icon-primary)" />
          </>
        )}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20, alignItems: 'start' }}>
        <div className="card">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
            <h3 style={{ margin: 0 }}>Occupancy</h3>
            <button className="btn btn-outline btn-sm" onClick={() => setEditOpen(true)}>
              Edit capacity
            </button>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 8 }}>
            <span style={{ fontSize: 22, fontWeight: 700 }}>
              {shelter?.current_occupancy ?? 0} / {shelter?.capacity ?? '—'}
            </span>
            <span style={{ fontSize: 13, color: 'var(--color-text-muted)' }}>{stats.occupancyRate}% occupied</span>
          </div>
          <div style={{ height: 8, borderRadius: 4, background: 'var(--color-surface-muted)', overflow: 'hidden' }}>
            <div
              style={{
                height: '100%',
                width: `${Math.min(100, stats.occupancyRate)}%`,
                background: stats.occupancyRate >= 90 ? 'var(--color-danger)' : 'var(--color-primary)',
                transition: 'width 200ms ease',
              }}
            />
          </div>
          <p style={{ fontSize: 12, color: 'var(--color-text-muted)', marginTop: 8 }}>Available: {stats.availableCapacity}</p>
          {stats.isOverCapacity && (
            <p style={{ fontSize: 12, color: 'var(--color-danger)', marginTop: 4, fontWeight: 600 }}>
              Occupancy exceeds configured capacity — review the shelter's recorded capacity or occupancy.
            </p>
          )}
          <p style={{ fontSize: 12, color: 'var(--color-text-muted)', marginTop: 10 }}>
            Occupancy changes automatically when a request reaches Placement Confirmed, or a referral is Accepted.
            There is no separate discharge action yet — correct the count directly here when a resident leaves.
          </p>
        </div>

        <div className="card">
          <h3 style={{ marginBottom: 14 }}>Request Pipeline</h3>
          <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 4 }}>
            {pipelineStages.map((stage, idx) => (
              <React.Fragment key={stage.label}>
                <div style={{ textAlign: 'center', minWidth: 84 }}>
                  <div style={{ fontSize: 20, fontWeight: 700 }}>{loading ? '–' : stage.count}</div>
                  <div style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>{stage.label}</div>
                </div>
                {idx < pipelineStages.length - 1 && <span style={{ color: 'var(--color-border)', fontSize: 18, padding: '0 4px' }}>→</span>}
              </React.Fragment>
            ))}
          </div>
          <p style={{ fontSize: 12, color: 'var(--color-text-muted)', marginTop: 14 }}>
            {requests.length} direct survivor request{requests.length === 1 ? '' : 's'} total. Full queue and actions are
            on the Requests &amp; Referrals page.
          </p>
        </div>
      </div>

      {editOpen && (
        <Modal
          title="Edit capacity"
          onClose={() => setEditOpen(false)}
          footer={
            <>
              <button className="btn btn-outline" onClick={() => setEditOpen(false)} disabled={saving}>
                Cancel
              </button>
              <button className="btn btn-primary" onClick={submit} disabled={saving}>
                {saving ? 'Saving...' : 'Save changes'}
              </button>
            </>
          }
        >
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
            <div className="field">
              <label className="label">Capacity</label>
              <input className="input" type="number" min={0} value={form.capacity} onChange={(e) => setForm((f) => ({ ...f, capacity: e.target.value }))} />
            </div>
            <div className="field">
              <label className="label">Current occupancy</label>
              <input className="input" type="number" min={0} value={form.current_occupancy} onChange={(e) => setForm((f) => ({ ...f, current_occupancy: e.target.value }))} />
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}

function KpiCard({
  icon: Icon,
  label,
  value,
  context,
  color,
  tint,
  iconBg,
  formatter,
}: {
  icon: React.ElementType;
  label: string;
  value: number;
  context: string;
  color: string;
  tint: string;
  iconBg: string;
  formatter?: (n: number) => string;
}) {
  return (
    <div className="dash-kpi-card" style={{ ['--kpi-tint' as string]: tint, ['--kpi-accent' as string]: color }}>
      <div className="dash-kpi-icon" style={{ background: iconBg, color }}>
        <Icon size={17} strokeWidth={2} />
      </div>
      <span className="dash-kpi-label">{label}</span>
      <span className="dash-kpi-value" style={{ color }}>
        <AnimatedNumber value={value} formatter={formatter} />
      </span>
      <span className="dash-kpi-context">{context}</span>
    </div>
  );
}

function KpiSkeletonCard() {
  return (
    <div className="dash-kpi-card">
      <div className="skeleton skeleton-circle" style={{ width: 32, height: 32 }} />
      <div className="skeleton skeleton-text" style={{ width: '60%' }} />
      <div className="skeleton skeleton-text" style={{ width: 48, height: 24 }} />
      <div className="skeleton skeleton-text" style={{ width: '80%' }} />
    </div>
  );
}

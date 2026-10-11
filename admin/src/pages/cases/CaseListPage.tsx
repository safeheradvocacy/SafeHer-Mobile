import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { supabase } from '../../lib/supabase';
import { EmptyState, LoadingRow, PageHeader, StatusBadge } from '../../components/ui';
import { WalkInCaseModal } from '../../components/cases/WalkInCaseModal';
import { DashboardHeaderActions } from '../../components/dashboard/DashboardHeaderActions';
import { useHeaderRefresh } from '../../hooks/useHeaderRefresh';
import type { CaseReport, CaseStatus, CaseType, Municipality, PriorityLevel } from '../../types/database.types';

const STATUSES: CaseStatus[] = ['Pending', 'Under Review', 'Assigned', 'In Progress', 'Referred', 'Resolved', 'Closed'];
const TYPES: CaseType[] = ['Physical Abuse', 'Psychological Abuse', 'Sexual Abuse', 'Economic Abuse', 'Stalking', 'Neglect', 'Others'];
const PRIORITIES: PriorityLevel[] = ['Low', 'Medium', 'High', 'Critical'];

export function CaseListPage() {
  const { profile, roleTier } = useAuth();
  const navigate = useNavigate();
  const isProvincial = roleTier === 'province';

  const [cases, setCases] = useState<CaseReport[]>([]);
  const [municipalities, setMunicipalities] = useState<Municipality[]>([]);
  const [loading, setLoading] = useState(true);
  const [showWalkInModal, setShowWalkInModal] = useState(false);

  // Seeded from the Provincial Dashboard's global search bar (?q=...),
  // if that's how this page was reached — read once on mount, not kept
  // in sync afterward, so the user's own edits to the field aren't
  // fought by the URL.
  const [searchParams] = useSearchParams();
  const [search, setSearch] = useState(() => searchParams.get('q') ?? '');
  const [statusFilter, setStatusFilter] = useState(() => {
    const s = searchParams.get('status');
    return s && STATUSES.includes(s as CaseStatus) ? s : '';
  });
  const [typeFilter, setTypeFilter] = useState('');
  const [priorityFilter, setPriorityFilter] = useState('');
  const [municipalityFilter, setMunicipalityFilter] = useState('');
  const [sourceFilter, setSourceFilter] = useState('');
  const [sortDesc, setSortDesc] = useState(true);

  const load = useCallback(async () => {
    if (isProvincial) {
      const { data } = await supabase.from('municipalities').select('*').eq('is_active', true).order('municipality_name');
      setMunicipalities(data ?? []);
    }

    let query = supabase.from('case_reports').select('*');
    if (!isProvincial && profile?.municipality_id) {
      query = query.eq('municipality_id', profile.municipality_id);
    }
    const { data } = await query.order('reported_at', { ascending: false });
    setCases(data ?? []);
    setLoading(false);
  }, [isProvincial, profile?.municipality_id]);

  useEffect(() => {
    load();
  }, [load]);

  const { refreshing, lastUpdated, onRefresh } = useHeaderRefresh(loading, load);

  const filtered = useMemo(() => {
    let rows = cases;
    if (search) {
      const q = search.toLowerCase();
      rows = rows.filter((c) => c.case_number.toLowerCase().includes(q) || c.incident_location.toLowerCase().includes(q));
    }
    if (statusFilter) rows = rows.filter((c) => c.status === statusFilter);
    if (typeFilter) rows = rows.filter((c) => c.case_type === typeFilter);
    if (priorityFilter) rows = rows.filter((c) => c.priority_level === priorityFilter);
    if (municipalityFilter) rows = rows.filter((c) => c.municipality_id === municipalityFilter);
    if (sourceFilter) rows = rows.filter((c) => c.source_channel === sourceFilter);
    rows = [...rows].sort((a, b) =>
      sortDesc ? +new Date(b.reported_at) - +new Date(a.reported_at) : +new Date(a.reported_at) - +new Date(b.reported_at)
    );
    return rows;
  }, [cases, search, statusFilter, typeFilter, priorityFilter, municipalityFilter, sourceFilter, sortDesc]);

  const municipalityName = (id: string) => municipalities.find((m) => m.municipality_id === id)?.municipality_name ?? '—';

  return (
    <div>
      <PageHeader title={isProvincial ? 'Province-Wide Case Management' : 'Case Management'} />

      {/* One full-width toolbar row, sibling to PageHeader rather than nested
          inside its actions slot: that slot shrink-wraps to its content and
          pins it to the right (see the marginLeft:'auto' fix in ui.tsx), so it
          can't host two independently-anchored ends. A plain block-level div
          here takes the page's full width, letting justify-content:space-between
          anchor the walk-in button at the start and the shared Search/Live/
          Refresh/Bell/Profile group at the end of the SAME row. */}
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 16 }}>
        <button className="btn btn-primary" onClick={() => setShowWalkInModal(true)}>
          + New Walk-In Case
        </button>
        <DashboardHeaderActions showSearch lastUpdated={lastUpdated} refreshing={refreshing} onRefresh={onRefresh} />
      </div>

      {showWalkInModal && (
        <WalkInCaseModal
          onClose={() => setShowWalkInModal(false)}
          onCreated={(caseId) => {
            setShowWalkInModal(false);
            navigate(`/admin/cases/${caseId}`);
          }}
        />
      )}

      <div className="card" style={{ marginBottom: 16, display: 'flex', flexWrap: 'wrap', gap: 12 }}>
        <input
          className="input"
          style={{ flex: '1 1 200px' }}
          placeholder="Search by case # or location"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <select className="input" style={{ width: 170 }} value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
          <option value="">All statuses</option>
          {STATUSES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
        <select className="input" style={{ width: 190 }} value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)}>
          <option value="">All case types</option>
          {TYPES.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
        <select className="input" style={{ width: 150 }} value={priorityFilter} onChange={(e) => setPriorityFilter(e.target.value)}>
          <option value="">All priorities</option>
          {PRIORITIES.map((p) => (
            <option key={p} value={p}>
              {p}
            </option>
          ))}
        </select>
        <select className="input" style={{ width: 150 }} value={sourceFilter} onChange={(e) => setSourceFilter(e.target.value)}>
          <option value="">All sources</option>
          <option value="Mobile">Mobile</option>
          <option value="Walk-In">Walk-In</option>
        </select>
        {isProvincial && (
          <select className="input" style={{ width: 180 }} value={municipalityFilter} onChange={(e) => setMunicipalityFilter(e.target.value)}>
            <option value="">All municipalities</option>
            {municipalities.map((m) => (
              <option key={m.municipality_id} value={m.municipality_id}>
                {m.municipality_name}
              </option>
            ))}
          </select>
        )}
        <button className="btn btn-outline btn-sm" onClick={() => setSortDesc((s) => !s)}>
          {sortDesc ? 'Newest first' : 'Oldest first'}
        </button>
      </div>

      <div className="card">
        <table>
          <thead>
            <tr>
              <th>Case #</th>
              <th>Type</th>
              <th>Source</th>
              {isProvincial && <th>Municipality</th>}
              <th>Priority</th>
              <th>Status</th>
              <th>Reported</th>
            </tr>
          </thead>
          <tbody>
            {loading && <LoadingRow colSpan={isProvincial ? 7 : 6} />}
            {!loading &&
              filtered.map((c) => (
                <tr key={c.case_id}>
                  <td>
                    <Link to={`/admin/cases/${c.case_id}`}>{c.case_number}</Link>
                  </td>
                  <td>{c.case_type}</td>
                  <td>
                    <StatusBadge label={c.source_channel} />
                  </td>
                  {isProvincial && <td>{municipalityName(c.municipality_id)}</td>}
                  <td>
                    <StatusBadge label={c.priority_level} />
                  </td>
                  <td>
                    <StatusBadge label={c.status} />
                  </td>
                  <td>{new Date(c.reported_at).toLocaleDateString()}</td>
                </tr>
              ))}
          </tbody>
        </table>
        {!loading && filtered.length === 0 && <EmptyState title="No cases match your filters" />}
      </div>
    </div>
  );
}

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ChevronDown, ChevronUp, Download, History, Search, ShieldAlert } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { PageHeader, EmptyState, StatusBadge } from '../../components/ui';
import { DashboardHeaderActions } from '../../components/dashboard/DashboardHeaderActions';
import { useHeaderRefresh } from '../../hooks/useHeaderRefresh';
import { downloadCsv } from '../../lib/exportCsv';
import {
  auditTitle,
  auditResource,
  maskedReference,
  resultLabel,
  fieldChanges,
  categorize,
  CATEGORY_LABEL,
  type AuditCategory,
} from '../../lib/auditPresentation';
import type { AuditLog } from '../../types/database.types';

const PAGE_SIZE = 25;
type DateRange = 'today' | '7d' | '30d' | 'all';

function rangeStart(range: DateRange): string | null {
  const now = new Date();
  if (range === 'today') {
    now.setHours(0, 0, 0, 0);
    return now.toISOString();
  }
  if (range === '7d') return new Date(Date.now() - 7 * 86_400_000).toISOString();
  if (range === '30d') return new Date(Date.now() - 30 * 86_400_000).toISOString();
  return null;
}

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

export function AuditLogPage() {
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [actorNames, setActorNames] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [limit, setLimit] = useState(PAGE_SIZE);
  const [hasMore, setHasMore] = useState(false);

  const [category, setCategory] = useState<AuditCategory>('all');
  const [dateRange, setDateRange] = useState<DateRange>('30d');
  const [actionFilter, setActionFilter] = useState('');
  const [actorFilter, setActorFilter] = useState('');
  const [search, setSearch] = useState('');
  const [expanded, setExpanded] = useState<string | null>(null);
  const [showTechnical, setShowTechnical] = useState<Record<string, boolean>>({});

  const load = useCallback(async (currentLimit: number, range: DateRange) => {
    setLoading(true);
    setError(false);

    let query = supabase.from('audit_logs').select('*', { count: 'exact' }).order('created_at', { ascending: false }).limit(currentLimit);
    const since = rangeStart(range);
    if (since) query = query.gte('created_at', since);

    const { data, error: err, count } = await query;

    if (err) {
      setError(true);
      setLoading(false);
      return;
    }

    setLogs(data ?? []);
    setHasMore((count ?? 0) > (data?.length ?? 0));

    const actorIds = Array.from(new Set((data ?? []).map((l) => l.profile_id).filter(Boolean)));
    if (actorIds.length > 0) {
      const { data: actors } = await supabase.from('user_profiles').select('profile_id, first_name, last_name').in('profile_id', actorIds);
      const names: Record<string, string> = {};
      (actors ?? []).forEach((a) => {
        names[a.profile_id] = `${a.first_name} ${a.last_name}`;
      });
      setActorNames(names);
    } else {
      setActorNames({});
    }

    setLoading(false);
  }, []);

  useEffect(() => {
    load(limit, dateRange);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [limit, dateRange]);

  // Real, distinct values only — never an invented full CRUD/action list.
  const availableActions = useMemo(() => Array.from(new Set(logs.map((l) => l.action))).sort(), [logs]);
  const availableActors = useMemo(() => {
    const ids = Array.from(new Set(logs.map((l) => l.profile_id).filter(Boolean)));
    return ids.map((id) => ({ id, name: actorNames[id] ?? 'Unknown' })).sort((a, b) => a.name.localeCompare(b.name));
  }, [logs, actorNames]);

  const filtered = useMemo(() => {
    let rows = logs;
    if (category !== 'all') rows = rows.filter((l) => categorize(l) === category);
    if (actionFilter) rows = rows.filter((l) => l.action === actionFilter);
    if (actorFilter) rows = rows.filter((l) => l.profile_id === actorFilter);
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      rows = rows.filter((l) => {
        const actor = (actorNames[l.profile_id] ?? 'System').toLowerCase();
        return (
          auditTitle(l).toLowerCase().includes(q) ||
          auditResource(l).toLowerCase().includes(q) ||
          actor.includes(q) ||
          maskedReference(l.record_id).toLowerCase().includes(q)
        );
      });
    }
    return rows;
  }, [logs, category, actionFilter, actorFilter, search, actorNames]);

  const exportCsv = () => {
    downloadCsv(
      `SafeSpace_Audit_Log_${new Date().toISOString().slice(0, 10)}.csv`,
      filtered.map((l) => ({
        title: auditTitle(l),
        actor: actorNames[l.profile_id] ?? 'System',
        resource: auditResource(l),
        reference: maskedReference(l.record_id),
        result: resultLabel(l),
        time: formatDateTime(l.created_at),
      })),
      [
        { key: 'title', label: 'Event' },
        { key: 'actor', label: 'Actor' },
        { key: 'resource', label: 'Resource' },
        { key: 'reference', label: 'Reference' },
        { key: 'result', label: 'Result' },
        { key: 'time', label: 'Time' },
      ]
    );
  };

  const { refreshing, lastUpdated, onRefresh } = useHeaderRefresh(loading, () => load(limit, dateRange));

  return (
    <div>
      <PageHeader
        title="Audit Log"
        subtitle="Province-wide record of administrator actions"
        actions={
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
            <button className="btn btn-outline btn-sm" onClick={exportCsv} disabled={filtered.length === 0}>
              <Download size={13} /> Export CSV
            </button>
            <DashboardHeaderActions lastUpdated={lastUpdated} refreshing={refreshing} onRefresh={onRefresh} />
          </div>
        }
      />

      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, background: 'var(--color-surface-muted)', borderRadius: 10, padding: 12, fontSize: 12.5, color: 'var(--color-text-muted)', marginBottom: 20 }}>
        <ShieldAlert size={15} style={{ flexShrink: 0, marginTop: 1 }} />
        This log reflects every action captured by SafeSpace's existing audit trigger across administrator, case, access,
        and backup activity. It is not append-only/immutable at the database level today — treat it as an activity
        record, not a tamper-evident compliance log. Values that could reveal a credential or token are always
        redacted, even under "Technical details".
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center' }}>
          <div style={{ position: 'relative', flex: '1 1 220px' }}>
            <Search size={14} style={{ position: 'absolute', left: 10, top: 10, color: 'var(--color-text-muted)' }} />
            <input
              className="input"
              style={{ paddingLeft: 30 }}
              placeholder="Search audit activity"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <select className="input" style={{ width: 150 }} value={dateRange} onChange={(e) => { setDateRange(e.target.value as DateRange); setLimit(PAGE_SIZE); }}>
            <option value="today">Today</option>
            <option value="7d">Last 7 days</option>
            <option value="30d">Last 30 days</option>
            <option value="all">All time</option>
          </select>
          <select className="input" style={{ width: 170 }} value={actionFilter} onChange={(e) => setActionFilter(e.target.value)}>
            <option value="">All actions</option>
            {availableActions.map((a) => (
              <option key={a} value={a}>{a.replace(/_/g, ' ')}</option>
            ))}
          </select>
          <select className="input" style={{ width: 190 }} value={actorFilter} onChange={(e) => setActorFilter(e.target.value)}>
            <option value="">All administrators</option>
            {availableActors.map((a) => (
              <option key={a.id} value={a.id}>{a.name}</option>
            ))}
          </select>
        </div>

        <div className="activity-filter-row" style={{ marginTop: 12 }}>
          {(Object.keys(CATEGORY_LABEL) as AuditCategory[]).map((c) => (
            <button key={c} type="button" className={`activity-filter-pill${category === c ? ' active' : ''}`} onClick={() => setCategory(c)}>
              {CATEGORY_LABEL[c]}
            </button>
          ))}
        </div>
      </div>

      <div className="card">
        {loading ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="skeleton skeleton-text" style={{ height: 40 }} />
            ))}
          </div>
        ) : error ? (
          <div className="dash-error-state" style={{ padding: '24px 0' }}>
            <p style={{ marginBottom: 12 }}>Unable to load the audit log.</p>
            <button className="btn btn-outline btn-sm" onClick={() => load(limit, dateRange)}>
              Try Again
            </button>
          </div>
        ) : filtered.length === 0 ? (
          <EmptyState title="No activity recorded" subtitle="No audit entries match this filter yet." />
        ) : (
          <>
            {filtered.map((log) => {
              const cat = categorize(log);
              const isOpen = expanded === log.log_id;
              const changes = fieldChanges(log.old_values, log.new_values);
              const hasDetail = changes.length > 0;
              const techOn = !!showTechnical[log.log_id];
              return (
                <div key={log.log_id}>
                  <div
                    className="activity-row"
                    style={hasDetail ? { cursor: 'pointer' } : undefined}
                    onClick={hasDetail ? () => setExpanded(isOpen ? null : log.log_id) : undefined}
                  >
                    <span
                      className="activity-row-icon"
                      style={{
                        background:
                          cat === 'security' ? 'var(--color-danger-tint)' : cat === 'accounts' ? 'var(--color-primary-tint)' : cat === 'cases' || cat === 'access' ? 'var(--color-info-tint)' : 'var(--color-surface-muted)',
                        color:
                          cat === 'security' ? 'var(--color-danger)' : cat === 'accounts' ? 'var(--color-primary)' : cat === 'cases' || cat === 'access' ? 'var(--color-info)' : 'var(--color-text-muted)',
                      }}
                    >
                      <History size={14} />
                    </span>
                    <div className="activity-row-main">
                      <div className="activity-row-title">{auditTitle(log)}</div>
                      <div className="activity-row-sub">
                        {actorNames[log.profile_id] ?? 'System'} · {auditResource(log)} · {maskedReference(log.record_id)} · {formatDateTime(log.created_at)}
                      </div>
                    </div>
                    <StatusBadge label={resultLabel(log)} />
                    {hasDetail && (isOpen ? <ChevronUp size={14} /> : <ChevronDown size={14} />)}
                  </div>
                  {isOpen && hasDetail && (
                    <div style={{ background: 'var(--color-surface-muted)', borderRadius: 8, padding: 12, marginBottom: 10, fontSize: 12.5 }}>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                        {changes.map((c) => (
                          <div key={c.field}>
                            <strong>{c.field}:</strong> {String(c.from)} → {String(c.to)}
                          </div>
                        ))}
                      </div>
                      <button
                        type="button"
                        className="btn btn-outline btn-sm"
                        style={{ marginTop: 10 }}
                        onClick={(e) => {
                          e.stopPropagation();
                          setShowTechnical((prev) => ({ ...prev, [log.log_id]: !prev[log.log_id] }));
                        }}
                      >
                        {techOn ? 'Hide technical details' : 'Show technical details'}
                      </button>
                      {techOn && (
                        <div style={{ marginTop: 8, fontFamily: 'monospace', color: 'var(--color-text-muted)' }}>
                          <div>
                            Action: {log.action} · Internal Resource: {log.table_name} · Record Reference:{' '}
                            {maskedReference(log.record_id)}
                          </div>
                          {/* Shown only when present. An absent IP is not
                              a gap: survivor-originated actions never
                              record one (module45), and neither do
                              scheduled jobs, which have no HTTP request. */}
                          {log.ip_address && (
                            <div style={{ marginTop: 4 }}>
                              Client IP: {log.ip_address}
                              {log.user_agent && (
                                <span title={log.user_agent}> · Agent: {log.user_agent.slice(0, 60)}
                                  {log.user_agent.length > 60 ? '…' : ''}
                                </span>
                              )}
                            </div>
                          )}
                          {log.ip_address && (
                            <div style={{ marginTop: 4, fontFamily: 'inherit', fontStyle: 'italic' }}>
                              Reported by the client via proxy header — not a verified source address.
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
            {hasMore && (
              <button type="button" className="btn btn-outline btn-sm" style={{ marginTop: 12 }} onClick={() => setLimit((l) => l + PAGE_SIZE)}>
                Load More
              </button>
            )}
          </>
        )}
      </div>
    </div>
  );
}

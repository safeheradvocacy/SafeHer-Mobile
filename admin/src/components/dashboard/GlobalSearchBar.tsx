import React, { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Search, X, Loader2, AlertTriangle } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import type { CaseReport } from '../../types/database.types';

type ResultRow = Pick<CaseReport, 'case_id' | 'case_number' | 'case_type' | 'status' | 'incident_location'>;

const DEBOUNCE_MS = 300;
const RESULT_LIMIT = 8;

/**
 * A real, scoped entry point (not decorative): live-queries case_reports
 * as the user types (module26 — previously this just navigated to
 * /admin/cases?q=... on Enter with no actual live results, loading, or
 * error state despite its own placeholder claiming "municipalities, SOS
 * alerts" search that never existed; the placeholder below has been
 * corrected to describe only what this component actually searches).
 *
 * Security: issues the exact same supabase.from('case_reports') query
 * the authorized destination page (CaseListPage/CaseDetailPage) already
 * uses — RLS (admin_can_access_case_active, see module2) is what
 * actually scopes results to the caller's own jurisdiction, never a
 * frontend filter on an unscoped fetch. Selected columns are
 * deliberately minimal (case number/type/status/incident location) —
 * no survivor name, address, or narrative in the dropdown.
 *
 * Only mounted on pages for a role that holds the cases.view
 * permission (see DashboardHeaderActions' showSearch prop and each
 * page's own hasPermission(...) check) — shelter/support/law-enforcement
 * roles have no case_reports RLS access at all, so this component is
 * never rendered for them.
 */
export function GlobalSearchBar() {
  const navigate = useNavigate();
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [results, setResults] = useState<ResultRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const requestIdRef = useRef(0);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setOpen(true);
        inputRef.current?.focus();
        inputRef.current?.select();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  useEffect(() => {
    if (!open) return;
    const onClickOutside = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onClickOutside);
    return () => document.removeEventListener('mousedown', onClickOutside);
  }, [open]);

  // Debounced live query — a stale/out-of-order response (a fast-typing
  // user whose earlier request resolves after a later one) is dropped
  // via requestIdRef rather than clobbering newer results.
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    const q = query.trim();
    if (!q) {
      setResults([]);
      setLoading(false);
      setError(false);
      return;
    }
    setLoading(true);
    setError(false);
    debounceRef.current = setTimeout(async () => {
      const reqId = ++requestIdRef.current;
      const { data, error: err } = await supabase
        .from('case_reports')
        .select('case_id,case_number,case_type,status,incident_location')
        .or(`case_number.ilike.%${q}%,incident_location.ilike.%${q}%`)
        .order('reported_at', { ascending: false })
        .limit(RESULT_LIMIT);
      if (reqId !== requestIdRef.current) return; // a newer request already landed
      if (err) {
        console.error('[GlobalSearchBar] search failed:', err.message);
        setError(true);
        setResults([]);
      } else {
        setResults((data as ResultRow[] | null) ?? []);
      }
      setLoading(false);
    }, DEBOUNCE_MS);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query]);

  const goToResult = (r: ResultRow) => {
    setOpen(false);
    setQuery('');
    navigate(`/admin/cases/${r.case_id}`);
  };

  const seeAllResults = () => {
    setOpen(false);
    navigate(`/admin/cases?q=${encodeURIComponent(query.trim())}`);
  };

  const showPanel = open && query.trim().length > 0;

  return (
    <div ref={wrapRef} className="dash-search-wrap">
      <Search size={15} className="dash-search-icon" aria-hidden="true" />
      <input
        ref={inputRef}
        type="text"
        className="dash-search-input"
        placeholder="Search by case # or location"
        value={query}
        onFocus={() => setOpen(true)}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && query.trim()) seeAllResults();
          if (e.key === 'Escape') {
            if (showPanel) {
              setOpen(false);
            } else {
              setQuery('');
              inputRef.current?.blur();
            }
          }
        }}
        role="combobox"
        aria-expanded={showPanel}
        aria-controls="global-search-results"
        aria-autocomplete="list"
        aria-label="Search cases by case number or incident location"
      />
      {query ? (
        <button type="button" className="dash-search-clear" onClick={() => { setQuery(''); setOpen(false); inputRef.current?.focus(); }} aria-label="Clear search">
          <X size={14} />
        </button>
      ) : (
        <kbd className="dash-search-kbd" aria-hidden="true">Ctrl K</kbd>
      )}

      {showPanel && (
        <div id="global-search-results" className="dash-search-results" role="listbox" aria-label="Search results">
          {loading ? (
            <div className="dash-search-state" role="status">
              <Loader2 size={14} className="spin" /> Searching…
            </div>
          ) : error ? (
            <div className="dash-search-state" role="alert">
              <AlertTriangle size={14} color="var(--color-danger)" /> Unable to search right now.
            </div>
          ) : results.length === 0 ? (
            <div className="dash-search-state">No matching cases found.</div>
          ) : (
            results.map((r) => (
              <button key={r.case_id} type="button" className="dash-search-item" role="option" aria-selected={false} onClick={() => goToResult(r)}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                  <strong style={{ fontSize: 13 }}>{r.case_number}</strong>
                  <span style={{ fontSize: 11.5, color: 'var(--color-text-muted)', flexShrink: 0 }}>{r.status}</span>
                </div>
                <div style={{ fontSize: 12, color: 'var(--color-text-muted)', marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {r.case_type} · {r.incident_location}
                </div>
              </button>
            ))
          )}
          {!loading && !error && (
            <button type="button" className="dash-search-seeall" onClick={seeAllResults}>
              See all results for "{query.trim()}" →
            </button>
          )}
        </div>
      )}
    </div>
  );
}

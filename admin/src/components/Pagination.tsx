import React from 'react';

/** Shared pagination control (Requirement 4) — current page, total
 * record count, previous/next, and a page-size selector. Every admin
 * list page that paginates server-side (via `.range()` + `{ count:
 * 'exact' }`) should use this one component rather than each inventing
 * its own prev/next buttons, so the control (and its behavior at the
 * first/last page, while loading, with zero results) is consistent
 * everywhere it appears. */
export function Pagination({
  page,
  pageSize,
  totalCount,
  onPageChange,
  onPageSizeChange,
  pageSizeOptions = [10, 25, 50, 100],
  loading = false,
}: {
  /** 0-indexed current page. */
  page: number;
  pageSize: number;
  totalCount: number;
  onPageChange: (page: number) => void;
  onPageSizeChange?: (size: number) => void;
  pageSizeOptions?: number[];
  loading?: boolean;
}) {
  const totalPages = Math.max(1, Math.ceil(totalCount / pageSize));
  const from = totalCount === 0 ? 0 : page * pageSize + 1;
  const to = Math.min(totalCount, (page + 1) * pageSize);
  const atFirst = page <= 0;
  const atLast = page >= totalPages - 1;

  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12, padding: '12px 0' }}>
      <div style={{ fontSize: 13, color: 'var(--color-text-muted)' }}>
        {totalCount === 0 ? 'No records' : `Showing ${from}–${to} of ${totalCount}`}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        {onPageSizeChange && (
          <select
            className="input"
            style={{ width: 'auto', fontSize: 13 }}
            value={pageSize}
            onChange={(e) => onPageSizeChange(Number(e.target.value))}
            aria-label="Rows per page"
            disabled={loading}
          >
            {pageSizeOptions.map((n) => (
              <option key={n} value={n}>
                {n} / page
              </option>
            ))}
          </select>
        )}
        <button className="btn btn-outline btn-sm" onClick={() => onPageChange(0)} disabled={atFirst || loading} aria-label="First page">
          «
        </button>
        <button className="btn btn-outline btn-sm" onClick={() => onPageChange(page - 1)} disabled={atFirst || loading} aria-label="Previous page">
          Previous
        </button>
        <span style={{ fontSize: 13, color: 'var(--color-text-muted)' }}>
          Page {page + 1} of {totalPages}
        </span>
        <button className="btn btn-outline btn-sm" onClick={() => onPageChange(page + 1)} disabled={atLast || loading} aria-label="Next page">
          Next
        </button>
        <button className="btn btn-outline btn-sm" onClick={() => onPageChange(totalPages - 1)} disabled={atLast || loading} aria-label="Last page">
          »
        </button>
      </div>
    </div>
  );
}

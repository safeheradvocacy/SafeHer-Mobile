import React, { useEffect, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { GlobalSearchBar } from './GlobalSearchBar';
import { NotificationBell } from './NotificationBell';
import { ProfileMenu } from './ProfileMenu';

export function formatRelativeTime(timestamp: number | null): string {
  if (!timestamp) return '';
  const seconds = Math.floor((Date.now() - timestamp) / 1000);
  if (seconds < 10) return 'Just now';
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ago`;
}

function RefreshButton({ refreshing, onRefresh }: { refreshing: boolean; onRefresh: () => void }) {
  return (
    <button
      type="button"
      className="dash-icon-btn tooltip-anchor"
      data-tooltip="Refresh data"
      onClick={() => !refreshing && onRefresh()}
      disabled={refreshing}
      aria-label="Refresh dashboard data"
    >
      <RefreshCw size={16} strokeWidth={2} className={refreshing ? 'icon-spin' : undefined} />
    </button>
  );
}

/**
 * "● Live · Updated Xm ago" — the one standardized live-data indicator
 * every dashboard shows (see useAutoRefresh, which is what actually
 * keeps the underlying data current every 60s). Owns its own 30s tick
 * purely to keep the relative-time text fresh — callers just pass the
 * timestamp, nothing re-fetches because of this component existing.
 * The dot's slow pulse is decorative only (communicates "this number
 * can change under you," not urgency) and is fully disabled under
 * prefers-reduced-motion via CSS.
 */
function LiveIndicator({ lastUpdated }: { lastUpdated: number | null }) {
  const [, forceTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => forceTick((t) => t + 1), 30_000);
    return () => clearInterval(id);
  }, []);
  if (!lastUpdated) return null;
  return (
    <span className="dash-live-indicator">
      <span className="dash-live-dot" aria-hidden="true" />
      Live · Updated {formatRelativeTime(lastUpdated)}
    </span>
  );
}

/**
 * The one standardized header-actions row every admin dashboard mounts
 * into its <PageHeader actions={...}> — this single component is what
 * actually guarantees "the same Search/Refresh/Notifications/Settings/
 * Profile/Live-indicator across all admin roles" rather than six pages
 * independently approximating it. Each page still owns its own
 * data-loading (`onRefresh`) and auto-refresh wiring (useAutoRefresh),
 * since those are inherently page-specific.
 */
export function DashboardHeaderActions({
  showSearch = false,
  lastUpdated,
  refreshing,
  onRefresh,
}: {
  /** Only roles with a cases list to search (province/municipality/
      barangay tiers) — see GlobalSearchBar's own header comment. */
  showSearch?: boolean;
  lastUpdated?: number | null;
  refreshing: boolean;
  onRefresh: () => void;
}) {
  return (
    <div className="dash-header-actions">
      {showSearch && <GlobalSearchBar />}
      <LiveIndicator lastUpdated={lastUpdated ?? null} />
      <RefreshButton refreshing={refreshing} onRefresh={onRefresh} />
      <NotificationBell />
      <ProfileMenu />
    </div>
  );
}

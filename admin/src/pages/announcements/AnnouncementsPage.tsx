import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { useToast } from '../../contexts/ToastContext';
import { supabase } from '../../lib/supabase';
import { ConfirmDialog, EmptyState, LoadingRow, PageHeader, StatusBadge } from '../../components/ui';
import { AnnouncementFormModal, type AnnouncementFormValues } from './AnnouncementFormModal';
import type { Announcement, AnnouncementCategory, AnnouncementPriority, AnnouncementStatus } from '../../types/database.types';

const STATUSES: AnnouncementStatus[] = ['Draft', 'Scheduled', 'Published', 'Expired', 'Archived', 'Unpublished'];
const CATEGORIES: AnnouncementCategory[] = [
  'General Announcement', 'Public Advisory', 'Service Update',
  'Program or Activity', 'Safety Information', 'Emergency Advisory', 'Other',
];

function toIsoOrNull(datetimeLocal: string): string | null {
  return datetimeLocal ? new Date(datetimeLocal).toISOString() : null;
}

/**
 * Provincial Announcements — Part B of the master prompt. Provincial
 * Staff only (route-guarded in App.tsx + RLS'd in module28); this page
 * never shows for provincial_admin/super_admin.
 *
 * Lifecycle status transitions (Publish Now / Unpublish / Archive /
 * Cancel Schedule) are row actions here, separate from the create/edit
 * form (AnnouncementFormModal) — editing content never silently
 * changes an already-live announcement's status. A successful toast
 * only ever fires after the Supabase call resolves with no error.
 */
export function AnnouncementsPage() {
  const { profile } = useAuth();
  const { showToast } = useToast();

  const [rows, setRows] = useState<Announcement[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('');
  const [priorityFilter, setPriorityFilter] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');

  const [formOpen, setFormOpen] = useState<{ mode: 'create' | 'edit'; announcement: Announcement | null } | null>(null);
  const [saving, setSaving] = useState(false);
  const [confirmAction, setConfirmAction] = useState<{ kind: 'publish-urgent' | 'unpublish'; row: Announcement } | null>(null);
  const [actingOn, setActingOn] = useState<string | null>(null);

  const load = useCallback(async () => {
    const { data, error } = await supabase.from('announcements').select('*').order('created_at', { ascending: false }).limit(300);
    if (error) {
      console.error('[AnnouncementsPage] load:', error.message);
      showToast('error', 'Could not load announcements.');
    }
    setRows(data ?? []);
    setLoading(false);
  }, [showToast]);

  useEffect(() => {
    load();
  }, [load]);

  const filtered = useMemo(() => {
    let out = rows;
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      out = out.filter((r) => r.title.toLowerCase().includes(q) || r.content.toLowerCase().includes(q));
    }
    if (statusFilter) out = out.filter((r) => r.status === statusFilter);
    if (categoryFilter) out = out.filter((r) => r.category === categoryFilter);
    if (priorityFilter) out = out.filter((r) => r.priority === priorityFilter);
    if (dateFrom) out = out.filter((r) => new Date(r.created_at) >= new Date(dateFrom));
    if (dateTo) out = out.filter((r) => new Date(r.created_at) <= new Date(dateTo + 'T23:59:59'));
    return out;
  }, [rows, search, statusFilter, categoryFilter, priorityFilter, dateFrom, dateTo]);

  const closeForm = () => setFormOpen(null);

  const persist = async (
    payload: Partial<Announcement>,
    announcementId: string | undefined,
    successMessage: string
  ) => {
    setSaving(true);
    if (announcementId) {
      const { error } = await supabase.from('announcements').update(payload).eq('announcement_id', announcementId);
      setSaving(false);
      if (error) {
        showToast('error', 'Could not save the announcement.');
        console.error('[AnnouncementsPage] update:', error.message);
        return;
      }
    } else {
      const { error } = await supabase.from('announcements').insert({ ...payload, author_id: profile?.profile_id });
      setSaving(false);
      if (error) {
        showToast('error', 'Could not create the announcement.');
        console.error('[AnnouncementsPage] insert:', error.message);
        return;
      }
    }
    showToast('success', successMessage);
    closeForm();
    load();
  };

  const contentFields = (v: AnnouncementFormValues) => ({
    title: v.title.trim(),
    summary: v.summary.trim() || null,
    content: v.content.trim(),
    category: v.category,
    priority: v.priority,
    external_link: v.externalLink.trim() || null,
    expires_at: toIsoOrNull(v.expiresAt),
  });

  const handleSaveDraft = (v: AnnouncementFormValues) =>
    persist({ ...contentFields(v), status: 'Draft', scheduled_at: null }, formOpen?.announcement?.announcement_id, 'Saved as draft.');

  const handlePublishNow = (v: AnnouncementFormValues) =>
    persist({ ...contentFields(v), status: 'Published', scheduled_at: null }, formOpen?.announcement?.announcement_id, 'Announcement published.');

  const handleSchedule = (v: AnnouncementFormValues) =>
    persist({ ...contentFields(v), status: 'Scheduled', scheduled_at: toIsoOrNull(v.scheduledAt) }, formOpen?.announcement?.announcement_id, 'Announcement scheduled.');

  const handleSaveChanges = (v: AnnouncementFormValues) => {
    const existing = formOpen?.announcement;
    const patch: Partial<Announcement> = { ...contentFields(v) };
    if (existing?.status === 'Scheduled') patch.scheduled_at = toIsoOrNull(v.scheduledAt);
    persist(patch, existing?.announcement_id, 'Changes saved.');
  };

  const runTransition = async (row: Announcement, status: AnnouncementStatus, message: string) => {
    setActingOn(row.announcement_id);
    const { error } = await supabase.from('announcements').update({ status }).eq('announcement_id', row.announcement_id);
    setActingOn(null);
    if (error) {
      showToast('error', 'Could not update the announcement.');
      console.error('[AnnouncementsPage] transition:', error.message);
      return;
    }
    showToast('success', message);
    load();
  };

  const requestPublish = (row: Announcement) => {
    if (row.priority === 'Urgent') {
      setConfirmAction({ kind: 'publish-urgent', row });
      return;
    }
    runTransition(row, 'Published', 'Announcement published.');
  };

  const requestUnpublish = (row: Announcement) => setConfirmAction({ kind: 'unpublish', row });

  return (
    <div>
      <PageHeader
        title="Provincial Announcements"
        subtitle="Create and manage announcements published to the SafeSpace mobile app."
        actions={
          <button className="btn btn-primary" onClick={() => setFormOpen({ mode: 'create', announcement: null })}>
            + Create Announcement
          </button>
        }
      />

      <div className="card" style={{ marginBottom: 16, display: 'flex', flexWrap: 'wrap', gap: 12 }}>
        <input
          className="input"
          style={{ flex: '1 1 220px' }}
          placeholder="Search by title or content"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <select className="input" style={{ width: 160 }} value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
          <option value="">All statuses</option>
          {STATUSES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
        <select className="input" style={{ width: 200 }} value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value)}>
          <option value="">All categories</option>
          {CATEGORIES.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
        <select className="input" style={{ width: 150 }} value={priorityFilter} onChange={(e) => setPriorityFilter(e.target.value as AnnouncementPriority | '')}>
          <option value="">All priorities</option>
          <option value="Normal">Normal</option>
          <option value="Important">Important</option>
          <option value="Urgent">Urgent</option>
        </select>
        <input className="input" type="date" style={{ width: 150 }} value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} title="Created from" />
        <input className="input" type="date" style={{ width: 150 }} value={dateTo} onChange={(e) => setDateTo(e.target.value)} title="Created to" />
      </div>

      <div className="card">
        <table>
          <thead>
            <tr>
              <th>Title</th>
              <th>Category</th>
              <th>Priority</th>
              <th>Author</th>
              <th>Created</th>
              <th>Published</th>
              <th>Expires</th>
              <th>Status</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading && <LoadingRow colSpan={9} />}
            {!loading &&
              filtered.map((a) => (
                <tr key={a.announcement_id}>
                  <td style={{ maxWidth: 260 }}>
                    <button
                      onClick={() => setFormOpen({ mode: 'edit', announcement: a })}
                      style={{ textAlign: 'left', background: 'none', border: 'none', padding: 0, color: 'var(--color-primary)', cursor: 'pointer', font: 'inherit' }}
                    >
                      {a.title}
                    </button>
                  </td>
                  <td>{a.category}</td>
                  <td>
                    <StatusBadge label={a.priority} />
                  </td>
                  <td>{a.author_id === profile?.profile_id ? 'You' : '—'}</td>
                  <td>{new Date(a.created_at).toLocaleDateString()}</td>
                  <td>{a.published_at ? new Date(a.published_at).toLocaleDateString() : '—'}</td>
                  <td>{a.expires_at ? new Date(a.expires_at).toLocaleDateString() : '—'}</td>
                  <td>
                    <StatusBadge label={a.status} />
                  </td>
                  <td>
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                      {(a.status === 'Draft' || a.status === 'Scheduled' || a.status === 'Unpublished' || a.status === 'Expired') && (
                        <button
                          className="btn btn-outline btn-sm"
                          disabled={actingOn === a.announcement_id}
                          onClick={() => requestPublish(a)}
                        >
                          Publish Now
                        </button>
                      )}
                      {a.status === 'Scheduled' && (
                        <button
                          className="btn btn-outline btn-sm"
                          disabled={actingOn === a.announcement_id}
                          onClick={() => runTransition(a, 'Draft', 'Schedule cancelled — moved back to draft.')}
                        >
                          Cancel Schedule
                        </button>
                      )}
                      {a.status === 'Published' && (
                        <button
                          className="btn btn-outline btn-sm"
                          disabled={actingOn === a.announcement_id}
                          onClick={() => requestUnpublish(a)}
                        >
                          Unpublish
                        </button>
                      )}
                      {a.status !== 'Archived' && (
                        <button
                          className="btn btn-outline btn-sm"
                          disabled={actingOn === a.announcement_id}
                          onClick={() => runTransition(a, 'Archived', 'Announcement archived.')}
                        >
                          Archive
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
          </tbody>
        </table>
        {!loading && filtered.length === 0 && (
          <EmptyState title="No announcements match your filters" subtitle="Create a new announcement to publish it to the SafeSpace mobile app." />
        )}
      </div>

      {formOpen && (
        <AnnouncementFormModal
          mode={formOpen.mode}
          initial={formOpen.announcement}
          saving={saving}
          onCancel={closeForm}
          onSaveDraft={handleSaveDraft}
          onPublishNow={handlePublishNow}
          onSchedule={handleSchedule}
          onSaveChanges={handleSaveChanges}
        />
      )}

      {confirmAction?.kind === 'publish-urgent' && (
        <ConfirmDialog
          title="Publish urgent advisory?"
          body={`"${confirmAction.row.title}" is marked Urgent. It will immediately notify every eligible mobile user. Continue?`}
          confirmLabel="Publish Now"
          onConfirm={() => {
            runTransition(confirmAction.row, 'Published', 'Urgent advisory published.');
            setConfirmAction(null);
          }}
          onCancel={() => setConfirmAction(null)}
        />
      )}
      {confirmAction?.kind === 'unpublish' && (
        <ConfirmDialog
          title="Unpublish this announcement?"
          body={`"${confirmAction.row.title}" will be removed from the active mobile feed immediately. It stays saved and can be published again later.`}
          confirmLabel="Unpublish"
          danger
          onConfirm={() => {
            runTransition(confirmAction.row, 'Unpublished', 'Announcement unpublished.');
            setConfirmAction(null);
          }}
          onCancel={() => setConfirmAction(null)}
        />
      )}
    </div>
  );
}

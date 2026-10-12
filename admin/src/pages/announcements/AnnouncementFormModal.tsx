import React, { useState } from 'react';
import { Modal, StatusBadge } from '../../components/ui';
import type { Announcement, AnnouncementCategory, AnnouncementPriority } from '../../types/database.types';

const CATEGORIES: AnnouncementCategory[] = [
  'General Announcement', 'Public Advisory', 'Service Update',
  'Program or Activity', 'Safety Information', 'Emergency Advisory', 'Other',
];
const PRIORITIES: AnnouncementPriority[] = ['Normal', 'Important', 'Urgent'];

const TITLE_MAX = 150;
const SUMMARY_MAX = 300;
const CONTENT_MAX = 10000;

export interface AnnouncementFormValues {
  title: string;
  summary: string;
  content: string;
  category: AnnouncementCategory;
  priority: AnnouncementPriority;
  publicationTiming: 'now' | 'schedule';
  scheduledAt: string; // <input type="datetime-local"> value
  expiresAt: string;
  externalLink: string;
}

function toDatetimeLocal(iso: string | null): string {
  if (!iso) return '';
  // <input type="datetime-local"> wants local time with no timezone/seconds.
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function defaultFormValues(existing?: Announcement | null): AnnouncementFormValues {
  if (!existing) {
    return {
      title: '', summary: '', content: '', category: 'General Announcement', priority: 'Normal',
      publicationTiming: 'now', scheduledAt: '', expiresAt: '', externalLink: '',
    };
  }
  return {
    title: existing.title,
    summary: existing.summary ?? '',
    content: existing.content,
    category: existing.category,
    priority: existing.priority,
    publicationTiming: existing.scheduled_at ? 'schedule' : 'now',
    scheduledAt: toDatetimeLocal(existing.scheduled_at),
    expiresAt: toDatetimeLocal(existing.expires_at),
    externalLink: existing.external_link ?? '',
  };
}

function validate(values: AnnouncementFormValues, requireScheduleTime: boolean): string | null {
  const title = values.title.trim();
  if (title.length < 3) return 'Title must be at least 3 characters.';
  if (title.length > TITLE_MAX) return `Title must be ${TITLE_MAX} characters or fewer.`;
  if (!values.content.trim()) return 'Content is required.';
  if (values.content.length > CONTENT_MAX) return `Content must be ${CONTENT_MAX} characters or fewer.`;
  if (values.summary.length > SUMMARY_MAX) return `Summary must be ${SUMMARY_MAX} characters or fewer.`;
  if (values.externalLink && !/^https:\/\//i.test(values.externalLink.trim())) {
    return 'External link must start with https://';
  }
  if (requireScheduleTime && values.publicationTiming === 'schedule' && !values.scheduledAt) {
    return 'Choose a scheduled date and time, or switch to immediate publication.';
  }
  if (values.scheduledAt && values.expiresAt && new Date(values.expiresAt) <= new Date(values.scheduledAt)) {
    return 'Expiration must be after the scheduled publication time.';
  }
  return null;
}

/**
 * Create/edit form for one announcement. Handles CONTENT fields only
 * (title/content/category/priority/audience/link/timestamps) — the
 * lifecycle transitions (Publish Now / Unpublish / Archive on an
 * EXISTING announcement) live as row actions on AnnouncementsPage,
 * deliberately kept separate so editing content never silently changes
 * an already-published announcement's live status (brief Part B.7 vs
 * B.8). A brand-new draft is the one case this form itself decides
 * publication timing for, via the three submit buttons below.
 *
 * "Preview" toggles a read-only rendering of the same values in place —
 * there is nothing to preview from the server, so this never makes a
 * network call. Content/summary/title are always rendered as plain
 * text (no dangerouslySetInnerHTML anywhere in this component), which
 * is what actually rules out stored-HTML/script execution.
 */
export function AnnouncementFormModal({
  mode,
  initial,
  saving,
  onCancel,
  onSaveDraft,
  onPublishNow,
  onSchedule,
  onSaveChanges,
}: {
  mode: 'create' | 'edit';
  initial: Announcement | null;
  saving: boolean;
  onCancel: () => void;
  onSaveDraft: (values: AnnouncementFormValues) => void;
  onPublishNow: (values: AnnouncementFormValues) => void;
  onSchedule: (values: AnnouncementFormValues) => void;
  /** Edit mode only, for a non-Draft announcement: update content without changing its current lifecycle status. */
  onSaveChanges: (values: AnnouncementFormValues) => void;
}) {
  const [values, setValues] = useState<AnnouncementFormValues>(() => defaultFormValues(initial));
  const [error, setError] = useState<string | null>(null);
  const [previewing, setPreviewing] = useState(false);

  const isEditingLiveAnnouncement = mode === 'edit' && initial && initial.status !== 'Draft';

  const set = <K extends keyof AnnouncementFormValues>(key: K, v: AnnouncementFormValues[K]) =>
    setValues((f) => ({ ...f, [key]: v }));

  const submit = (action: 'draft' | 'publish' | 'schedule' | 'save') => {
    const err = validate(values, action === 'schedule');
    if (err) {
      setError(err);
      return;
    }
    setError(null);
    if (action === 'draft') onSaveDraft(values);
    else if (action === 'publish') onPublishNow(values);
    else if (action === 'schedule') onSchedule(values);
    else onSaveChanges(values);
  };

  return (
    <Modal
      title={mode === 'create' ? 'Create Announcement' : 'Edit Announcement'}
      onClose={onCancel}
      footer={
        <>
          <button className="btn btn-outline" onClick={onCancel} disabled={saving}>
            Cancel
          </button>
          <button className="btn btn-outline" onClick={() => setPreviewing((p) => !p)} disabled={saving}>
            {previewing ? 'Back to Edit' : 'Preview'}
          </button>
          {isEditingLiveAnnouncement ? (
            <button className="btn btn-primary" onClick={() => submit('save')} disabled={saving}>
              {saving ? 'Saving...' : 'Save Changes'}
            </button>
          ) : (
            <>
              <button className="btn btn-outline" onClick={() => submit('draft')} disabled={saving}>
                Save Draft
              </button>
              {values.publicationTiming === 'schedule' ? (
                <button className="btn btn-primary" onClick={() => submit('schedule')} disabled={saving}>
                  {saving ? 'Scheduling...' : 'Schedule'}
                </button>
              ) : (
                <button className="btn btn-primary" onClick={() => submit('publish')} disabled={saving}>
                  {saving ? 'Publishing...' : 'Publish Now'}
                </button>
              )}
            </>
          )}
        </>
      }
    >
      {error && <p style={{ color: 'var(--color-danger)', fontSize: 13, marginBottom: 14 }}>{error}</p>}

      {previewing ? (
        <div className="card" style={{ margin: 0 }}>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8 }}>
            <StatusBadge label={values.priority} />
            <StatusBadge label={values.category} />
          </div>
          <h3 style={{ margin: '0 0 6px' }}>{values.title || 'Untitled announcement'}</h3>
          {values.summary && <p style={{ color: 'var(--color-text-muted)', marginBottom: 10 }}>{values.summary}</p>}
          <p style={{ whiteSpace: 'pre-wrap' }}>{values.content || 'No content yet.'}</p>
          {values.externalLink && (
            <p style={{ marginTop: 10 }}>
              <a href={values.externalLink} target="_blank" rel="noreferrer">
                {values.externalLink}
              </a>
            </p>
          )}
        </div>
      ) : (
        <>
          <div className="field">
            <label className="label">Announcement Title *</label>
            <input
              className="input"
              value={values.title}
              maxLength={TITLE_MAX}
              onChange={(e) => set('title', e.target.value)}
              placeholder="e.g. Office closure on November 1"
            />
          </div>

          <div className="field">
            <label className="label">Short Summary (optional)</label>
            <input
              className="input"
              value={values.summary}
              maxLength={SUMMARY_MAX}
              onChange={(e) => set('summary', e.target.value)}
              placeholder="One or two sentences shown in the mobile feed preview"
            />
          </div>

          <div className="field">
            <label className="label">Announcement Content *</label>
            <textarea
              className="input"
              style={{ minHeight: 140, resize: 'vertical' }}
              value={values.content}
              maxLength={CONTENT_MAX}
              onChange={(e) => set('content', e.target.value)}
              placeholder="Full announcement text, shown to survivors as plain text."
            />
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
            <div className="field">
              <label className="label">Category *</label>
              <select className="input" value={values.category} onChange={(e) => set('category', e.target.value as AnnouncementCategory)}>
                {CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label className="label">Priority *</label>
              <select className="input" value={values.priority} onChange={(e) => set('priority', e.target.value as AnnouncementPriority)}>
                {PRIORITIES.map((p) => (
                  <option key={p} value={p}>
                    {p}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="field">
            <label className="label">Target Audience *</label>
            <select className="input" value="All Survivors" disabled>
              <option value="All Survivors">All Survivors (province-wide)</option>
            </select>
            <p style={{ fontSize: 12, color: 'var(--color-text-muted)', marginTop: 6 }}>
              The only audience supported today. Narrower targeting (e.g. by municipality) is not yet implemented.
            </p>
          </div>

          {!isEditingLiveAnnouncement && (
            <div className="field">
              <label className="label">Publication Timing *</label>
              <select
                className="input"
                value={values.publicationTiming}
                onChange={(e) => set('publicationTiming', e.target.value as 'now' | 'schedule')}
              >
                <option value="now">Publish immediately</option>
                <option value="schedule">Schedule for later</option>
              </select>
            </div>
          )}

          {(isEditingLiveAnnouncement ? initial?.status === 'Scheduled' : values.publicationTiming === 'schedule') && (
            <div className="field">
              <label className="label">Scheduled Publication Date &amp; Time{!isEditingLiveAnnouncement ? ' *' : ''}</label>
              <input
                className="input"
                type="datetime-local"
                value={values.scheduledAt}
                onChange={(e) => set('scheduledAt', e.target.value)}
              />
              <p style={{ fontSize: 12, color: 'var(--color-text-muted)', marginTop: 6 }}>
                Published automatically by the server at this time — no browser session needs to stay open.
              </p>
            </div>
          )}

          <div className="field">
            <label className="label">Expiration Date &amp; Time (optional)</label>
            <input className="input" type="datetime-local" value={values.expiresAt} onChange={(e) => set('expiresAt', e.target.value)} />
          </div>

          <div className="field">
            <label className="label">External Information Link (optional)</label>
            <input
              className="input"
              type="url"
              value={values.externalLink}
              onChange={(e) => set('externalLink', e.target.value)}
              placeholder="https://..."
            />
          </div>
        </>
      )}
    </Modal>
  );
}

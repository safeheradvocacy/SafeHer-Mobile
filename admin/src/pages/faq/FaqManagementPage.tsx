import React, { useCallback, useEffect, useState } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { useToast } from '../../contexts/ToastContext';
import { supabase } from '../../lib/supabase';
import { EmptyState, Modal, PageHeader, StatusBadge } from '../../components/ui';
import { DashboardHeaderActions } from '../../components/dashboard/DashboardHeaderActions';
import { useHeaderRefresh } from '../../hooks/useHeaderRefresh';
import type { Faq } from '../../types/database.types';

const CATEGORIES = [
  'Reporting an incident',
  'Emergency SOS',
  'Case tracking',
  'Shelter services',
  'Shelter requests',
  'Privacy and confidentiality',
  'Available government assistance',
  'SafeSpace account questions',
  'Case referral process',
  'Other',
];

const EMPTY_FORM = {
  category: CATEGORIES[0],
  question: '',
  answer: '',
  keywordsText: '',
  is_active: true,
};

// Verified, admin-authored content the AI assistant surfaces verbatim —
// never edited or invented by the AI itself. Management is restricted to
// provincial-tier admins (see module6_ai_support.sql's RLS) since this is
// official system content, not something every admin role should be able
// to rewrite.
export function FaqManagementPage() {
  const { profile } = useAuth();
  const { showToast } = useToast();
  const [faqs, setFaqs] = useState<Faq[]>([]);
  const [loading, setLoading] = useState(true);
  const [categoryFilter, setCategoryFilter] = useState<string>('All');

  const [modalOpen, setModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const { data } = await supabase.from('faqs').select('*').order('category').order('question');
    setFaqs(data ?? []);
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const openCreate = () => {
    setEditingId(null);
    setForm(EMPTY_FORM);
    setError(null);
    setModalOpen(true);
  };

  const openEdit = (f: Faq) => {
    setEditingId(f.faq_id);
    setForm({
      category: CATEGORIES.includes(f.category) ? f.category : 'Other',
      question: f.question,
      answer: f.answer,
      keywordsText: f.keywords.join(', '),
      is_active: f.is_active,
    });
    setError(null);
    setModalOpen(true);
  };

  const toggleActive = async (f: Faq) => {
    const { error: err } = await supabase.from('faqs').update({ is_active: !f.is_active }).eq('faq_id', f.faq_id);
    if (err) {
      showToast('error', 'Could not update this FAQ.');
      return;
    }
    setFaqs((prev) => prev.map((x) => (x.faq_id === f.faq_id ? { ...x, is_active: !x.is_active } : x)));
    // No manual audit call — trg_audit_faqs (module6_ai_support.sql) fires automatically.
  };

  const submit = async () => {
    if (!form.question.trim() || !form.answer.trim()) {
      setError('Please fill in both the question and the answer.');
      return;
    }
    setSaving(true);
    setError(null);

    const payload = {
      category: form.category,
      question: form.question.trim(),
      answer: form.answer.trim(),
      keywords: form.keywordsText
        .split(',')
        .map((k) => k.trim().toLowerCase())
        .filter(Boolean),
      is_active: form.is_active,
      ...(editingId ? {} : { created_by: profile?.profile_id }),
    };

    const { error: dbErr } = editingId
      ? await supabase.from('faqs').update(payload).eq('faq_id', editingId)
      : await supabase.from('faqs').insert(payload);

    setSaving(false);
    if (dbErr) {
      if (import.meta.env.DEV) console.error('FAQ save failed:', dbErr);
      setError(dbErr.message || 'Could not save this FAQ. Please try again.');
      return;
    }
    setModalOpen(false);
    showToast('success', editingId ? 'FAQ updated.' : 'FAQ added.');
    load();
  };

  const visible = categoryFilter === 'All' ? faqs : faqs.filter((f) => f.category === categoryFilter);

  const { refreshing, lastUpdated, onRefresh } = useHeaderRefresh(loading, load);

  return (
    <div>
      <PageHeader
        title="FAQ Management"
        subtitle="Verified answers the SafeSpace Assistant uses before calling the AI"
        actions={
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
            <button className="btn btn-primary" onClick={openCreate}>
              Add FAQ
            </button>
            <DashboardHeaderActions showSearch lastUpdated={lastUpdated} refreshing={refreshing} onRefresh={onRefresh} />
          </div>
        }
      />

      <div style={{ marginBottom: 16 }}>
        <select className="input" style={{ maxWidth: 280 }} value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value)}>
          <option value="All">All categories</option>
          {CATEGORIES.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
      </div>

      <div className="card">
        {loading ? (
          <p style={{ color: 'var(--color-text-muted)' }}>Loading...</p>
        ) : visible.length === 0 ? (
          <EmptyState title="No FAQs yet" subtitle="Add verified answers survivors will see before the AI is ever asked." />
        ) : (
          <div className="table-responsive">
            <table>
              <thead>
                <tr>
                  <th>Question</th>
                  <th>Category</th>
                  <th>Status</th>
                  <th className="table-actions-cell"></th>
                </tr>
              </thead>
              <tbody>
                {visible.map((f) => (
                  <tr key={f.faq_id}>
                    <td>{f.question}</td>
                    <td style={{ color: 'var(--color-text-muted)' }}>{f.category}</td>
                    <td>
                      <StatusBadge label={f.is_active ? 'Active' : 'Inactive'} />
                    </td>
                    <td className="table-actions-cell">
                      <button className="btn btn-outline btn-sm" style={{ marginRight: 6 }} onClick={() => openEdit(f)}>
                        Edit
                      </button>
                      <button className="btn btn-outline btn-sm" onClick={() => toggleActive(f)}>
                        {f.is_active ? 'Deactivate' : 'Activate'}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {modalOpen && (
        <Modal
          title={editingId ? 'Edit FAQ' : 'Add FAQ'}
          onClose={() => setModalOpen(false)}
          footer={
            <>
              <button className="btn btn-outline" onClick={() => setModalOpen(false)} disabled={saving}>
                Cancel
              </button>
              <button className="btn btn-primary" onClick={submit} disabled={saving}>
                {saving ? 'Saving...' : editingId ? 'Save changes' : 'Add FAQ'}
              </button>
            </>
          }
        >
          <div className="field">
            <label className="label">Category</label>
            <select className="input" value={form.category} onChange={(e) => setForm((f) => ({ ...f, category: e.target.value }))} disabled={saving}>
              {CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label className="label">Question</label>
            <input className="input" value={form.question} onChange={(e) => setForm((f) => ({ ...f, question: e.target.value }))} disabled={saving} />
          </div>
          <div className="field">
            <label className="label">Verified answer</label>
            <textarea
              className="input"
              rows={4}
              value={form.answer}
              onChange={(e) => setForm((f) => ({ ...f, answer: e.target.value }))}
              disabled={saving}
            />
          </div>
          <div className="field">
            <label className="label">Keywords (comma-separated)</label>
            <input
              className="input"
              placeholder="e.g. report, incident, file a complaint"
              value={form.keywordsText}
              onChange={(e) => setForm((f) => ({ ...f, keywordsText: e.target.value }))}
              disabled={saving}
            />
            <p style={{ fontSize: 12, color: 'var(--color-text-muted)', marginTop: 4 }}>
              Used by the assistant to match a survivor's message to this answer before it ever calls the AI.
            </p>
          </div>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
            <input type="checkbox" checked={form.is_active} onChange={(e) => setForm((f) => ({ ...f, is_active: e.target.checked }))} disabled={saving} />
            Active (visible to the assistant and survivors)
          </label>

          {error && <p style={{ color: 'var(--color-danger)', fontSize: 13, marginTop: 16 }}>{error}</p>}
        </Modal>
      )}
    </div>
  );
}

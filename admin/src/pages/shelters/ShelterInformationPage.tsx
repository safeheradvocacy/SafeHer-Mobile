import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ChevronRight } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { useToast } from '../../contexts/ToastContext';
import { supabase } from '../../lib/supabase';
import { EmptyState, Modal, PageHeader, StatusBadge } from '../../components/ui';
import { ShelterMap } from '../../components/maps/ShelterMap';

// Shelter Information — the single consolidated management page (master
// prompt: "Consolidate Shelter Information and Services Management,
// Remove Redundant Navigation"). Sections:
//   A. Shelter Details — editable contact/status; name/address/location
//      stay read-only, matching the existing validate_shelter_update()
//      DB trigger (module4_shelter_admin.sql) that already restricts
//      shelter_admin to operational fields only, unchanged by this UI
//      consolidation.
//   B. Location — read-only address + map (shelter_admin has no
//      location-editing permission to begin with, so there's nothing to
//      make editable here; folded in rather than a separate route since
//      it's just an address and a map with no distinct workflow).
//   C. Capacity & Occupancy — a READ-ONLY summary (Total/Occupied/
//      Available/Rate/Status) linking out to the Occupancy & Placement
//      page for the actual editable capacity form and placement detail —
//      kept there deliberately so this page never duplicates that full
//      management form, per the brief's own "don't duplicate" rule.
//   D. Services Offered — the exact view/edit workflow that used to be
//      ShelterServicesPage.tsx (now removed; its route and nav item are
//      gone, this section replaces both), reusing the same
//      shelters.services_available field, same comma-separated parsing,
//      same update call. Not case_services (module22) — that tracks a
//      service delivered to a specific CASE, an unrelated concept this
//      page never reads or writes.
export function ShelterInformationPage() {
  const { profile, shelter, municipality, refreshProfile } = useAuth();
  const { showToast } = useToast();

  const [detailsForm, setDetailsForm] = useState({ contact_number: '', email: '', is_active: true });
  const [detailsEditOpen, setDetailsEditOpen] = useState(false);
  const [savingDetails, setSavingDetails] = useState(false);

  const [servicesText, setServicesText] = useState('');
  const [servicesEditOpen, setServicesEditOpen] = useState(false);
  const [savingServices, setSavingServices] = useState(false);

  useEffect(() => {
    if (!shelter) return;
    setDetailsForm({ contact_number: shelter.contact_number ?? '', email: shelter.email ?? '', is_active: shelter.is_active });
    setServicesText(shelter.services_available ?? '');
  }, [shelter]);

  const submitDetails = async () => {
    if (!shelter) return;
    setSavingDetails(true);
    const { error } = await supabase
      .from('shelters')
      .update({ contact_number: detailsForm.contact_number || null, email: detailsForm.email || null, is_active: detailsForm.is_active })
      .eq('shelter_id', shelter.shelter_id);
    await refreshProfile();
    setSavingDetails(false);
    if (error) {
      showToast('error', 'Could not save shelter information.');
      return;
    }
    setDetailsEditOpen(false);
    showToast('success', 'Shelter information updated.');
  };

  const submitServices = async () => {
    if (!shelter) return;
    setSavingServices(true);
    const { error } = await supabase.from('shelters').update({ services_available: servicesText || null }).eq('shelter_id', shelter.shelter_id);
    await refreshProfile();
    setSavingServices(false);
    if (error) {
      showToast('error', 'Could not save services.');
      return;
    }
    setServicesEditOpen(false);
    showToast('success', 'Services updated.');
  };

  if (!profile?.shelter_id) {
    return (
      <div>
        <PageHeader title="Shelter Information" />
        <EmptyState title="No shelter assigned" subtitle="Contact your provincial administrator to have a shelter assigned to your account." />
      </div>
    );
  }

  const services = (shelter?.services_available ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  const availableCapacity = shelter ? Math.max(0, (shelter.capacity ?? 0) - (shelter.current_occupancy ?? 0)) : 0;
  const occupancyRate = shelter?.capacity ? Math.round(((shelter.current_occupancy ?? 0) / shelter.capacity) * 100) : 0;

  return (
    <div>
      <PageHeader title="Shelter Information" subtitle={shelter?.shelter_name} />

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20, alignItems: 'start' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20, minWidth: 0 }}>
          {/* ---------- A. Shelter Details ---------- */}
          <div className="card">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
              <h3 style={{ margin: 0 }}>Shelter Details</h3>
              <button className="btn btn-outline btn-sm" onClick={() => setDetailsEditOpen(true)}>
                Edit
              </button>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
              <h2 style={{ fontSize: 20, margin: 0 }}>{shelter?.shelter_name ?? '—'}</h2>
              <StatusBadge label={shelter?.is_active ? 'Active' : 'Inactive'} />
            </div>
            <Field label="Municipality" value={municipality?.municipality_name ?? '—'} />
            <Field label="Address" value={shelter?.address ?? '—'} />
            <Field label="Contact number" value={shelter?.contact_number ?? '—'} />
            <Field label="Email" value={shelter?.email ?? '—'} />
            <p style={{ fontSize: 12, color: 'var(--color-text-muted)', marginTop: 14 }}>
              Name, address, and location are managed by your municipal or provincial administrator. Contact details and
              operating status can be updated here.
            </p>
          </div>

          {/* ---------- C. Capacity & Occupancy (read-only summary) ---------- */}
          <div className="card">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
              <h3 style={{ margin: 0 }}>Capacity &amp; Occupancy</h3>
              <Link to="/admin/shelter/occupancy" className="dash-view-all">
                Manage <ChevronRight size={13} />
              </Link>
            </div>
            <Field label="Total capacity" value={shelter?.capacity != null ? String(shelter.capacity) : '—'} />
            <Field label="Current occupancy" value={shelter?.current_occupancy != null ? String(shelter.current_occupancy) : '—'} />
            <Field label="Available spaces" value={String(availableCapacity)} />
            <Field label="Occupancy rate" value={`${occupancyRate}%`} />
            <Field label="Operating status" value={shelter?.is_active ? 'Active' : 'Inactive'} />
            <p style={{ fontSize: 12, color: 'var(--color-text-muted)', marginTop: 10 }}>
              Capacity changes and placement detail are managed on the Occupancy &amp; Placement page.
            </p>
          </div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 20, minWidth: 0 }}>
          {/* ---------- B. Location ---------- */}
          <div className="card" style={{ height: 260, padding: 0, overflow: 'hidden' }}>
            <ShelterMap latitude={shelter?.latitude ?? null} longitude={shelter?.longitude ?? null} label={shelter?.shelter_name ?? ''} />
          </div>
          {shelter?.latitude != null && shelter?.longitude != null ? (
            <a
              href={`https://www.google.com/maps/dir/?api=1&destination=${shelter.latitude},${shelter.longitude}`}
              target="_blank"
              rel="noreferrer"
              style={{ fontSize: 13, textAlign: 'center' }}
            >
              Open in Maps
            </a>
          ) : (
            <p style={{ fontSize: 12.5, color: 'var(--color-text-muted)', textAlign: 'center' }}>
              No location on file for this shelter yet.
            </p>
          )}

          {/* ---------- D. Services Offered ---------- */}
          <div className="card">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
              <h3 style={{ margin: 0 }}>Services Offered</h3>
              <button className="btn btn-outline btn-sm" onClick={() => setServicesEditOpen(true)}>
                Edit
              </button>
            </div>
            {services.length === 0 ? (
              <EmptyState title="No services listed yet" subtitle="Add the services your shelter offers, e.g. Counseling, Childcare, Medical." />
            ) : (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                {services.map((s) => (
                  <span
                    key={s}
                    style={{ fontSize: 13, padding: '5px 14px', borderRadius: 'var(--radius-pill)', background: 'var(--color-surface-muted)', color: 'var(--color-text)' }}
                  >
                    {s}
                  </span>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {detailsEditOpen && (
        <Modal
          title="Edit shelter information"
          onClose={() => setDetailsEditOpen(false)}
          footer={
            <>
              <button className="btn btn-outline" onClick={() => setDetailsEditOpen(false)} disabled={savingDetails}>
                Cancel
              </button>
              <button className="btn btn-primary" onClick={submitDetails} disabled={savingDetails}>
                {savingDetails ? 'Saving...' : 'Save changes'}
              </button>
            </>
          }
        >
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
            <div className="field">
              <label className="label">Contact number</label>
              <input className="input" value={detailsForm.contact_number} onChange={(e) => setDetailsForm((f) => ({ ...f, contact_number: e.target.value }))} />
            </div>
            <div className="field">
              <label className="label">Email</label>
              <input className="input" type="email" value={detailsForm.email} onChange={(e) => setDetailsForm((f) => ({ ...f, email: e.target.value }))} />
            </div>
          </div>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
            <input type="checkbox" checked={detailsForm.is_active} onChange={(e) => setDetailsForm((f) => ({ ...f, is_active: e.target.checked }))} />
            Shelter is currently active and accepting requests
          </label>
        </Modal>
      )}

      {servicesEditOpen && (
        <Modal
          title="Edit services offered"
          onClose={() => setServicesEditOpen(false)}
          footer={
            <>
              <button className="btn btn-outline" onClick={() => setServicesEditOpen(false)} disabled={savingServices}>
                Cancel
              </button>
              <button className="btn btn-primary" onClick={submitServices} disabled={savingServices}>
                {savingServices ? 'Saving...' : 'Save changes'}
              </button>
            </>
          }
        >
          <div className="field">
            <label className="label">Services available</label>
            <input className="input" placeholder="e.g. Counseling, Childcare, Medical" value={servicesText} onChange={(e) => setServicesText(e.target.value)} />
            <p style={{ fontSize: 12, color: 'var(--color-text-muted)', marginTop: 6 }}>Separate multiple services with commas.</p>
          </div>
        </Modal>
      )}
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', fontSize: 13 }}>
      <span style={{ color: 'var(--color-text-muted)' }}>{label}</span>
      <span style={{ fontWeight: 500 }}>{value}</span>
    </div>
  );
}

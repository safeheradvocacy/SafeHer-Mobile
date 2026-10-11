import React from 'react';
import { Check, KeyRound, Minus } from 'lucide-react';
import { PageHeader } from '../../components/ui';
import { DashboardHeaderActions } from '../../components/dashboard/DashboardHeaderActions';
import { PERMISSION_LABEL, PERMISSION_MODULES, hasPermission } from '../../lib/permissions';
import { ROLE_LABEL } from '../../lib/roleLabels';
import type { UserRole } from '../../types/database.types';

// Responsibility + jurisdiction, not a vertical hierarchy — module16.
// Provincial Staff sits alongside Provincial Administrator in the
// matrix below (both province-wide) but the two are NOT "staff below
// admin": one is technical/system administration, the other is
// operational case management at the same geographic scope.
const ROLE_RESPONSIBILITY: { role: UserRole; summary: string }[] = [
  { role: 'provincial_admin', summary: 'Technical Administration — system configuration, administrator accounts, audit, backup & restore.' },
  { role: 'provincial_staff', summary: 'Province-wide Operational Case Management — cases, SOS, referrals, reports, coordination.' },
  { role: 'municipal_admin', summary: 'Municipality-level Operations — local case management, verification, reporting.' },
  { role: 'barangay_admin', summary: 'Barangay-level Operations — local case handling and verification within one barangay.' },
];

// Only the roles this permission model actually governs — barangay_admin
// through provincial_admin form one continuous operational/technical
// ladder. shelter_admin, shelter_staff, support_expert, and
// law_enforcement are deliberately excluded from this matrix: their
// access is scoped entirely by dedicated RLS (own shelter, own assigned
// conversation, own assigned referral) rather than by any of the
// permission keys below — including them here would misleadingly imply
// they're governed by this same module list.
const MATRIX_ROLES: UserRole[] = ['barangay_admin', 'municipal_admin', 'provincial_staff', 'provincial_admin'];

export function RolesPermissionsPage() {
  return (
    <div>
      {/* This page's content (PERMISSION_MODULES/ROLE_RESPONSIBILITY/
          MATRIX_ROLES) is entirely static TypeScript, not fetched from
          the database — there is genuinely nothing to refresh, so no
          refreshing/lastUpdated is wired here (a spinning refresh icon
          or a fabricated "Updated just now" would misrepresent a page
          with no live data source). Notifications/Profile stay
          available for consistency with every other admin page. */}
      <PageHeader title="Roles &amp; Permissions" subtitle="Current permission model" actions={<DashboardHeaderActions refreshing={false} onRefresh={() => {}} />} />

      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, background: 'var(--color-surface-muted)', borderRadius: 10, padding: 12, fontSize: 12.5, color: 'var(--color-text-muted)', marginBottom: 20 }}>
        <KeyRound size={15} style={{ flexShrink: 0, marginTop: 1 }} />
        This table reflects the actual code-level permission model that drives sidebar navigation and route access
        (<code>admin/src/lib/permissions.ts</code>) — it is read-only. There is no database-editable permission table
        in SafeSpace today, so there is no grant/revoke action here; changing what a role can do requires a code change,
        reviewed like any other. The database's own row-level security policies are the real security boundary —
        this page describes the intended model, not a substitute for it.
      </div>

      <div className="card" style={{ marginBottom: 20 }}>
        <h3 style={{ fontSize: 14.5, marginBottom: 12 }}>Responsibility &amp; Jurisdiction</h3>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 14 }}>
          {ROLE_RESPONSIBILITY.map((r) => (
            <div key={r.role}>
              <div style={{ fontWeight: 700, fontSize: 13 }}>{ROLE_LABEL[r.role]}</div>
              <div style={{ fontSize: 12.5, color: 'var(--color-text-muted)', marginTop: 2 }}>{r.summary}</div>
            </div>
          ))}
        </div>
      </div>

      <div className="card">
        <div className="table-responsive">
          <table>
            <thead>
              <tr>
                <th>Permission</th>
                {MATRIX_ROLES.map((r) => (
                  <th key={r} style={{ textAlign: 'center' }}>{ROLE_LABEL[r]}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {PERMISSION_MODULES.map((group) => (
                <React.Fragment key={group.module}>
                  <tr>
                    <td colSpan={MATRIX_ROLES.length + 1} style={{ fontWeight: 700, fontSize: 12.5, color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.03em', paddingTop: 16 }}>
                      {group.module}
                    </td>
                  </tr>
                  {group.keys.map((key) => (
                    <tr key={key}>
                      <td>{PERMISSION_LABEL[key]}</td>
                      {MATRIX_ROLES.map((r) => (
                        <td key={r} style={{ textAlign: 'center' }}>
                          {hasPermission(r, key) ? (
                            <Check size={15} color="var(--color-success)" aria-label="Allowed" />
                          ) : (
                            <Minus size={13} color="var(--color-text-subtle)" aria-label="Not permitted" />
                          )}
                        </td>
                      ))}
                    </tr>
                  ))}
                </React.Fragment>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="card" style={{ marginTop: 20 }}>
        <h3 style={{ fontSize: 14.5, marginBottom: 8 }}>Roles outside this table</h3>
        <p style={{ fontSize: 12.5, color: 'var(--color-text-muted)', lineHeight: 1.6 }}>
          Shelter Administrator, Shelter Staff, Support Expert, and Police Officer accounts are not governed by the
          permission keys above — each is scoped independently at the database level (own shelter, own assigned
          support conversation, direct access to all SOS alerts, own assigned case referral) and reaches only its
          own dedicated dashboard and work queue. The one exception is Reports &amp; Analytics (module24): each of
          these four roles holds <code>reports.view</code> and sees its own role-scoped report page, built from the
          exact same assignment/shelter-scoped data above — never the shared case-wide Reports page the roles in
          this table use.
        </p>
      </div>
    </div>
  );
}

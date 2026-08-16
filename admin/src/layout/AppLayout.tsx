import React, { useState } from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import {
  LayoutDashboard,
  ClipboardList,
  Siren,
  MapPin,
  Building2,
  BarChart3,
  Users,
  Bell,
  Settings,
  LogOut,
  Menu,
  X,
} from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { LogoLockup } from '../components/branding/Logo';

const MUNICIPAL_NAV = [
  { to: '/admin/dashboard', label: 'Dashboard', icon: LayoutDashboard, end: true },
  { to: '/admin/cases', label: 'Case Management', icon: ClipboardList },
  { to: '/admin/sos', label: 'SOS Monitoring', icon: Siren },
  { to: '/admin/shelters', label: 'Shelters & Referrals', icon: MapPin },
  { to: '/admin/reports', label: 'Reports & Analytics', icon: BarChart3 },
  { to: '/admin/users', label: 'User Management', icon: Users },
  { to: '/admin/notifications', label: 'Notifications', icon: Bell },
  { to: '/admin/settings', label: 'Settings', icon: Settings },
];

const PROVINCIAL_NAV = [
  { to: '/admin/dashboard', label: 'Provincial Dashboard', icon: LayoutDashboard, end: true },
  { to: '/admin/cases', label: 'Province-Wide Cases', icon: ClipboardList },
  { to: '/admin/sos', label: 'SOS Monitoring', icon: Siren },
  { to: '/admin/municipalities', label: 'Municipality Management', icon: Building2 },
  { to: '/admin/shelters', label: 'Shelters & Referrals', icon: MapPin },
  { to: '/admin/reports', label: 'Reports & Analytics', icon: BarChart3 },
  { to: '/admin/users', label: 'Administrator Management', icon: Users },
  { to: '/admin/notifications', label: 'Notifications', icon: Bell },
  { to: '/admin/settings', label: 'Settings', icon: Settings },
];

export function AppLayout() {
  const { profile, municipality, signOut } = useAuth();
  const navigate = useNavigate();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const isProvincial = profile?.role === 'provincial_admin' || profile?.role === 'super_admin';
  const navItems = isProvincial ? PROVINCIAL_NAV : MUNICIPAL_NAV;

  const onLogout = async () => {
    await signOut();
    navigate('/admin/login', { replace: true });
  };

  return (
    <div style={{ display: 'flex', minHeight: '100vh' }}>
      {sidebarOpen && (
        <div
          onClick={() => setSidebarOpen(false)}
          aria-hidden="true"
          style={{ position: 'fixed', inset: 0, background: 'rgba(43,37,48,0.4)', zIndex: 39 }}
        />
      )}

      <aside
        className={`app-sidebar${sidebarOpen ? ' open' : ''}`}
        style={{
          width: 'var(--sidebar-width)',
          background: 'var(--color-surface)',
          borderRight: '1px solid var(--color-border)',
          display: 'flex',
          flexDirection: 'column',
          position: 'sticky',
          top: 0,
          height: '100vh',
        }}
      >
        <div style={{ padding: '22px 20px' }}>
          <LogoLockup size={30} />
          <p style={{ fontSize: 12, color: 'var(--color-text-muted)', marginTop: 6 }}>
            {isProvincial ? 'Provincial Admin' : 'Municipal Admin'}
          </p>
        </div>
        <nav style={{ flex: 1, padding: '0 12px', display: 'flex', flexDirection: 'column', gap: 2 }} aria-label="Admin navigation">
          {navItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              onClick={() => setSidebarOpen(false)}
              style={({ isActive }) => ({
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                padding: '10px 12px',
                borderRadius: 10,
                fontSize: 14,
                fontWeight: 500,
                color: isActive ? 'var(--color-primary-dark)' : 'var(--color-text)',
                background: isActive ? 'var(--color-primary-light)' : 'transparent',
              })}
            >
              <item.icon size={17} strokeWidth={1.75} />
              {item.label}
            </NavLink>
          ))}
        </nav>
        <div style={{ padding: 16, borderTop: '1px solid var(--color-border)' }}>
          <p style={{ fontSize: 13, fontWeight: 600 }}>
            {profile?.first_name} {profile?.last_name}
          </p>
          <p style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>
            {isProvincial ? 'Coverage: Aurora Province' : (municipality?.municipality_name ?? '—')}
          </p>
          <button
            className="btn btn-outline btn-sm"
            style={{ marginTop: 10, width: '100%', justifyContent: 'center', gap: 6 }}
            onClick={onLogout}
          >
            <LogOut size={14} />
            Log out
          </button>
        </div>
      </aside>

      <div className="app-main" style={{ flex: 1, maxWidth: 1200, display: 'flex', flexDirection: 'column' }}>
        <div
          className="mobile-topbar"
          style={{
            display: 'none',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '14px 20px',
            borderBottom: '1px solid var(--color-border)',
            background: 'var(--color-surface)',
          }}
        >
          <LogoLockup size={26} />
          <button
            className="btn btn-outline btn-sm"
            aria-label={sidebarOpen ? 'Close navigation' : 'Open navigation'}
            aria-expanded={sidebarOpen}
            onClick={() => setSidebarOpen((v) => !v)}
          >
            {sidebarOpen ? <X size={16} /> : <Menu size={16} />}
          </button>
        </div>
        <main style={{ padding: 32, flex: 1 }}>
          <Outlet />
        </main>
      </div>
    </div>
  );
}

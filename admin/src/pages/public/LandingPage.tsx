import React from 'react';
import { useNavigate } from 'react-router-dom';
import {
  AlertCircle,
  FileLock2,
  ClipboardList,
  MapPin,
  Scale,
  Bell,
  Lock,
  KeyRound,
  EyeOff,
  Users,
  FileEdit,
  HeartHandshake,
  ShieldCheck,
  LayoutDashboard,
} from 'lucide-react';
import { LogoMark, LogoLockup } from '../../components/branding/Logo';

const FEATURES = [
  {
    icon: AlertCircle,
    title: 'Emergency SOS',
    description: 'Quick access to emergency assistance.',
  },
  {
    icon: FileLock2,
    title: 'Secure Incident Reporting',
    description: 'Submit reports securely and confidentially.',
  },
  {
    icon: ClipboardList,
    title: 'Case Tracking',
    description: 'Monitor the status of submitted reports and available support.',
  },
  {
    icon: MapPin,
    title: 'Shelter Locator',
    description: 'Find available shelters and support resources.',
  },
  {
    icon: Scale,
    title: 'Legal Assistance',
    description: 'Access information and referral support.',
  },
  {
    icon: Bell,
    title: 'Notifications',
    description: 'Receive important case and support updates.',
  },
];

const PRIVACY_POINTS = [
  { icon: Lock, label: 'Secure data' },
  { icon: KeyRound, label: 'Authorized access' },
  { icon: EyeOff, label: 'Confidential reporting' },
  { icon: Users, label: 'Role-based access' },
];

const STEPS = [
  { icon: FileEdit, title: 'Report', description: 'A survivor submits an incident report, confidentially or anonymously.' },
  { icon: ClipboardList, title: 'Review', description: 'Authorized municipal or provincial staff review the report.' },
  { icon: HeartHandshake, title: 'Support / Referral', description: 'Appropriate assistance and shelter referrals are coordinated.' },
  { icon: LayoutDashboard, title: 'Case Tracking', description: 'The survivor can follow their case status throughout.' },
];

export function LandingPage() {
  const navigate = useNavigate();

  return (
    <div>
      <a href="#main" className="skip-link">
        Skip to main content
      </a>

      <SiteHeader />

      <main id="main">
        <Hero />
        <About />
        <Features />
        <Privacy />
        <HowItWorks />
        <AdminPortalSection />
      </main>

      <Footer />
    </div>
  );
}

function SiteHeader() {
  const navigate = useNavigate();
  return (
    <header
      style={{
        position: 'sticky',
        top: 0,
        zIndex: 30,
        background: 'rgba(251,249,246,0.92)',
        backdropFilter: 'blur(6px)',
        borderBottom: '1px solid var(--color-border)',
      }}
    >
      <div className="container" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', height: 72 }}>
        <LogoLockup size={36} />
        <nav aria-label="Primary" style={{ display: 'flex', alignItems: 'center', gap: 28 }}>
          <a href="#about" style={{ color: 'var(--color-text)', fontSize: 14, fontWeight: 500 }}>
            About
          </a>
          <a href="#features" style={{ color: 'var(--color-text)', fontSize: 14, fontWeight: 500 }}>
            How SafeHer Helps
          </a>
          <a href="#privacy" style={{ color: 'var(--color-text)', fontSize: 14, fontWeight: 500 }}>
            Privacy
          </a>
          <button className="btn btn-outline btn-sm" onClick={() => navigate('/admin/login')}>
            Admin Portal
          </button>
        </nav>
      </div>
    </header>
  );
}

function HeroVisual() {
  // Abstract, non-photographic composition — concentric rings around the
  // brand mark, echoing the "protected perimeter" motif used in the mobile
  // app's onboarding. Deliberately not a photo/illustration of a person.
  return (
    <div
      style={{
        position: 'relative',
        width: '100%',
        aspectRatio: '1 / 1',
        maxWidth: 380,
        margin: '0 auto',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
      aria-hidden="true"
    >
      {[340, 270, 200].map((size, i) => (
        <div
          key={size}
          style={{
            position: 'absolute',
            width: size,
            height: size,
            borderRadius: '50%',
            border: `1px ${i === 1 ? 'dashed' : 'solid'} var(--color-primary)`,
            opacity: 0.12 + i * 0.08,
          }}
        />
      ))}
      <div
        style={{
          width: 132,
          height: 132,
          borderRadius: '50%',
          background: 'linear-gradient(135deg, var(--color-primary), var(--color-primary-dark))',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          boxShadow: '0 16px 32px rgba(81,64,128,0.28)',
        }}
      >
        <ShieldCheck size={64} color="#fff" strokeWidth={1.75} />
      </div>
    </div>
  );
}

function Hero() {
  return (
    <section className="section" style={{ paddingTop: 64 }}>
      <div className="container grid-2" style={{ alignItems: 'center', gap: 48 }}>
        <div>
          <h1 style={{ fontSize: 44, lineHeight: 1.15, color: 'var(--color-primary-dark)' }}>SafeHer</h1>
          <p style={{ fontSize: 18, color: 'var(--color-text-muted)', marginTop: 16, maxWidth: 480, lineHeight: 1.6 }}>
            A confidential platform for the support and protection of survivors of violence against women and
            children.
          </p>
          <div style={{ display: 'flex', gap: 14, marginTop: 32 }}>
            <a href="#features" className="btn btn-primary btn-lg">
              Get Started
            </a>
            <a href="/admin/login" className="btn btn-outline btn-lg">
              Admin Portal
            </a>
          </div>
        </div>
        <HeroVisual />
      </div>
    </section>
  );
}

function About() {
  return (
    <section id="about" className="section-sm" style={{ background: 'var(--color-surface)' }}>
      <div className="container" style={{ maxWidth: 760, textAlign: 'center' }}>
        <h2 style={{ fontSize: 28 }}>About SafeHer</h2>
        <p style={{ fontSize: 16, color: 'var(--color-text-muted)', marginTop: 16, lineHeight: 1.7 }}>
          SafeHer is a confidential digital platform designed to support survivors and connect them with appropriate
          assistance and services.
        </p>
      </div>
    </section>
  );
}

function Features() {
  return (
    <section id="features" className="section">
      <div className="container">
        <h2 style={{ fontSize: 28, textAlign: 'center' }}>How SafeHer Helps</h2>
        <div className="grid-3" style={{ marginTop: 40 }}>
          {FEATURES.map(({ icon: Icon, title, description }) => (
            <div key={title} className="card" style={{ padding: 24 }}>
              <div
                style={{
                  width: 44,
                  height: 44,
                  borderRadius: 12,
                  background: 'var(--color-primary-light)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  marginBottom: 16,
                }}
              >
                <Icon size={22} color="var(--color-primary-dark)" strokeWidth={1.75} />
              </div>
              <h3 style={{ fontSize: 16, marginBottom: 6 }}>{title}</h3>
              <p style={{ color: 'var(--color-text-muted)', fontSize: 14, lineHeight: 1.6 }}>{description}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function Privacy() {
  return (
    <section id="privacy" className="section-sm" style={{ background: 'var(--color-primary-dark)', color: '#fff' }}>
      <div className="container" style={{ maxWidth: 760, textAlign: 'center' }}>
        <h2 style={{ fontSize: 28, color: '#fff' }}>Your Privacy Matters</h2>
        <p style={{ fontSize: 16, color: 'rgba(255,255,255,0.85)', marginTop: 16, lineHeight: 1.7 }}>
          SafeHer is designed with privacy and security in mind. Sensitive information is accessible only to
          authorized personnel according to their role and jurisdiction.
        </p>
        <div className="grid-4" style={{ marginTop: 36, gap: 16 }}>
          {PRIVACY_POINTS.map(({ icon: Icon, label }) => (
            <div
              key={label}
              style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: 10,
                padding: '20px 12px',
                borderRadius: 12,
                background: 'rgba(255,255,255,0.08)',
                border: '1px solid rgba(255,255,255,0.14)',
              }}
            >
              <Icon size={22} color="#fff" strokeWidth={1.75} />
              <span style={{ fontSize: 13, fontWeight: 600 }}>{label}</span>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function HowItWorks() {
  return (
    <section className="section">
      <div className="container">
        <h2 style={{ fontSize: 28, textAlign: 'center' }}>How It Works</h2>
        <div
          className="grid-4"
          style={{ marginTop: 40, position: 'relative' }}
        >
          {STEPS.map(({ icon: Icon, title, description }, i) => (
            <div key={title} style={{ textAlign: 'center', position: 'relative' }}>
              {i < STEPS.length - 1 && (
                <div
                  aria-hidden="true"
                  className="how-it-works-connector"
                  style={{
                    position: 'absolute',
                    top: 26,
                    left: '60%',
                    width: '90%',
                    height: 1,
                    background: 'var(--color-border)',
                  }}
                />
              )}
              <div
                style={{
                  width: 52,
                  height: 52,
                  borderRadius: '50%',
                  background: 'var(--color-surface)',
                  border: '1.5px solid var(--color-primary)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  margin: '0 auto',
                  position: 'relative',
                  zIndex: 1,
                }}
              >
                <Icon size={22} color="var(--color-primary)" strokeWidth={1.75} />
              </div>
              <h3 style={{ fontSize: 15, marginTop: 14 }}>{title}</h3>
              <p style={{ fontSize: 13, color: 'var(--color-text-muted)', marginTop: 6, lineHeight: 1.6 }}>
                {description}
              </p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function AdminPortalSection() {
  const navigate = useNavigate();
  return (
    <section className="section-sm" style={{ background: 'var(--color-surface)' }}>
      <div className="container" style={{ maxWidth: 640, textAlign: 'center' }}>
        <div
          style={{
            width: 48,
            height: 48,
            borderRadius: 12,
            background: 'var(--color-primary-light)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            margin: '0 auto 16px',
          }}
        >
          <LayoutDashboard size={22} color="var(--color-primary-dark)" strokeWidth={1.75} />
        </div>
        <h2 style={{ fontSize: 24 }}>SafeHer Administration Portal</h2>
        <p style={{ fontSize: 15, color: 'var(--color-text-muted)', marginTop: 12, lineHeight: 1.7 }}>
          Authorized municipal and provincial personnel can securely manage reports, referrals, cases, resources, and
          support services.
        </p>
        <button className="btn btn-primary btn-lg" style={{ marginTop: 24 }} onClick={() => navigate('/admin/login')}>
          Access Admin Portal
        </button>
      </div>
    </section>
  );
}

function Footer() {
  return (
    <footer style={{ borderTop: '1px solid var(--color-border)', background: 'var(--color-surface)' }}>
      <div className="container" style={{ padding: '40px 24px', display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: 24 }}>
        <div style={{ maxWidth: 320 }}>
          <LogoLockup size={30} />
          <p style={{ fontSize: 13, color: 'var(--color-text-muted)', marginTop: 12, lineHeight: 1.6 }}>
            A confidential platform for the support and protection of survivors of violence against women and
            children.
          </p>
        </div>
        <nav aria-label="Footer" style={{ display: 'flex', gap: 32, flexWrap: 'wrap' }}>
          <a href="#privacy" style={{ fontSize: 13, color: 'var(--color-text-muted)' }}>
            Privacy
          </a>
          <span style={{ fontSize: 13, color: 'var(--color-text-muted)', opacity: 0.6 }}>Terms (coming soon)</span>
          <a href="mailto:support@safeher.example" style={{ fontSize: 13, color: 'var(--color-text-muted)' }}>
            Contact / Support
          </a>
          <a href="/admin/login" style={{ fontSize: 13, color: 'var(--color-text-muted)' }}>
            Admin Portal
          </a>
        </nav>
      </div>
      <div style={{ borderTop: '1px solid var(--color-border)', padding: '16px 24px', textAlign: 'center' }}>
        <span style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>© {new Date().getFullYear()} SafeHer</span>
      </div>
    </footer>
  );
}

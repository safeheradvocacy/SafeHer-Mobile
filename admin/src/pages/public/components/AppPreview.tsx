import React, { useEffect, useRef, useState } from 'react';
import { AlertCircle, Bell, ClipboardList, FileLock2, MapPin, MessageCircle } from 'lucide-react';

// Short "drawn" connector between each phone frame and its label — the
// scroll-triggered stroke-dashoffset reveal, scaled down to fit the space
// that already existed between the frame and the label (rather than
// extending sideways into the neighboring phone, which sits only a few px
// away in this tightly-packed row).
function PhoneConnector({ drawn }: { drawn: boolean }) {
  return (
    <svg
      className={`phone-connector${drawn ? ' is-drawn' : ''}`}
      width="2"
      height="18"
      viewBox="0 0 2 18"
      aria-hidden="true"
    >
      <line x1="1" y1="0" x2="1" y2="18" />
    </svg>
  );
}

function PhoneMockup({
  children,
  label,
  variant,
}: {
  children: React.ReactNode;
  label: string;
  variant?: 'center' | 'side-left' | 'side-right';
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [drawn, setDrawn] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setDrawn(true);
          observer.disconnect();
        }
      },
      { threshold: 0.35 }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return (
    <div ref={ref} className={`phone-mockup${variant ? ` ${variant}` : ''}`}>
      <div className="phone-frame">
        <div className="phone-notch" aria-hidden="true" />
        <div className="phone-screen">{children}</div>
        <div className="phone-home-indicator" aria-hidden="true" />
      </div>
      <PhoneConnector drawn={drawn} />
      <span className="phone-label">{label}</span>
    </div>
  );
}

const QUICK_ACTIONS = [
  { icon: FileLock2, label: 'Report Incident' },
  { icon: ClipboardList, label: 'Track My Cases' },
  { icon: MessageCircle, label: 'AI Assistant' },
  { icon: MapPin, label: 'Shelter Locator' },
];

function HomeScreenMock() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', padding: '36px 14px 16px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 14 }}>
        <div style={{ width: 22, height: 22, borderRadius: 7, background: 'var(--lp-gradient-primary)' }} />
        <div style={{ flex: 1 }} />
        <div
          style={{
            width: 22,
            height: 22,
            borderRadius: '50%',
            background: '#fff',
            border: '1px solid var(--lp-border)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Bell size={11} color="var(--lp-text-secondary)" strokeWidth={2} />
        </div>
        <div
          style={{
            width: 22,
            height: 22,
            borderRadius: '50%',
            background: 'var(--lp-lavender-pale)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: 9,
            fontWeight: 700,
            color: 'var(--lp-purple-deep)',
          }}
        >
          M
        </div>
      </div>

      <div style={{ fontSize: 15, fontWeight: 800, color: 'var(--lp-text-heading)', lineHeight: 1.25 }}>
        Good afternoon,
        <br />
        Maria
      </div>
      <div style={{ fontSize: 9.5, color: 'var(--lp-text-secondary)', marginTop: 4, marginBottom: 12 }}>
        How can we help you today?
      </div>

      <div
        style={{
          background: 'linear-gradient(135deg, #D94B63, #AD3549)',
          borderRadius: 14,
          padding: '11px 12px',
          color: '#fff',
          marginBottom: 12,
        }}
      >
        <div
          style={{
            width: 22,
            height: 22,
            borderRadius: '50%',
            background: 'rgba(255,255,255,0.22)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            marginBottom: 6,
          }}
        >
          <AlertCircle size={12} strokeWidth={2} />
        </div>
        <div style={{ fontSize: 10.5, fontWeight: 700 }}>Emergency SOS</div>
        <div style={{ fontSize: 8, opacity: 0.9, marginTop: 1 }}>Get immediate help when needed</div>
      </div>

      <div style={{ fontSize: 9.5, fontWeight: 700, color: 'var(--lp-text-primary)', marginBottom: 6 }}>
        Quick Actions
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, marginBottom: 12 }}>
        {QUICK_ACTIONS.map(({ icon: Icon, label }) => (
          <div
            key={label}
            style={{
              background: '#fff',
              border: '1px solid var(--lp-border)',
              borderRadius: 10,
              padding: '8px 7px',
            }}
          >
            <div
              style={{
                width: 18,
                height: 18,
                borderRadius: 6,
                background: 'var(--lp-lavender-pale)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                marginBottom: 4,
              }}
            >
              <Icon size={10} color="var(--lp-purple)" strokeWidth={2} />
            </div>
            <div style={{ fontSize: 7.5, fontWeight: 600, color: 'var(--lp-text-primary)', lineHeight: 1.2 }}>
              {label}
            </div>
          </div>
        ))}
      </div>

      <div style={{ fontSize: 9.5, fontWeight: 700, color: 'var(--lp-text-primary)', marginBottom: 6 }}>
        Your Cases
      </div>
      <div style={{ background: '#fff', border: '1px solid var(--lp-border)', borderRadius: 10, padding: '9px 10px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ fontSize: 9, fontWeight: 700, color: 'var(--lp-text-primary)' }}>CN-2026-0148</span>
          <span
            style={{
              fontSize: 7,
              fontWeight: 700,
              color: '#4C7EA8',
              background: '#EAF1F7',
              padding: '2px 6px',
              borderRadius: 999,
            }}
          >
            Under Review
          </span>
        </div>
        <div style={{ fontSize: 8, color: 'var(--lp-text-secondary)', marginTop: 3 }}>Harassment</div>
      </div>
    </div>
  );
}

function SosScreenMock() {
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        height: '100%',
        padding: '36px 16px 16px',
        textAlign: 'center',
      }}
    >
      <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--lp-text-heading)', marginBottom: 28 }}>
        Emergency SOS
      </div>

      <div
        aria-hidden="true"
        style={{
          position: 'relative',
          width: 108,
          height: 108,
          borderRadius: '50%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          marginTop: 12,
        }}
      >
        <div
          style={{
            position: 'absolute',
            inset: 0,
            borderRadius: '50%',
            border: '1px solid rgba(196,72,91,0.35)',
          }}
        />
        <div
          style={{
            position: 'absolute',
            inset: 14,
            borderRadius: '50%',
            border: '1px solid rgba(196,72,91,0.25)',
          }}
        />
        <div
          style={{
            width: 74,
            height: 74,
            borderRadius: '50%',
            background: 'linear-gradient(135deg, #D94B63, #AD3549)',
            boxShadow: '0 10px 24px rgba(217,75,99,0.35)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: '#fff',
            fontSize: 15,
            fontWeight: 800,
            letterSpacing: 1,
          }}
        >
          SOS
        </div>
      </div>

      <div style={{ fontSize: 8.5, color: 'var(--lp-text-secondary)', lineHeight: 1.5, marginTop: 22 }}>
        Press and confirm to send your location to an emergency responder
      </div>

      <div
        style={{
          marginTop: 'auto',
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          background: '#EEF6F1',
          padding: '7px 12px',
          borderRadius: 999,
        }}
      >
        <MapPin size={11} color="#4F9D78" strokeWidth={2} />
        <span style={{ fontSize: 8, fontWeight: 700, color: '#4F9D78' }}>Location sharing ready</span>
      </div>
    </div>
  );
}

const MOCK_CASES = [
  { number: 'CN-2026-0148', type: 'Harassment', status: 'Under Review', color: '#4C7EA8', bg: '#EAF1F7' },
  { number: 'CN-2026-0121', type: 'Physical Abuse', status: 'Assigned', color: '#1456A0', bg: '#EAF3FB' },
  { number: 'CN-2026-0098', type: 'Economic Abuse', status: 'Resolved', color: '#4F9D78', bg: '#EAF5EE' },
];

function CaseTrackingMock() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', padding: '36px 14px 16px' }}>
      <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--lp-text-heading)', marginBottom: 14 }}>
        My Cases
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {MOCK_CASES.map((c) => (
          <div
            key={c.number}
            style={{ background: '#fff', border: '1px solid var(--lp-border)', borderRadius: 10, padding: '9px 10px' }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: 8.5, fontWeight: 700, color: 'var(--lp-text-primary)' }}>{c.number}</span>
              <span
                style={{
                  fontSize: 6.5,
                  fontWeight: 700,
                  color: c.color,
                  background: c.bg,
                  padding: '2px 6px',
                  borderRadius: 999,
                }}
              >
                {c.status}
              </span>
            </div>
            <div style={{ fontSize: 7.5, color: 'var(--lp-text-secondary)', marginTop: 3 }}>{c.type}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

// A working system, not a concept — three CSS-built phone frames (never
// real screenshots, so they can't go stale) reproducing the actual copy,
// status vocabulary, and layout of the shipped Home, Emergency SOS, and
// Case Tracking screens with illustrative sample data.
export function AppPreview() {
  return (
    <div className="app-preview-row">
      <PhoneMockup label="Emergency SOS" variant="side-left">
        <SosScreenMock />
      </PhoneMockup>
      <PhoneMockup label="Home" variant="center">
        <HomeScreenMock />
      </PhoneMockup>
      <PhoneMockup label="Case Tracking" variant="side-right">
        <CaseTrackingMock />
      </PhoneMockup>
    </div>
  );
}

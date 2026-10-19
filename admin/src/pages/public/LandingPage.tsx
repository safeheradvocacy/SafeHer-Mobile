import React, { useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  AlertCircle,
  FileLock2,
  ClipboardList,
  Heart,
  Lock,
  KeyRound,
  EyeOff,
  Users,
  FileEdit,
  HeartHandshake,
  LayoutDashboard,
  ShieldCheck,
  ArrowRight,
  ChevronRight,
} from 'lucide-react';
import { LogoMark } from '../../components/branding/Logo';
import { Navbar } from './components/Navbar';
import { AnimatedBackground } from './components/AnimatedBackground';
import { AnimatedSecurityVisual } from './components/AnimatedSecurityVisual';
import { HeroConnections } from './components/HeroConnections';
import { FeatureCard } from './components/FeatureCard';
import { AppPreview } from './components/AppPreview';
import { HeroCallouts } from './components/HeroCallouts';
import { Reveal } from './components/Reveal';
import auroraOfficePhoto from '../../assets/institutional/aurora-office.png';
import auroraSeal from '../../assets/institutional/aurora-province-seal.png';
import pswdoLogo from '../../assets/institutional/pswdo-logo.png';

// The province's actual eight municipalities (Baler is the capital) — a
// factual list of the geographic area SafeSpace is designed to serve, not a
// claim that every municipality currently has an active service facility.
const AURORA_MUNICIPALITIES = [
  'Baler', 'Casiguran', 'Dilasag', 'Dinalungan', 'Dingalan', 'Dipaculao', 'Maria Aurora', 'San Luis',
];

const FEATURES = [
  { icon: AlertCircle, title: 'Emergency SOS', description: 'Request emergency assistance when needed.', iconAnimClass: 'icon-anim-sos' },
  { icon: ClipboardList, title: 'Case Tracking', description: 'Monitor case progress securely.', iconAnimClass: 'icon-anim-case' },
  { icon: FileLock2, title: 'Secure Reporting', description: 'Submit information through a confidential process.', iconAnimClass: 'icon-anim-report' },
  { icon: Heart, title: 'Support Resources', description: 'Find relevant support resources.', iconAnimClass: 'icon-anim-support' },
];

const ABOUT_POINTS = [
  { icon: EyeOff, title: 'Confidential Support', description: 'Your information is protected and shared only as needed to help you.' },
  { icon: HeartHandshake, title: 'Accessible Assistance', description: 'Reach support and referrals from wherever you are, whenever you need it.' },
  { icon: ClipboardList, title: 'Secure Case Management', description: 'Your case is tracked and handled by authorized personnel only.' },
];

const PRIVACY_POINTS = [
  { icon: Lock, label: 'Secure data' },
  { icon: KeyRound, label: 'Authorized access' },
  { icon: EyeOff, label: 'Confidential reporting' },
  { icon: Users, label: 'Role-based access' },
];

const STEPS = [
  { icon: FileEdit, title: 'Report', description: 'A person submits an incident report confidentially or anonymously.' },
  { icon: ClipboardList, title: 'Review', description: "Authorized personnel review the submitted report according to their role and jurisdiction." },
  { icon: HeartHandshake, title: 'Support / Referral', description: "Appropriate assistance, services, and referrals are coordinated based on the person's needs." },
  { icon: LayoutDashboard, title: 'Case Tracking', description: 'The person who reported can monitor the status and progress of their case.' },
];

export function LandingPage() {
  return (
    <div className="landing-page">
      <a href="#main" className="skip-link">
        Skip to main content
      </a>

      <Navbar />

      <main id="main">
        <Hero />
        <Reveal>
          <About />
        </Reveal>
        {/* Higher threshold than the default 0.15 — this section's reveal
            is a ~2s sequential choreography (see .feature-step-item in
            theme.css), and at 0.15 it was firing as soon as a sliver of
            the section entered view, often finishing before the user's
            scroll (especially a nav-click smooth-scroll) actually settled
            on it. 0.4 waits for a substantially larger, more "arrived at"
            portion of the section to be visible first. */}
        <Reveal threshold={0.4}>
          <Features />
        </Reveal>
        {/* Same reasoning as Features above — this section's guided-journey
            sequence runs ~3-3.5s, so it needs a later trigger than the
            default 0.15 to avoid finishing before the user's scroll
            actually settles on it. */}
        <Reveal threshold={0.4}>
          <HowItWorks />
        </Reveal>
        <Reveal>
          <ProvinceWideSupport />
        </Reveal>
        <Reveal>
          <AppPreviewSection />
        </Reveal>
        <Reveal>
          <Privacy />
        </Reveal>
        <Reveal>
          <CallToAction />
        </Reveal>
      </main>

      <Footer />
    </div>
  );
}

function Hero() {
  const navigate = useNavigate();
  const heroRef = useRef<HTMLElement>(null);
  const shieldRef = useRef<HTMLDivElement>(null);
  return (
    <section
      ref={heroRef}
      className="hero-centered"
      style={{
        position: 'relative',
        overflow: 'hidden',
        // Back to the original expression — a prior pass capped this with
        // min(560px, ...) specifically to force everything above the fold,
        // which read as cramped. Readability/breathing room now take
        // priority over fitting one screen; it's fine for the hero to run
        // past the fold and require a small scroll.
        minHeight: 'calc(100vh - 80px)',
        scrollMarginTop: 80,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '32px 24px',
        background:
          'radial-gradient(circle at 10% 12%, rgba(169,203,234,0.18), transparent 40%), ' +
          'radial-gradient(circle at 88% 18%, rgba(20,86,160,0.10), transparent 42%), ' +
          'var(--lp-gradient-hero)',
      }}
    >
      {/* The shield (AnimatedSecurityVisual) is stationary — a soft halo
          pulse, nothing that orbits or rotates. HeroConnections draws the
          four curved pathways from HeroCallouts' labels to that halo, so
          the two stay visually tied together; order matters here since it
          sets the stacking (background, then pathways, then labels, then
          the centered shield/heading column, which carries its own
          z-index: 3). */}
      <AnimatedBackground />
      <HeroConnections heroRef={heroRef} shieldRef={shieldRef} />
      <HeroCallouts />
      <div
        className="container"
        style={{
          position: 'relative',
          zIndex: 3,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          textAlign: 'center',
          maxWidth: 700,
        }}
      >
        <AnimatedSecurityVisual shieldRef={shieldRef} />

        <span className="lp-support-label lp-reveal-in d1" style={{ marginTop: 14 }}>
          <Heart size={13} fill="currentColor" /> You're not alone. We're here for you.
        </span>
        <h1 className="lp-hero-heading lp-reveal-in d2">
          Your safety.
          <br />
          Your voice.
          <br />
          Your <span style={{ color: '#2F80C9' }}>support.</span>
        </h1>
        <p className="lp-hero-description lp-reveal-in d3" style={{ marginTop: 20 }}>
          SafeSpace is a confidential digital platform connecting people experiencing abuse or violence across
          Aurora Province with appropriate assistance, protection, referrals, and essential services.
        </p>
        <div className="lp-reveal-in d4" style={{ display: 'flex', gap: 14, marginTop: 28, flexWrap: 'wrap', justifyContent: 'center' }}>
          {/* SafeSpace's survivor-facing experience is the mobile app, not a
              web flow — there's no separate "user app" page to route to
              here, so Get Support takes visitors to the section that
              actually explains what they'd be getting started with. */}
          <a href="#how-safespace-helps" className="btn btn-primary btn-lg">
            Get Support
            <span className="btn-icon">
              <ArrowRight size={17} />
            </span>
          </a>
          <button className="btn btn-outline btn-lg" onClick={() => navigate('/admin/login')}>
            <ShieldCheck size={16} />
            Admin Portal
          </button>
        </div>
      </div>
    </section>
  );
}

function About() {
  return (
    <section id="about" className="section-sm about-section" style={{ position: 'relative' }}>
      {/* Full-bleed ambient layer — texture only, heavily blurred + a
          violet overlay, spans the whole section including behind the
          context cards. This is the only place aurora-office.png appears
          on this page (a separate crisp framed copy used to sit in the
          right column too — removed to stop showing the same photo
          twice). Text never sits on this layer directly, only inside the
          solid panels/cards on top of it. */}
      <div className="about-section-bg" aria-hidden="true">
        <div className="about-ambient-photo" style={{ backgroundImage: `url(${auroraOfficePhoto})` }} />
        <div className="about-ambient-overlay" />
        <div className="about-ambient-grain" />
      </div>

      <div className="container grid-2 lp-split about-grid" style={{ alignItems: 'start', gap: 32, position: 'relative', zIndex: 1 }}>
        <div className="about-text-col">
          <div className="about-text-panel">
            <div className="about-heading-reveal institutional-eyebrow">About SafeSpace</div>
            <div className="about-heading-reveal">
              <EyebrowUnderline />
            </div>
            <h2 className="about-heading-reveal lp-section-heading" style={{ fontSize: 32, marginTop: 8 }}>
              About SafeSpace
            </h2>
            <p className="about-para-reveal lp-section-description" style={{ marginTop: 12 }}>
              SafeSpace is a confidential digital platform designed to support people experiencing abuse or
              violence and connect them with appropriate assistance, protection, referrals, and essential services
              across Aurora Province.
            </p>
            <p className="about-para-reveal lp-section-description" style={{ marginTop: 6 }}>
              The platform is designed to support secure reporting, case monitoring, and coordination with
              authorized personnel and appropriate social welfare and support services.
            </p>
          </div>

          <div className="about-feature-cards" style={{ marginTop: 14 }}>
            {ABOUT_POINTS.map(({ icon: Icon, title, description }) => (
              <div key={title} className="stagger-item-left">
                <div className="about-point-card">
                  <div className="about-point-icon">
                    <Icon size={18} color="var(--lp-purple)" strokeWidth={1.75} />
                  </div>
                  <div>
                    <div className="lp-card-heading" style={{ fontSize: 15 }}>{title}</div>
                    <p className="lp-card-description" style={{ marginTop: 2, fontSize: 13.5 }}>{description}</p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="about-context-col">
          {/* Context cards — Aurora seal / PSWDO, previously a separate
              section, now merged into this column. Reveal is deliberately
              distinct from the feature cards: the two converge from
              opposite sides rather than both sliding the same direction. */}
          <div className="about-context-cards">
            <div className="context-card-left">
              <div className="institutional-card">
                <img src={auroraSeal} alt="Official seal of the Province of Aurora" className="institutional-logo" />
                <div>
                  <div className="institutional-eyebrow">Provincial Context</div>
                  <EyebrowUnderline />
                  <h3 className="lp-card-heading" style={{ fontSize: 17, marginTop: 6 }}>
                    Serving Aurora Province
                  </h3>
                  <p className="lp-card-description" style={{ marginTop: 4 }}>
                    SafeSpace is designed to help connect people seeking support throughout Aurora Province's
                    municipalities — including Baler, Casiguran, Dilasag, Dinalungan, Dingalan, Dipaculao, Maria
                    Aurora, and San Luis — with appropriate assistance and services.
                  </p>
                </div>
              </div>
            </div>
            <div className="context-card-right">
              <div className="institutional-card">
                <img
                  src={pswdoLogo}
                  alt="Provincial Social Welfare and Development Office - Aurora logo"
                  className="institutional-logo"
                />
                <div>
                  <div className="institutional-eyebrow">Social Welfare Coordination</div>
                  <EyebrowUnderline />
                  <h3 className="lp-card-heading" style={{ fontSize: 17, marginTop: 6 }}>
                    Provincial Social Welfare and Development Office (PSWDO) – Aurora
                  </h3>
                  <p className="lp-card-description" style={{ marginTop: 4 }}>
                    SafeSpace is designed to support coordination with appropriate provincial social welfare and
                    protection services.
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

// Draws in left-to-right via stroke-dashoffset once the card's parent
// .lp-scroll-reveal gets .is-visible (see .institutional-eyebrow-underline
// in theme.css for the timing) — the same technique as the hero's
// connector-line callouts, reused here for a consistent motion language.
// viewBox is exactly 0-100 wide so the line's own path length equals
// stroke-dasharray without needing to measure it.
function EyebrowUnderline() {
  return (
    <svg className="institutional-eyebrow-underline" viewBox="0 0 100 3" preserveAspectRatio="none" aria-hidden="true">
      <line x1="0" y1="1.5" x2="100" y2="1.5" />
    </svg>
  );
}

function Features() {
  return (
    <section
      id="how-safespace-helps"
      className="section"
      style={{
        position: 'relative',
        overflow: 'hidden',
        // Was its own richer, more saturated inline gradient distinct from
        // --lp-gradient-features — now that the shared token is already an
        // extremely subtle blue tonal shift (per the minimalist brief),
        // this section just uses it directly rather than carrying a
        // second, busier gradient on top.
        background: 'var(--lp-gradient-features)',
      }}
    >
      <div className="container">
        <h2 className="lp-section-heading" style={{ fontSize: 32, textAlign: 'center' }}>
          How SafeSpace Helps
        </h2>
        {/* Progress connector for the 4-step flow below — a single fill
            bar (not 4 segments threaded precisely through each card's
            icon, which would break the moment the grid reflows to 2 or 1
            columns) with 3 tick marks dividing it into the 4 steps.
            Desktop-only (see theme.css) since a left-to-right bar stops
            making sense once the cards wrap/stack. */}
        <div className="feature-flow-track" aria-hidden="true" style={{ marginTop: 36 }}>
          <span className="feature-flow-tick" style={{ left: '25%' }} />
          <span className="feature-flow-tick" style={{ left: '50%' }} />
          <span className="feature-flow-tick" style={{ left: '75%' }} />
          <div className="feature-flow-dot" />
        </div>
        <div className="grid-4" style={{ marginTop: 24 }}>
          {FEATURES.map((f) => (
            <div key={f.title} className="feature-step-item">
              <FeatureCard icon={f.icon} title={f.title} description={f.description} iconAnimClass={f.iconAnimClass} />
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function Privacy() {
  return (
    <section id="privacy" className="section-sm" style={{ background: 'var(--lp-gradient-privacy)' }}>
      <div className="container grid-2 lp-split" style={{ alignItems: 'center', gap: 48 }}>
        <div
          aria-hidden="true"
          style={{
            position: 'relative',
            width: 220,
            height: 220,
            maxWidth: '100%',
            margin: '0 auto',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <div
            className="security-ring ring-2"
            style={{ width: 220, height: 220, borderColor: 'var(--lp-violet-light)' }}
          />
          <div
            className="security-ring ring-3"
            style={{ width: 180, height: 180, borderColor: 'var(--lp-violet-light)' }}
          />
          <div
            style={{
              position: 'absolute',
              width: 130,
              height: 130,
              borderRadius: '50%',
              background: 'linear-gradient(135deg, #2F80C9, #0B3A82)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              boxShadow: '0 12px 26px rgba(8,28,58,0.22)',
            }}
          >
            <ShieldCheck size={56} color="#fff" strokeWidth={1.75} />
          </div>
          <div
            className="floating-chip chip-location"
            style={{ top: '4%', left: '78%', animationDelay: '0.5s' }}
          >
            <div
              className="chip-inner"
              style={{ background: '#FFFFFF', border: '1px solid #D3E6F7', boxShadow: '0 6px 16px rgba(8,28,58,0.1)' }}
            >
              <Lock size={16} color="#2F80C9" strokeWidth={1.75} />
            </div>
          </div>
        </div>
        <div>
          <h2 className="lp-section-heading" style={{ fontSize: 32 }}>
            Your Privacy Matters
          </h2>
          <p className="lp-section-description" style={{ marginTop: 16 }}>
            SafeSpace is designed with privacy and security in mind. Sensitive information is accessible only to
            authorized personnel according to their role and jurisdiction.
          </p>
          <div className="grid-2" style={{ marginTop: 24, gap: 12 }}>
            {PRIVACY_POINTS.map(({ icon: Icon, label }) => (
              <div key={label} className="stagger-item">
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 10,
                    padding: '12px 14px',
                    borderRadius: 12,
                    background: 'var(--lp-bg-card)',
                    border: '1px solid var(--lp-border)',
                  }}
                >
                  <Icon size={18} color="var(--lp-purple)" strokeWidth={1.75} />
                  <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--lp-text-primary)' }}>{label}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

function HowItWorks() {
  return (
    <section
      className="section"
      style={{ background: 'var(--lp-gradient-about)' }}
    >
      <div className="container">
        <h2 className="lp-section-heading" style={{ fontSize: 32, textAlign: 'center' }}>
          How It Works
        </h2>
        {/* Guided case journey — the 4 steps and connector are always laid
            out (visible immediately, including under reduced motion; see
            theme.css), and the sequence plays as an activation overlay on
            top of that static structure: the connector fill travels left
            to right, each icon pulses+glows as the fill reaches it, then
            settles into a subtle "completed" tint that persists as the
            fill moves on to the next step. */}
        <div className="how-it-works-row" style={{ marginTop: 40 }}>
          {STEPS.map(({ icon: Icon, title, description }, i) => (
            <React.Fragment key={title}>
              <div className={`hiw-step-item hiw-step-${i} how-it-works-step-wrap`}>
                <div className="how-it-works-step" style={{ textAlign: 'center' }}>
                  <div
                    className="how-it-works-icon"
                    style={{
                      width: 52,
                      height: 52,
                      borderRadius: '50%',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      margin: '0 auto',
                    }}
                  >
                    <Icon size={22} color="var(--lp-purple)" strokeWidth={1.75} />
                  </div>
                  <h3 className="lp-card-heading hiw-step-title" style={{ fontSize: 16, marginTop: 14 }}>
                    {title}
                  </h3>
                  <p className="lp-card-description hiw-step-desc" style={{ marginTop: 6 }}>
                    {description}
                  </p>
                </div>
              </div>
              {i < STEPS.length - 1 && (
                <div className={`how-it-works-connector hiw-connector-${i}`} aria-hidden="true">
                  <span className="connector-line" />
                  <span className="hiw-connector-fill" />
                  <ChevronRight size={14} strokeWidth={2.5} />
                  <span className="connector-line" />
                </div>
              )}
            </React.Fragment>
          ))}
        </div>
      </div>
    </section>
  );
}

function ProvinceWideSupport() {
  return (
    <section className="section-sm province-support-section" style={{ position: 'relative', overflow: 'hidden' }}>
      {/* Depth layer — two large, softly blurred blobs (lavender + pink,
          same palette as the pills' hover/active state below) sitting
          behind everything else, purely for a bit of atmosphere against
          the section's own gradient. */}
      <div aria-hidden="true" className="province-bg-blobs">
        <div className="province-blob province-blob-1" />
        <div className="province-blob province-blob-2" />
      </div>
      {/* Abstract, deliberately non-literal "map-inspired" shape — not a
          traced outline of Aurora Province. Drawing an actual province
          outline without a verified source risked showing inaccurate
          geography; an irregular soft-edged blob (CSS border-radius
          trick, not an SVG path) reads as "a coverage area" without
          claiming cartographic accuracy, at low enough opacity that it's
          felt more than seen. */}
      <div aria-hidden="true" className="province-map-shape" />
      {/* Same reasoning as above, for the floating node particles. */}
      <div aria-hidden="true" className="province-visual">
        {[...Array(9)].map((_, i) => (
          <span key={i} className={`province-node province-node-${(i % 3) + 1}`} />
        ))}
      </div>
      <div className="container" style={{ position: 'relative', zIndex: 1, maxWidth: 720, textAlign: 'center' }}>
        <h2 className="lp-section-heading" style={{ fontSize: 32 }}>
          Support Across Aurora Province
        </h2>
        <p
          className="lp-section-description"
          style={{ marginTop: 12, maxWidth: 580, marginLeft: 'auto', marginRight: 'auto', lineHeight: 1.6 }}
        >
          SafeSpace is designed to help connect people experiencing abuse or violence with appropriate assistance
          and services across Aurora Province's municipalities, coordinating with authorized personnel based on
          jurisdiction and need.
        </p>
      </div>
      {/* Own (wider) container than the heading/description above — all 8
          municipality names need more horizontal room than the 720px
          reading-width column comfortably allows for a single unbroken
          row; keeping the heading/paragraph at their narrower, more
          readable width while giving just this row extra breathing room. */}
      <div className="container municipality-row-container" style={{ position: 'relative', zIndex: 1 }}>
        <div className="municipality-chip-row">
          {AURORA_MUNICIPALITIES.map((m) => (
            <div key={m} className="municipality-chip-wrap">
              <span className="municipality-chip">{m}</span>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function AppPreviewSection() {
  return (
    <section className="section" style={{ background: 'var(--lp-gradient-features)' }}>
      <div className="container">
        <h2 className="lp-section-heading" style={{ fontSize: 32, textAlign: 'center' }}>
          See SafeSpace in Action
        </h2>
        <p
          className="lp-section-description"
          style={{ marginTop: 12, textAlign: 'center', maxWidth: 520, marginLeft: 'auto', marginRight: 'auto' }}
        >
          A real, working mobile application — designed so people can reach help, report incidents, and follow
          their case with confidence.
        </p>
        <AppPreview />
      </div>
    </section>
  );
}

function CallToAction() {
  return (
    <section
      className="section-sm privacy-cta-section"
      style={{ position: 'relative', overflow: 'hidden', textAlign: 'center', background: 'var(--lp-gradient-cta)' }}
    >
      <div aria-hidden="true" style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}>
        <div
          className="bg-blob-h"
          style={{ width: 300, height: 300, top: -100, left: -60, background: 'rgba(255,255,255,0.06)', filter: 'blur(60px)' }}
        />
        <div
          className="bg-blob-v"
          style={{ width: 260, height: 260, bottom: -100, right: -60, background: 'rgba(255,255,255,0.05)', filter: 'blur(60px)' }}
        />
        <div
          className="bg-blob-d"
          style={{ width: 220, height: 220, top: '30%', right: '18%', background: 'rgba(47,128,201,0.08)', filter: 'blur(50px)' }}
        />
      </div>
      <div className="container" style={{ maxWidth: 560, position: 'relative', zIndex: 1 }}>
        <h2 className="lp-section-heading" style={{ fontSize: 32, color: '#fff' }}>
          You don't have to face it alone.
        </h2>
        <p style={{ fontSize: 17, color: 'rgba(255,255,255,0.88)', marginTop: 18, lineHeight: 1.7 }}>
          SafeSpace is here to help you find support, protection, and the resources you need.
        </p>
        <p
          style={{
            fontSize: 14,
            color: 'rgba(255,255,255,0.72)',
            marginTop: 14,
            lineHeight: 1.65,
            maxWidth: 460,
            marginLeft: 'auto',
            marginRight: 'auto',
          }}
        >
          SafeSpace is designed to help you access confidential support, secure reporting, referrals, and essential
          services across Aurora Province.
        </p>
        <a href="#how-safespace-helps" className="btn btn-lg btn-on-dark" style={{ marginTop: 36 }}>
          Get Support
        </a>
      </div>
    </section>
  );
}

function Footer() {
  return (
    <footer style={{ background: '#0B3A82', color: '#fff' }}>
      <div className="container footer-grid" style={{ maxWidth: 900, padding: '64px 24px 48px' }}>
        <div style={{ maxWidth: 320 }}>
          {/* Symbol only, no "SafeSpace" text beside it: the footer
              background is the same dark navy (#0B3A82) the mark's own
              wordmark ink has too little contrast against, and the
              copyright line further down this same footer already spells
              out "SafeSpace" in plain text. */}
          <LogoMark size={40} tone="onDark" />
          <p style={{ fontSize: 13, color: 'rgba(255,255,255,0.75)', marginTop: 12, lineHeight: 1.6 }}>
            A confidential digital support platform designed to connect people experiencing abuse or violence
            across Aurora Province with appropriate support, protection, referrals, and essential services.
          </p>
          <div className="footer-institutional-logos">
            <img src={auroraSeal} alt="Province of Aurora seal" />
            <img src={pswdoLogo} alt="PSWDO Aurora logo" />
          </div>
        </div>
        <nav aria-label="Quick links">
          <div className="footer-heading">Quick Links</div>
          <a href="#about" className="footer-link">
            About
          </a>
          <a href="#how-safespace-helps" className="footer-link">
            How SafeSpace Helps
          </a>
          <a href="#privacy" className="footer-link">
            Privacy
          </a>
        </nav>
        <nav aria-label="Admin">
          <div className="footer-heading">Admin</div>
          <a href="/admin/login" className="footer-link">
            Admin Portal
          </a>
        </nav>
      </div>
      <div style={{ borderTop: '1px solid rgba(255,255,255,0.14)', padding: '20px 24px', textAlign: 'center' }}>
        <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.6)' }}>
          © {new Date().getFullYear()} SafeSpace. All rights reserved.
        </span>
      </div>
    </footer>
  );
}

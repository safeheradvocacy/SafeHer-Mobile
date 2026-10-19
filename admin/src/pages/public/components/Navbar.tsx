import React, { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { LogoMark } from '../../../components/branding/Logo';

const LINKS = [
  { id: 'about', label: 'About' },
  { id: 'how-safespace-helps', label: 'How SafeSpace Helps' },
  { id: 'privacy', label: 'Privacy' },
];

export function Navbar() {
  const navigate = useNavigate();
  const headerRef = useRef<HTMLElement | null>(null);
  const [scrolled, setScrolled] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [activeSection, setActiveSection] = useState<string | null>(null);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  useEffect(() => {
    const sections = LINKS.map((l) => document.getElementById(l.id)).filter(
      (el): el is HTMLElement => el !== null
    );
    if (sections.length === 0) return;

    // Treat a section as "active" once it crosses a thin band near the
    // vertical middle of the viewport, rather than requiring it to fill
    // the whole screen — the usual scroll-spy trick.
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries.filter((e) => e.isIntersecting);
        if (visible.length > 0) {
          const topMost = visible.reduce((a, b) => (a.boundingClientRect.top < b.boundingClientRect.top ? a : b));
          setActiveSection(topMost.target.id);
        }
      },
      { rootMargin: '-40% 0px -50% 0px', threshold: 0 }
    );
    sections.forEach((el) => observer.observe(el));
    return () => observer.disconnect();
  }, []);

  // Close on an outside click/tap or Escape — only wired up while the menu
  // is actually open, so it costs nothing on desktop or while closed.
  useEffect(() => {
    if (!menuOpen) return;
    const onPointerDown = (e: PointerEvent) => {
      if (headerRef.current && !headerRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMenuOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [menuOpen]);

  return (
    <header ref={headerRef} className={`site-header${scrolled ? ' scrolled' : ''}`}>
      <div className="site-header-inner">
        {/* Symbol only, no "SafeSpace" text beside it — this header is only
            ~68-88px tall, well under the ~140px+ the full mark+wordmark
            asset needs for its baked-in text to stay legible (verified by
            decoding the asset: the wordmark strip is only the bottom ~12%
            of its square canvas). The hero immediately below names
            SafeSpace in full-size text, so the icon alone doesn't leave a
            first-time visitor guessing. */}
        <LogoMark size={44} />

        <button
          className={`nav-menu-toggle${menuOpen ? ' open' : ''}`}
          aria-label={menuOpen ? 'Close navigation menu' : 'Open navigation menu'}
          aria-expanded={menuOpen}
          aria-controls="primary-nav"
          onClick={() => setMenuOpen((v) => !v)}
        >
          <span className="hamburger-box" aria-hidden="true">
            <span className="hamburger-bar" />
            <span className="hamburger-bar" />
            <span className="hamburger-bar" />
          </span>
        </button>

        {/* Two Admin Portal buttons rather than one reparented via CSS: the
            mobile version has to live *inside* the toggled dropdown (last
            item in the stack), while the desktop version has to live
            *outside* nav-links-row as its own grid column so the links can
            be centered independently of it — those are two different DOM
            nestings, not just two different styles, so a single shared
            element can't satisfy both. Each copy is display:none at the
            other breakpoint, so only one is ever visible/focusable at once. */}
        <nav id="primary-nav" aria-label="Primary" className={`nav-links-row${menuOpen ? ' open' : ''}`}>
          {LINKS.map((link) => (
            <a
              key={link.id}
              href={`#${link.id}`}
              className={`nav-link${activeSection === link.id ? ' active' : ''}`}
              aria-current={activeSection === link.id ? 'true' : undefined}
              onClick={() => setMenuOpen(false)}
            >
              {link.label}
            </a>
          ))}
          <button
            className="btn btn-outline btn-sm nav-admin-btn nav-admin-btn-mobile"
            onClick={() => {
              setMenuOpen(false);
              navigate('/admin/login');
            }}
          >
            Admin Portal
          </button>
        </nav>

        <button
          className="btn btn-outline btn-sm nav-admin-btn nav-admin-btn-desktop"
          onClick={() => navigate('/admin/login')}
        >
          Admin Portal
        </button>
      </div>
    </header>
  );
}

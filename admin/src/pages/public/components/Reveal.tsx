import React, { useEffect, useRef, useState } from 'react';

/**
 * Fades + rises a section into place the first time it scrolls into view.
 * Plain IntersectionObserver — no animation library, unobserves itself once
 * triggered (one-shot, not a repeating scroll listener). `prefers-reduced-
 * motion` is handled entirely in CSS (`.lp-scroll-reveal` in theme.css), so
 * a reduced-motion user still gets `is-visible` applied correctly, they
 * just see no transition.
 *
 * `threshold` defaults to 0.15 (fires as soon as a sliver of the section is
 * in view) — fine for a simple one-shot fade, but too early for a section
 * whose reveal is a multi-second choreographed sequence: at 0.15 the
 * animation can finish scrolling-in before the user's eyes (or a nav-click
 * smooth-scroll) actually settle on it, making it look like nothing
 * animated at all. Pass a higher threshold (e.g. 0.4) for those sections.
 */
export function Reveal({
  children,
  className = '',
  threshold = 0.15,
}: {
  children: React.ReactNode;
  className?: string;
  threshold?: number;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setVisible(true);
          observer.unobserve(el);
        }
      },
      { threshold }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [threshold]);

  return (
    <div ref={ref} className={`lp-scroll-reveal${visible ? ' is-visible' : ''} ${className}`}>
      {children}
    </div>
  );
}

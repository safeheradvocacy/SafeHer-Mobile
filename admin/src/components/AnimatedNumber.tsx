import React, { useEffect, useRef, useState } from 'react';

const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)';

/**
 * Counts up from 0 to `value` on mount (i.e. the moment a KPI card
 * receives its first real number after loading), and from the previous
 * value to a new one if `value` changes later (e.g. after a refresh) —
 * never a continuous/looping animation, just one run per value change.
 * Skipped entirely under prefers-reduced-motion, which jumps straight to
 * the target.
 */
export function AnimatedNumber({
  value,
  duration = 700,
  formatter,
}: {
  value: number;
  duration?: number;
  formatter?: (n: number) => string;
}) {
  const [display, setDisplay] = useState(0);
  const fromRef = useRef(0);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    const prefersReduced = typeof window !== 'undefined' && window.matchMedia?.(REDUCED_MOTION_QUERY).matches;
    if (prefersReduced) {
      fromRef.current = value;
      setDisplay(value);
      return;
    }

    const from = fromRef.current;
    if (from === value) return;
    const start = performance.now();

    const tick = (now: number) => {
      const elapsed = now - start;
      const t = Math.min(1, elapsed / duration);
      // ease-out-cubic
      const eased = 1 - Math.pow(1 - t, 3);
      setDisplay(Math.round(from + (value - from) * eased));
      if (t < 1) {
        rafRef.current = requestAnimationFrame(tick);
      } else {
        fromRef.current = value;
      }
    };
    rafRef.current = requestAnimationFrame(tick);

    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, duration]);

  return <>{formatter ? formatter(display) : display}</>;
}

import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import type { RefObject } from 'react';
import type { View } from 'react-native';
import { hasCompletedTour, markTourComplete } from '../lib/appTour';

/**
 * The first-time in-app feature tour — Welcome, then a spotlight on
 * each real navigation destination/action. Every step below matches an
 * actual screen/control that exists today (verified against
 * navigation/types.ts, AppNavigator.tsx, and each screen's real
 * behavior) — nothing invented, no unsupported claims (SOS copy states
 * only what's actually true: no verification required, separate from a
 * normal incident report; shelter-request copy never implies
 * guaranteed approval). There is exactly one role-relevant tour because
 * there is exactly one real navigation/feature set in this app today
 * (confirmed: no other role-conditional screen exists anywhere in
 * mobile/src) — building role branches for roles that don't actually
 * navigate this app would itself be inventing navigation items.
 */
export interface TourStep {
  id: string;
  title: string;
  body: string;
  /** Key into `targets` below — omitted for steps with no single real
   * element to spotlight (Welcome, and Profile's final step, which
   * spotlights the whole header actions cluster rather than one icon). */
  targetKey?: string;
}

export const TOUR_STEPS: TourStep[] = [
  {
    id: 'welcome',
    title: 'Welcome to SafeSpace',
    body: 'A secure platform for reporting incidents, tracking your cases, finding available shelters, and getting emergency help.',
  },
  {
    id: 'home',
    title: 'Home',
    body: 'Your starting point for quick access to SafeSpace services, your recent case information, and important actions.',
    targetKey: 'home',
  },
  {
    id: 'report',
    title: 'Report an Incident',
    body: 'Submit a formal incident report for case management. This follows the same account requirements already in place elsewhere in the app, and is separate from Emergency SOS.',
    targetKey: 'reportIncident',
  },
  {
    id: 'cases',
    title: 'My Cases',
    body: 'View your submitted cases and follow their current status.',
    targetKey: 'tab:CasesTab',
  },
  {
    id: 'sos',
    title: 'Emergency SOS',
    body: "Use this when you need immediate emergency assistance. SOS goes directly to SafeSpace's emergency response workflow — it does not require account verification, and it is separate from a normal incident report.",
    targetKey: 'tab:SosTab',
  },
  {
    id: 'assistant',
    title: 'SafeSpace Assistant',
    body: 'Ask questions and get guidance through the SafeSpace Assistant.',
    targetKey: 'tab:ChatTab',
  },
  {
    id: 'shelters',
    title: 'Shelters',
    body: 'Explore available shelters, including location, capacity, and services.',
    targetKey: 'tab:SheltersTab',
  },
  {
    id: 'profile',
    title: 'Profile',
    body: 'Manage your account information, survivor information, and available settings.',
    targetKey: 'profile',
  },
];

export interface TargetRect {
  x: number;
  y: number;
  width: number;
  height: number;
  /** Visual hint so the spotlight outlines the target's own shape instead
   * of a generic rounded rectangle — 'circle' for round controls (the
   * profile avatar), 'pill' for the stadium-shaped tab items, 'rounded'
   * (the default) for cards/text blocks. Presentation metadata only;
   * does not affect measurement, persistence, or navigation. */
  shape?: 'circle' | 'pill' | 'rounded';
  /** Corner radius to use when shape is 'rounded', matching the real
   * element's own radius (e.g. a quick-action card highlights with the
   * same radius it renders with). Ignored for 'circle'/'pill', which are
   * computed from the target's own height. */
  radius?: number;
}

interface TourContextValue {
  active: boolean;
  stepIndex: number;
  steps: TourStep[];
  targets: Record<string, TargetRect>;
  registerTarget: (key: string, rect: TargetRect) => void;
  /** Hands the overlay a live reference to the real element, in addition
   * to whatever rect onLayout already pushed — `measureInWindow` only
   * reflects the window position at the instant it's called, so a rect
   * captured once at mount can go stale (Home's content is a
   * ScrollView: scrolling, slower data arriving and changing a card's
   * height, anything that reflows the page after registration) without
   * anything telling the overlay to re-check. Keeping the ref around
   * lets every target get re-measured fresh right before it's actually
   * needed — see the step-change effect below — instead of trusting
   * however old that one push happened to be. */
  registerTargetRef: (key: string, ref: RefObject<View | null>) => void;
  /** Called once, from Home, after the first successful load. No-ops
   * silently if already completed or already checked this session. */
  startIfNeeded: (profileId: string) => void;
  /** Profile > App Guide > "Take the Tour". */
  replay: (profileId: string) => void;
  next: () => void;
  /** Used by the overlay's own Skip button AND, identically, by any
   * real navigation interaction (a tab press, the SOS card) that
   * should immediately hand control back to the real app — per the
   * brief, an interrupted tour must never resurface on its own. */
  skip: () => void;
}

const TourContext = createContext<TourContextValue | undefined>(undefined);

export function TourProvider({ children }: { children: React.ReactNode }) {
  const [active, setActive] = useState(false);
  const [stepIndex, setStepIndex] = useState(0);
  const [targets, setTargets] = useState<Record<string, TargetRect>>({});
  const targetsRef = useRef<Record<string, TargetRect>>({});
  const refsRef = useRef<Record<string, RefObject<View | null>>>({});
  const activeProfileIdRef = useRef<string | null>(null);
  // Guards against re-checking AsyncStorage every time Home re-focuses
  // within the same app session, once we've already decided for this
  // profile this session.
  const checkedRef = useRef<Set<string>>(new Set());

  const registerTarget = useCallback((key: string, rect: TargetRect) => {
    targetsRef.current = { ...targetsRef.current, [key]: rect };
    setTargets(targetsRef.current);
  }, []);

  const registerTargetRef = useCallback((key: string, ref: RefObject<View | null>) => {
    refsRef.current[key] = ref;
  }, []);

  // Re-measure every known target right before each step is shown (and
  // once when the tour starts) rather than trusting a rect that was
  // pushed once, possibly a long time — and an unknown amount of
  // scrolling or content reflow — ago. Cheap (a handful of refs) and is
  // what actually keeps the spotlight correct on later steps (Profile,
  // the last one, is the one most steps' worth of elapsed time away
  // from its own registration).
  useEffect(() => {
    if (!active) return;
    Object.entries(refsRef.current).forEach(([key, ref]) => {
      ref.current?.measureInWindow((x, y, width, height) => {
        if (width === 0 && height === 0) return;
        targetsRef.current = { ...targetsRef.current, [key]: { ...targetsRef.current[key], x, y, width, height } };
        setTargets(targetsRef.current);
      });
    });
  }, [active, stepIndex]);

  const complete = useCallback(() => {
    setActive(false);
    const id = activeProfileIdRef.current;
    if (id) markTourComplete(id);
  }, []);

  const startIfNeeded = useCallback((profileId: string) => {
    if (checkedRef.current.has(profileId)) return;
    checkedRef.current.add(profileId);
    hasCompletedTour(profileId).then((done) => {
      if (!done) {
        activeProfileIdRef.current = profileId;
        setStepIndex(0);
        setActive(true);
      }
    });
  }, []);

  const replay = useCallback((profileId: string) => {
    activeProfileIdRef.current = profileId;
    setStepIndex(0);
    setActive(true);
  }, []);

  const next = useCallback(() => {
    setStepIndex((i) => {
      if (i + 1 >= TOUR_STEPS.length) {
        complete();
        return i;
      }
      return i + 1;
    });
  }, [complete]);

  const skip = useCallback(() => {
    if (active) complete();
  }, [active, complete]);

  return (
    <TourContext.Provider
      value={{ active, stepIndex, steps: TOUR_STEPS, targets, registerTarget, registerTargetRef, startIfNeeded, replay, next, skip }}
    >
      {children}
    </TourContext.Provider>
  );
}

export function useTour(): TourContextValue {
  const ctx = useContext(TourContext);
  if (!ctx) throw new Error('useTour must be used within TourProvider');
  return ctx;
}

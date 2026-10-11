import React, { createContext, useCallback, useContext, useRef, useState } from 'react';
import { CheckCircle2, AlertTriangle, AlertCircle, Info, X } from 'lucide-react';
import { useTheme } from './ThemeContext';

export type ToastType = 'success' | 'warning' | 'error' | 'info';

interface Toast {
  id: number;
  type: ToastType;
  message: string;
}

interface ToastContextValue {
  showToast: (type: ToastType, message: string, durationMs?: number) => void;
}

const ToastContext = createContext<ToastContextValue | undefined>(undefined);

const ICONS: Record<ToastType, React.ElementType> = {
  success: CheckCircle2,
  warning: AlertTriangle,
  error: AlertCircle,
  info: Info,
};

const DEFAULT_DURATION_MS = 4500;

/**
 * App-wide toast queue — replaces browser alert()/confirm() for feedback
 * ("Profile updated successfully.", "Unable to save changes.", etc).
 * Rendered once at the app root so any page can call useToast() without
 * needing its own viewport. Auto-dismisses after `durationMs`; hovering
 * pauses the timer so a toast doesn't vanish mid-read.
 */
export function ToastProvider({ children }: { children: React.ReactNode }) {
  // The viewport renders at the true app root (outside the admin shell
  // that owns `data-theme`), so it reads the resolved theme directly and
  // stamps its own attribute rather than relying on DOM-ancestor cascade.
  const { resolvedTheme } = useTheme();
  const [toasts, setToasts] = useState<Toast[]>([]);
  const idRef = useRef(0);
  const timersRef = useRef<Map<number, ReturnType<typeof setTimeout>>>(new Map());

  const dismiss = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
    const timer = timersRef.current.get(id);
    if (timer) {
      clearTimeout(timer);
      timersRef.current.delete(id);
    }
  }, []);

  const showToast = useCallback(
    (type: ToastType, message: string, durationMs: number = DEFAULT_DURATION_MS) => {
      const id = ++idRef.current;
      setToasts((prev) => [...prev, { id, type, message }]);
      const timer = setTimeout(() => dismiss(id), durationMs);
      timersRef.current.set(id, timer);
    },
    [dismiss]
  );

  const pause = (id: number) => {
    const timer = timersRef.current.get(id);
    if (timer) clearTimeout(timer);
  };
  const resume = (id: number) => {
    const timer = setTimeout(() => dismiss(id), 2000);
    timersRef.current.set(id, timer);
  };

  return (
    <ToastContext.Provider value={{ showToast }}>
      {children}
      <div className="toast-viewport" data-theme={resolvedTheme} role="region" aria-label="Notifications">
        {toasts.map((t) => {
          const Icon = ICONS[t.type];
          return (
            <div
              key={t.id}
              className={`toast toast-${t.type}`}
              role={t.type === 'error' ? 'alert' : 'status'}
              aria-live={t.type === 'error' ? 'assertive' : 'polite'}
              onMouseEnter={() => pause(t.id)}
              onMouseLeave={() => resume(t.id)}
            >
              <Icon size={17} strokeWidth={2} className="toast-icon" aria-hidden="true" />
              <span className="toast-message">{t.message}</span>
              <button type="button" className="toast-close" onClick={() => dismiss(t.id)} aria-label="Dismiss notification">
                <X size={14} />
              </button>
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used within a ToastProvider');
  return ctx;
}

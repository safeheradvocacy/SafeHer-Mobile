import React, { useEffect, useRef, useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { Mail, Lock, Eye, EyeOff, ShieldCheck, AlertCircle, Loader2, ArrowLeft } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { AuthBackground } from './components/AuthBackground';
import { LogoMark } from '../../components/branding/Logo';

// Defensive, client-side belt-and-suspenders check — real HTTPS
// enforcement belongs at the hosting/CDN layer (HSTS + redirect rules),
// which this component obviously can't configure, but a plain-HTTP
// production visit (misconfigured proxy, a stale bookmark, etc.) still
// shouldn't be allowed to render a credential form. Skipped entirely on
// localhost/127.0.0.1 so local dev over plain http keeps working.
function useHttpsRedirect() {
  React.useEffect(() => {
    if (typeof window === 'undefined') return;
    const { protocol, hostname, host, pathname, search } = window.location;
    const isLocal = hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1';
    if (protocol === 'http:' && !isLocal) {
      window.location.replace(`https://${host}${pathname}${search}`);
    }
  }, []);
}

function AuthShell({ children, shaking }: { children: React.ReactNode; shaking?: boolean }) {
  const navigate = useNavigate();
  useHttpsRedirect();
  return (
    <div className="admin-split" style={{ minHeight: '100vh', display: 'grid' }}>
      <button
        type="button"
        className="auth-back-btn"
        onClick={() => navigate('/')}
        aria-label="Back to SafeSpace home"
      >
        <ArrowLeft size={15} strokeWidth={2} />
        Back
      </button>

      {/* Background/padding/gradient live in theme.css (.admin-split-brand).
          A single, one-time fade-in — no translateY on this panel at all,
          so it reads as "the interface is here" rather than motion drawing
          attention to itself; the form card (below) carries the only
          translate, and both finish well under 300ms. */}
      <div className="admin-split-brand">
        <AuthBackground />

        {/* Top / middle / bottom composition — wordmark anchored at the
            top, the title + description vertically centered in the
            remaining space, and a small caption anchored at the bottom —
            so the panel's height is used intentionally instead of one
            centered cluster floating in a lot of flat empty space. No
            feature list here anymore (Security / Confidentiality /
            Role-based access, previously) — that read as a marketing
            panel rather than an institutional identity panel. */}
        {/* Symbol only, no separate "SafeSpace" heading beside it — the
            full mark+wordmark asset (safespace_nobackground.png) isn't
            used here on purpose: its wordmark ink is blue-toned (verified
            by decoding the asset's own pixels), and this panel's
            background is a dark navy gradient off --sidebar-bg (#0B3A82),
            so that pairing comes out under 2:1 contrast — unreadable. The
            footer caption below ("SafeSpace Administrative Portal ·
            Aurora Province") already names the portal on this same panel,
            so this icon doesn't need its own repeated text label. */}
        <div className="auth-brand-top" style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <LogoMark size={44} tone="onDark" />
        </div>

        <div className="auth-brand-middle">
          <h1 className="auth-title" style={{ color: '#fff', fontSize: 32 }}>
            Administrative Portal
          </h1>
          <p className="auth-subtitle" style={{ color: 'rgba(255,255,255,0.92)', marginTop: 12, fontSize: 15, lineHeight: 1.6, maxWidth: 420 }}>
            Administrative access for authorized personnel.
          </p>
          <p className="auth-subtitle" style={{ color: 'rgba(255,255,255,0.72)', marginTop: 10, fontSize: 14, lineHeight: 1.6, maxWidth: 420 }}>
            Manage cases, referrals, support services, and administrative operations across Aurora Province.
          </p>
        </div>

        <div className="auth-brand-bottom">
          <span className="auth-brand-footer">SafeSpace Administrative Portal · Aurora Province</span>
        </div>
      </div>

      <div className="admin-split-form">
        <div className={`admin-split-form-inner${shaking ? ' auth-card-shake' : ''}`} style={{ width: '100%', maxWidth: 460 }}>
          {children}
        </div>
      </div>
    </div>
  );
}

// A small plain-text line, not the previous tinted card with an icon and
// two sentences — this used to be large enough to compete with the form
// itself for attention. One short sentence is enough to communicate
// "this isn't a public page" without turning into another card.
function AuthSecurityNote() {
  return <p className="auth-security-note">Authorized administrative access only.</p>;
}

function PasswordToggle({ show, onToggle }: { show: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-label={show ? 'Hide password' : 'Show password'}
      className="auth-eye-toggle"
      style={{ background: 'none', border: 'none', display: 'flex', color: 'var(--color-text-muted)', padding: 0 }}
    >
      <Eye size={17} style={{ opacity: show ? 0 : 1, transform: show ? 'scale(0.8)' : 'scale(1)' }} />
      <EyeOff size={17} style={{ opacity: show ? 1 : 0, transform: show ? 'scale(1)' : 'scale(0.8)' }} />
    </button>
  );
}

function AuthSubmitButton({
  loading,
  idleLabel,
  loadingLabel,
  disabled,
}: {
  loading: boolean;
  idleLabel: string;
  loadingLabel: string;
  disabled?: boolean;
}) {
  return (
    <button
      className="btn btn-primary btn-lg auth-submit-btn"
      style={{ width: '100%', justifyContent: 'center', marginTop: 8 }}
      disabled={loading || disabled}
      aria-busy={loading}
    >
      {loading && <Loader2 size={16} className="auth-spinner" aria-hidden="true" />}
      {loading ? loadingLabel : idleLabel}
    </button>
  );
}

function FieldError({ message }: { message: string }) {
  return (
    <p className="error-text" style={{ display: 'flex', alignItems: 'center', gap: 6 }} role="alert" aria-live="assertive" aria-atomic="true">
      <AlertCircle size={14} />
      {message}
    </p>
  );
}

function IconInput({
  icon: Icon,
  rightElement,
  invalid,
  ...rest
}: React.InputHTMLAttributes<HTMLInputElement> & {
  icon: React.ElementType;
  rightElement?: React.ReactNode;
  invalid?: boolean;
}) {
  return (
    <div className="icon-input-wrap" style={{ position: 'relative' }}>
      <span
        className="icon-input-icon"
        style={{
          position: 'absolute',
          left: 12,
          top: '50%',
          transform: 'translateY(-50%)',
          pointerEvents: 'none',
          display: 'flex',
          color: 'var(--color-text-muted)',
        }}
      >
        <Icon size={17} />
      </span>
      <input
        {...rest}
        className={`input${invalid ? ' input-invalid' : ''}`}
        aria-invalid={invalid || undefined}
        style={{ paddingLeft: 40, paddingRight: rightElement ? 40 : 12 }}
      />
      {rightElement && (
        <span style={{ position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)' }}>{rightElement}</span>
      )}
    </div>
  );
}

// Deliberate extra step before authenticating: a focused, low-drama
// confirmation rather than an alarming warning dialog. Backdrop click and
// Escape both cancel (never submit) and are disabled while a sign-in
// request is actually in flight, so the admin can't dismiss the dialog out
// from under a request that's still running. Focus moves to the primary
// action on open and back to whatever triggered it on close; Tab is
// trapped between the two buttons since they're the only focusable
// elements in the dialog.
function LoginConfirmModal({
  open,
  loading,
  onCancel,
  onConfirm,
}: {
  open: boolean;
  loading: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const confirmBtnRef = useRef<HTMLButtonElement>(null);
  const modalRef = useRef<HTMLDivElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (open) {
      previousFocusRef.current = document.activeElement as HTMLElement | null;
      confirmBtnRef.current?.focus();
    } else {
      previousFocusRef.current?.focus();
      previousFocusRef.current = null;
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !loading) onCancel();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, loading, onCancel]);

  if (!open) return null;

  const trapTab = (e: React.KeyboardEvent) => {
    if (e.key !== 'Tab') return;
    const focusables = modalRef.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)');
    if (!focusables || focusables.length === 0) return;
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  };

  return (
    <div className="auth-confirm-backdrop" onMouseDown={() => !loading && onCancel()}>
      <div
        ref={modalRef}
        className="auth-confirm-modal"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="auth-confirm-title"
        aria-describedby="auth-confirm-desc"
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={trapTab}
      >
        <div className="auth-confirm-icon" aria-hidden="true">
          <ShieldCheck size={22} strokeWidth={2} />
        </div>
        <h3 id="auth-confirm-title" className="auth-confirm-title">
          Are you sure you want to log in?
        </h3>
        <p id="auth-confirm-desc" className="auth-confirm-desc">
          You are about to access the SafeSpace Administrative Portal. Continue only if you are an authorized
          administrator.
        </p>
        <div className="auth-confirm-actions">
          <button type="button" className="auth-confirm-btn auth-confirm-btn-secondary" onClick={onCancel} disabled={loading}>
            Cancel
          </button>
          <button
            ref={confirmBtnRef}
            type="button"
            className="auth-confirm-btn auth-confirm-btn-primary"
            onClick={onConfirm}
            disabled={loading}
            aria-busy={loading}
          >
            {loading && <Loader2 size={15} className="auth-spinner" aria-hidden="true" />}
            {loading ? 'Signing in...' : 'Yes, sign in'}
          </button>
        </div>
      </div>
    </div>
  );
}

const EMAIL_RE = /^\S+@\S+\.\S+$/;
const MAX_LOGIN_ATTEMPTS = 5;
const LOCKOUT_DURATION_MS = 5 * 60 * 1000;
// sessionStorage (not localStorage) deliberately — the cooldown is a
// client-side UX layer on top of Supabase's own server-side rate
// limiting (see friendlyAuthError's 429 branch in AuthContext), tied to
// "this browser session" the same way the request asked for, and it
// naturally resets itself once the tab/browser closes.
const ATTEMPTS_STORAGE_KEY = 'safeher_admin_login_attempts';

interface LoginAttemptState {
  count: number;
  lockedUntil: number | null;
}

function readLoginAttempts(): LoginAttemptState {
  try {
    const raw = sessionStorage.getItem(ATTEMPTS_STORAGE_KEY);
    if (!raw) return { count: 0, lockedUntil: null };
    const parsed = JSON.parse(raw) as Partial<LoginAttemptState>;
    return { count: parsed.count ?? 0, lockedUntil: parsed.lockedUntil ?? null };
  } catch {
    return { count: 0, lockedUntil: null };
  }
}

function writeLoginAttempts(state: LoginAttemptState) {
  try {
    sessionStorage.setItem(ATTEMPTS_STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Best-effort only (e.g. private-browsing storage restrictions) —
    // losing the counter just means no client-side lockout, not a broken login.
  }
}

function clearLoginAttempts() {
  try {
    sessionStorage.removeItem(ATTEMPTS_STORAGE_KEY);
  } catch {
    // ignore
  }
}

function formatLockoutRemaining(msRemaining: number): string {
  const totalSeconds = Math.max(0, Math.ceil(msRemaining / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return minutes > 0 ? `${minutes}m ${seconds}s` : `${seconds}s`;
}

function clearPersistedSupabaseSession() {
  try {
    Object.keys(localStorage)
      .filter((key) => key.startsWith('sb-') && key.endsWith('-auth-token'))
      .forEach((key) => localStorage.removeItem(key));
  } catch {
    // ignore — best-effort only
  }
}

// Arms a one-time, never-removed `pagehide` listener that drops the
// persisted Supabase session when the tab/browser actually closes. This
// can't be a normal effect-cleanup-scoped listener: LoginPage unmounts
// the instant sign-in succeeds (client-side route change to the
// dashboard, no document unload), which would tear the listener down
// before the user ever closes the tab. Living directly on `window`
// instead keeps it armed for the rest of the tab's life. `pagehide`
// (not `beforeunload`) because it only fires on genuine navigate-away/
// tab-close, not on backgrounding/tab-switch, and is the more reliable
// of the two on mobile Safari.
function armSessionOnlyCleanup() {
  const w = window as typeof window & { __safeherSessionOnlyArmed?: boolean };
  if (w.__safeherSessionOnlyArmed) return;
  w.__safeherSessionOnlyArmed = true;
  window.addEventListener('pagehide', clearPersistedSupabaseSession);
}

export function LoginPage() {
  const { session, profile, signIn } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [rememberMe, setRememberMe] = useState(true);
  const [formError, setFormError] = useState<string | null>(null);
  const [emailFieldError, setEmailFieldError] = useState<string | null>(null);
  const [passwordFieldError, setPasswordFieldError] = useState<string | null>(null);
  const [emailInvalid, setEmailInvalid] = useState(false);
  const [passwordInvalid, setPasswordInvalid] = useState(false);
  const [shakeToken, setShakeToken] = useState(0);
  const [cardShaking, setCardShaking] = useState(false);
  const [loading, setLoading] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [hasSubmitted, setHasSubmitted] = useState(false);
  const [lockedUntil, setLockedUntil] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const submittingRef = useRef(false);
  const cardShakeTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Picks up a lockout still in effect from earlier this session, e.g. the
  // admin reloaded the page mid-cooldown. If a stored lockout has already
  // expired (the tab sat open past the cooldown), clear it here rather
  // than leaving the maxed-out attempt count behind — otherwise a single
  // new typo would instantly re-lock the admin for another full cooldown.
  useEffect(() => {
    const stored = readLoginAttempts();
    if (stored.lockedUntil) {
      if (stored.lockedUntil > Date.now()) {
        setLockedUntil(stored.lockedUntil);
      } else {
        clearLoginAttempts();
      }
    }
  }, []);

  // Only ticks while a lockout is actually active, purely to keep the
  // "try again in X" countdown current.
  useEffect(() => {
    if (!lockedUntil) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [lockedUntil]);

  useEffect(() => {
    if (lockedUntil && lockedUntil <= now) {
      setLockedUntil(null);
      clearLoginAttempts();
    }
  }, [lockedUntil, now]);

  useEffect(() => () => {
    if (cardShakeTimeoutRef.current) clearTimeout(cardShakeTimeoutRef.current);
  }, []);

  if (session && profile) return <Navigate to="/admin/dashboard" replace />;

  const isLocked = !!lockedUntil && lockedUntil > now;

  const triggerCardShake = () => {
    if (cardShakeTimeoutRef.current) clearTimeout(cardShakeTimeoutRef.current);
    setCardShaking(false);
    requestAnimationFrame(() => {
      setCardShaking(true);
      cardShakeTimeoutRef.current = setTimeout(() => setCardShaking(false), 900);
    });
  };

  const validateEmailOnBlur = () => {
    const trimmed = email.trim();
    if (trimmed && !EMAIL_RE.test(trimmed)) {
      setEmailInvalid(true);
      setEmailFieldError('Please enter a valid email address.');
    } else if (!trimmed && hasSubmitted) {
      setEmailInvalid(true);
      setEmailFieldError('Please enter your email address.');
    }
  };

  const validatePasswordOnBlur = () => {
    if (!password && hasSubmitted) {
      setPasswordInvalid(true);
      setPasswordFieldError('Please enter your password.');
    }
  };

  // Submitting the form (via button click or Enter) only validates the
  // fields and, if they're OK, opens the confirmation modal — it never
  // authenticates directly. The actual sign-in call lives in confirmLogin,
  // fired only from the modal's "Yes, Log In" button.
  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (submittingRef.current || loading || isLocked) return;

    setHasSubmitted(true);
    const trimmedEmail = email.trim();
    const emailBad = !trimmedEmail || !EMAIL_RE.test(trimmedEmail);
    const passwordBad = !password;
    if (emailBad || passwordBad) {
      setEmailInvalid(emailBad);
      setPasswordInvalid(passwordBad);
      setEmailFieldError(emailBad ? (!trimmedEmail ? 'Please enter your email address.' : 'Please enter a valid email address.') : null);
      setPasswordFieldError(passwordBad ? 'Please enter your password.' : null);
      setShakeToken((t) => t + 1);
      return;
    }

    setFormError(null);
    setShowConfirm(true);
  };

  const cancelConfirm = () => {
    if (loading) return;
    setShowConfirm(false);
  };

  const confirmLogin = async () => {
    if (submittingRef.current || loading) return;
    const trimmedEmail = email.trim();

    submittingRef.current = true;
    setLoading(true);
    setFormError(null);
    setEmailFieldError(null);
    setPasswordFieldError(null);

    const { error: signInError } = await signIn(trimmedEmail, password);

    setLoading(false);
    submittingRef.current = false;

    if (signInError) {
      // A failed sign-in doesn't say which field was wrong — Supabase
      // returns one generic "invalid credentials" message either way, so
      // both fields are flagged rather than guessing, and only the
      // shared banner below carries the message (no per-field text that
      // could imply "this specific field" was the problem).
      const attempts = readLoginAttempts();
      const nextCount = attempts.count + 1;
      if (nextCount >= MAX_LOGIN_ATTEMPTS) {
        const until = Date.now() + LOCKOUT_DURATION_MS;
        writeLoginAttempts({ count: nextCount, lockedUntil: until });
        setLockedUntil(until);
        setNow(Date.now());
      } else {
        writeLoginAttempts({ count: nextCount, lockedUntil: null });
      }
      setShowConfirm(false);
      setEmailInvalid(true);
      setPasswordInvalid(true);
      setShakeToken((t) => t + 1);
      triggerCardShake();
      setFormError(signInError);
      return;
    }

    clearLoginAttempts();
    if (!rememberMe) armSessionOnlyCleanup();
    setShowConfirm(false);
    navigate('/admin/dashboard', { replace: true });
  };

  const lockoutMessage = isLocked ? `Too many attempts — try again in ${formatLockoutRemaining((lockedUntil ?? 0) - now)}.` : null;
  const submitDisabled = isLocked;

  return (
    <>
    <AuthShell shaking={cardShaking}>
      <form onSubmit={onSubmit} noValidate aria-label="Administrator log in">
        <h2 style={{ fontSize: 26, fontWeight: 700 }}>Welcome back</h2>
        <p style={{ color: 'var(--color-text-muted)', marginTop: 4, marginBottom: 24, fontSize: 14 }}>
          Sign in to your authorized administrator account.
        </p>

        <div className={`field${emailInvalid ? ' field-shake' : ''}`} key={emailInvalid ? `email-${shakeToken}` : 'email'}>
          <label className="label" htmlFor="email">
            Email
          </label>
          <IconInput
            icon={Mail}
            id="email"
            type="email"
            autoComplete="username"
            value={email}
            onChange={(e) => {
              setEmail(e.target.value);
              if (emailInvalid) setEmailInvalid(false);
              if (emailFieldError) setEmailFieldError(null);
            }}
            onBlur={validateEmailOnBlur}
            autoFocus
            disabled={loading || isLocked}
            invalid={emailInvalid}
            aria-describedby={emailFieldError ? 'email-error' : undefined}
          />
          {emailFieldError && (
            <span id="email-error">
              <FieldError message={emailFieldError} />
            </span>
          )}
        </div>

        <div className={`field${passwordInvalid ? ' field-shake' : ''}`} key={passwordInvalid ? `password-${shakeToken}` : 'password'}>
          <label className="label" htmlFor="password">
            Password
          </label>
          <IconInput
            icon={Lock}
            id="password"
            type={showPassword ? 'text' : 'password'}
            autoComplete="current-password"
            value={password}
            onChange={(e) => {
              setPassword(e.target.value);
              if (passwordInvalid) setPasswordInvalid(false);
              if (passwordFieldError) setPasswordFieldError(null);
            }}
            onBlur={validatePasswordOnBlur}
            disabled={loading || isLocked}
            invalid={passwordInvalid}
            aria-describedby={passwordFieldError ? 'password-error' : undefined}
            rightElement={<PasswordToggle show={showPassword} onToggle={() => setShowPassword((v) => !v)} />}
          />
          {passwordFieldError && (
            <span id="password-error">
              <FieldError message={passwordFieldError} />
            </span>
          )}
        </div>

        <label className="auth-remember-row">
          <input
            type="checkbox"
            checked={rememberMe}
            onChange={(e) => setRememberMe(e.target.checked)}
            disabled={loading}
          />
          Remember me
        </label>

        {lockoutMessage ? (
          <p className="error-text" style={{ display: 'flex', alignItems: 'center', gap: 6 }} role="alert" aria-live="assertive" aria-atomic="true">
            <AlertCircle size={14} />
            {lockoutMessage}
          </p>
        ) : (
          formError && <FieldError message={formError} />
        )}

        <AuthSubmitButton loading={loading} idleLabel="Sign in" loadingLabel="Signing in..." disabled={submitDisabled} />

        <a href="/admin/forgot-password" className="auth-secondary-link" style={{ display: 'block', textAlign: 'center', marginTop: 16 }}>
          Forgot your password?
        </a>

        <AuthSecurityNote />
      </form>
    </AuthShell>
    <LoginConfirmModal open={showConfirm} loading={loading} onCancel={cancelConfirm} onConfirm={confirmLogin} />
    </>
  );
}

export function ForgotPasswordPage() {
  const { requestPasswordReset } = useAuth();
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim() || !/^\S+@\S+\.\S+$/.test(email.trim())) {
      setError('Please enter a valid email address.');
      return;
    }
    setLoading(true);
    setError(null);
    const { error: reqError } = await requestPasswordReset(email.trim());
    setLoading(false);
    if (reqError) {
      setError(reqError);
      return;
    }
    setSent(true);
  };

  return (
    <AuthShell>
      <div>
        <h2 style={{ fontSize: 24 }}>{sent ? 'Check your email' : 'Forgot your password?'}</h2>
        {sent ? (
          <p style={{ color: 'var(--color-text-muted)', marginTop: 12, fontSize: 14, lineHeight: 1.6 }}>
            If an account exists for that email address, a password reset link has been sent.
          </p>
        ) : (
          <form onSubmit={onSubmit} noValidate>
            <p style={{ color: 'var(--color-text-muted)', marginTop: 4, marginBottom: 24, fontSize: 14 }}>
              Enter your administrator email address to request a password reset.
            </p>
            <div className="field">
              <label className="label" htmlFor="reset-email">
                Email
              </label>
              <IconInput
                icon={Mail}
                id="reset-email"
                type="email"
                autoComplete="username"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoFocus
                disabled={loading}
              />
            </div>
            {error && <FieldError message={error} />}
            <AuthSubmitButton loading={loading} idleLabel="Send reset link" loadingLabel="Sending..." />
          </form>
        )}
        <a href="/admin/login" style={{ display: 'block', textAlign: 'center', marginTop: 18, fontSize: 13 }}>
          Back to sign in
        </a>
      </div>
    </AuthShell>
  );
}

export function ResetPasswordPage() {
  const { session, updatePassword } = useAuth();
  const navigate = useNavigate();
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);

  // Supabase establishes a temporary recovery session automatically when
  // the admin arrives here via the emailed link (detectSessionInUrl is on
  // for this browser client). No session at all means they navigated here
  // directly or the link already expired — the form can't work either way.
  if (!session && !done) {
    return (
      <AuthShell>
        <div>
          <h2 style={{ fontSize: 24 }}>Reset link expired</h2>
          <p style={{ color: 'var(--color-text-muted)', marginTop: 12, fontSize: 14, lineHeight: 1.6 }}>
            This password reset link is invalid or has expired. Request a new one to continue.
          </p>
          <a href="/admin/forgot-password" className="btn btn-primary btn-lg auth-submit-btn" style={{ marginTop: 20, justifyContent: 'center' }}>
            Request a new link
          </a>
        </div>
      </AuthShell>
    );
  }

  if (done) {
    return (
      <AuthShell>
        <div>
          <h2 style={{ fontSize: 24 }}>Password updated</h2>
          <p style={{ color: 'var(--color-text-muted)', marginTop: 12, fontSize: 14, lineHeight: 1.6 }}>
            Your password has been changed. You can now sign in with your new password.
          </p>
          <button className="btn btn-primary btn-lg auth-submit-btn" style={{ marginTop: 20, width: '100%', justifyContent: 'center' }} onClick={() => navigate('/admin/login', { replace: true })}>
            Go to log in
          </button>
        </div>
      </AuthShell>
    );
  }

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (password.length < 8) {
      setError('Password must be at least 8 characters.');
      return;
    }
    if (password !== confirmPassword) {
      setError('Passwords do not match.');
      return;
    }
    setLoading(true);
    setError(null);
    const { error: updateError } = await updatePassword(password);
    setLoading(false);
    if (updateError) {
      setError(updateError);
      return;
    }
    setDone(true);
  };

  return (
    <AuthShell>
      <form onSubmit={onSubmit} noValidate>
        <h2 style={{ fontSize: 24 }}>Choose a new password</h2>
        <p style={{ color: 'var(--color-text-muted)', marginTop: 4, marginBottom: 24, fontSize: 14 }}>
          Enter a new password for your SafeSpace administrator account.
        </p>

        <div className="field">
          <label className="label" htmlFor="new-password">
            New password
          </label>
          <IconInput
            icon={Lock}
            id="new-password"
            type={showPassword ? 'text' : 'password'}
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoFocus
            disabled={loading}
            rightElement={<PasswordToggle show={showPassword} onToggle={() => setShowPassword((v) => !v)} />}
          />
        </div>

        <div className="field">
          <label className="label" htmlFor="confirm-password">
            Confirm new password
          </label>
          <IconInput
            icon={Lock}
            id="confirm-password"
            type={showPassword ? 'text' : 'password'}
            autoComplete="new-password"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            disabled={loading}
          />
        </div>

        {error && <FieldError message={error} />}

        <AuthSubmitButton loading={loading} idleLabel="Update password" loadingLabel="Updating..." />
      </form>
    </AuthShell>
  );
}

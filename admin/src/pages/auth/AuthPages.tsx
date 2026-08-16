import React, { useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { Mail, Lock, Eye, EyeOff, ShieldCheck, KeyRound, Users, AlertCircle } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { LogoMark } from '../../components/branding/Logo';

const BRAND_POINTS = [
  { icon: ShieldCheck, label: 'Security' },
  { icon: EyeOff, label: 'Confidentiality' },
  { icon: Users, label: 'Role-based access' },
];

function AuthShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="admin-split" style={{ minHeight: '100vh', display: 'grid', gridTemplateColumns: '1fr 1fr' }}>
      <div
        className="admin-split-brand"
        style={{
          background: 'linear-gradient(160deg, var(--color-primary-dark), var(--color-primary))',
          color: '#fff',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
          padding: '64px 56px',
        }}
      >
        <LogoMark size={56} tone="onDark" />
        <h1 style={{ color: '#fff', fontSize: 32, marginTop: 24 }}>SafeHer Admin Portal</h1>
        <p style={{ color: 'rgba(255,255,255,0.85)', marginTop: 12, fontSize: 15, lineHeight: 1.6, maxWidth: 360 }}>
          Secure access for authorized municipal and provincial administrators.
        </p>
        <div style={{ marginTop: 48, display: 'flex', flexDirection: 'column', gap: 18 }}>
          {BRAND_POINTS.map(({ icon: Icon, label }) => (
            <div key={label} style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <div
                style={{
                  width: 34,
                  height: 34,
                  borderRadius: 10,
                  background: 'rgba(255,255,255,0.14)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  flexShrink: 0,
                }}
              >
                <Icon size={17} color="#fff" strokeWidth={1.75} />
              </div>
              <span style={{ fontSize: 14, fontWeight: 500 }}>{label}</span>
            </div>
          ))}
        </div>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
        <div style={{ width: '100%', maxWidth: 380 }}>{children}</div>
      </div>
    </div>
  );
}

function FieldError({ message }: { message: string }) {
  return (
    <p className="error-text" style={{ display: 'flex', alignItems: 'center', gap: 6 }} role="alert">
      <AlertCircle size={14} />
      {message}
    </p>
  );
}

function IconInput({
  icon: Icon,
  rightElement,
  ...rest
}: React.InputHTMLAttributes<HTMLInputElement> & { icon: React.ElementType; rightElement?: React.ReactNode }) {
  return (
    <div style={{ position: 'relative' }}>
      <span
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
      <input {...rest} className="input" style={{ paddingLeft: 40, paddingRight: rightElement ? 40 : 12 }} />
      {rightElement && (
        <span style={{ position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)' }}>{rightElement}</span>
      )}
    </div>
  );
}

export function LoginPage() {
  const { session, profile, signIn } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  if (session && profile) return <Navigate to="/admin/dashboard" replace />;

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim()) {
      setError('Please enter your email address.');
      return;
    }
    if (!/^\S+@\S+\.\S+$/.test(email.trim())) {
      setError('Please enter a valid email address.');
      return;
    }
    if (!password) {
      setError('Please enter your password.');
      return;
    }
    setLoading(true);
    setError(null);
    const { error: signInError } = await signIn(email.trim(), password);
    setLoading(false);
    if (signInError) {
      setError(signInError);
      return;
    }
    navigate('/admin/dashboard', { replace: true });
  };

  return (
    <AuthShell>
      <form onSubmit={onSubmit} noValidate aria-label="Administrator log in">
        <h2 style={{ fontSize: 24 }}>Welcome back</h2>
        <p style={{ color: 'var(--color-text-muted)', marginTop: 4, marginBottom: 28, fontSize: 14 }}>
          Sign in with your municipal or provincial administrator account.
        </p>

        <div className="field">
          <label className="label" htmlFor="email">
            Email
          </label>
          <IconInput
            icon={Mail}
            id="email"
            type="email"
            autoComplete="username"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoFocus
            disabled={loading}
          />
        </div>

        <div className="field">
          <label className="label" htmlFor="password">
            Password
          </label>
          <IconInput
            icon={Lock}
            id="password"
            type={showPassword ? 'text' : 'password'}
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            disabled={loading}
            rightElement={
              <button
                type="button"
                onClick={() => setShowPassword((v) => !v)}
                aria-label={showPassword ? 'Hide password' : 'Show password'}
                style={{ background: 'none', border: 'none', display: 'flex', color: 'var(--color-text-muted)' }}
              >
                {showPassword ? <EyeOff size={17} /> : <Eye size={17} />}
              </button>
            }
          />
        </div>

        {error && <FieldError message={error} />}

        <button className="btn btn-primary btn-lg" style={{ width: '100%', justifyContent: 'center', marginTop: 8 }} disabled={loading}>
          {loading ? 'Signing in...' : 'Log in'}
        </button>

        <a href="/admin/forgot-password" style={{ display: 'block', textAlign: 'center', marginTop: 18, fontSize: 13 }}>
          Forgot your password?
        </a>
      </form>
    </AuthShell>
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
        <h2 style={{ fontSize: 24 }}>Reset your password</h2>
        {sent ? (
          <div style={{ marginTop: 20 }}>
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                background: 'var(--color-primary-light)',
                borderRadius: 10,
                padding: 16,
              }}
            >
              <KeyRound size={18} color="var(--color-primary-dark)" />
              <p style={{ color: 'var(--color-text)', fontSize: 14, lineHeight: 1.5 }}>
                If an account exists for that email, a reset link has been sent. Check your inbox.
              </p>
            </div>
          </div>
        ) : (
          <form onSubmit={onSubmit} noValidate>
            <p style={{ color: 'var(--color-text-muted)', marginTop: 4, marginBottom: 24, fontSize: 14 }}>
              Enter your email and we'll send you a link to reset your password.
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
            <button className="btn btn-primary btn-lg" style={{ width: '100%', justifyContent: 'center', marginTop: 8 }} disabled={loading}>
              {loading ? 'Sending...' : 'Send reset link'}
            </button>
          </form>
        )}
        <a href="/admin/login" style={{ display: 'block', textAlign: 'center', marginTop: 18, fontSize: 13 }}>
          Back to log in
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
          <a href="/admin/forgot-password" className="btn btn-primary btn-lg" style={{ marginTop: 20, justifyContent: 'center' }}>
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
          <button className="btn btn-primary btn-lg" style={{ marginTop: 20, width: '100%', justifyContent: 'center' }} onClick={() => navigate('/admin/login', { replace: true })}>
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
          Enter a new password for your SafeHer administrator account.
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
            rightElement={
              <button
                type="button"
                onClick={() => setShowPassword((v) => !v)}
                aria-label={showPassword ? 'Hide password' : 'Show password'}
                style={{ background: 'none', border: 'none', display: 'flex', color: 'var(--color-text-muted)' }}
              >
                {showPassword ? <EyeOff size={17} /> : <Eye size={17} />}
              </button>
            }
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

        <button className="btn btn-primary btn-lg" style={{ width: '100%', justifyContent: 'center', marginTop: 8 }} disabled={loading}>
          {loading ? 'Updating...' : 'Update password'}
        </button>
      </form>
    </AuthShell>
  );
}

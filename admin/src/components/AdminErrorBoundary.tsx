import React from 'react';
import { useNavigate } from 'react-router-dom';

interface Props {
  children: React.ReactNode;
}

interface State {
  error: Error | null;
}

/**
 * Catches uncaught render exceptions from whatever page is currently
 * mounted in AppLayout's <Outlet /> — e.g. the ShelterAdminDashboard /
 * ShelterMap crash this was added in response to (an unhandled status
 * value blew up the whole render tree with no boundary to stop it,
 * producing a totally blank white screen with the real error visible only
 * in the browser console). A class component is required here: there is
 * no hook equivalent of getDerivedStateFromError/componentDidCatch.
 *
 * Deliberately scoped to the routed page content only (see where this is
 * mounted in AppLayout.tsx), not the whole app — the sidebar, navigation,
 * and auth state all stay intact and interactive even when the active
 * page itself has thrown, which is what makes "Back to Dashboard" always
 * a safe, real recovery path rather than a dead link.
 */
export class AdminErrorBoundary extends React.Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    // Dev-only: full stack + component stack for debugging. Never sent
    // anywhere, never shown to the user, and contains nothing from
    // Supabase (no tokens/keys/case data pass through a render exception
    // itself — this only ever logs the JS error object React caught).
    if (import.meta.env.DEV) {
      console.error('[AdminErrorBoundary] Uncaught render error:', error, info.componentStack);
    }
  }

  handleRetry = () => {
    this.setState({ error: null });
  };

  render() {
    if (this.state.error) {
      return <ErrorFallback error={this.state.error} onRetry={this.handleRetry} />;
    }
    return this.props.children;
  }
}

function ErrorFallback({ error, onRetry }: { error: Error; onRetry: () => void }) {
  // useNavigate requires a Router ancestor. AdminErrorBoundary is only ever
  // mounted inside AppLayout, which only ever renders inside <BrowserRouter>
  // (see App.tsx), so this is always safe at the boundary's actual mount
  // point — "Back to Dashboard" is never rendered from a context where it
  // could fail.
  const navigate = useNavigate();

  // Also resets the boundary's own error state, not just navigation — if
  // the crash happened on /admin/dashboard itself, navigating to the same
  // path is a no-op (the route-keyed remount in AppLayout only fires on a
  // pathname CHANGE), which would otherwise leave the fallback stuck on
  // screen even though the URL bar says we "went back".
  const handleBackToDashboard = () => {
    onRetry();
    navigate('/admin/dashboard');
  };

  return (
    <div className="card" style={{ maxWidth: 480, margin: '48px auto', textAlign: 'center', padding: 40 }}>
      <h3 style={{ marginBottom: 8 }}>Something went wrong</h3>
      <p style={{ color: 'var(--color-text-muted)', fontSize: 14, marginBottom: 24 }}>
        This part of SafeSpace Admin couldn't load. Your session and data are safe — you can try again or return to the dashboard.
      </p>
      <div style={{ display: 'flex', gap: 12, justifyContent: 'center' }}>
        <button className="btn btn-outline" onClick={handleBackToDashboard}>
          Back to Dashboard
        </button>
        <button className="btn btn-primary" onClick={onRetry}>
          Try Again
        </button>
      </div>
      {import.meta.env.DEV && (
        <pre
          style={{
            marginTop: 24,
            padding: 12,
            textAlign: 'left',
            fontSize: 11,
            fontFamily: 'monospace',
            color: 'var(--color-danger)',
            background: 'var(--color-surface-muted)',
            borderRadius: 'var(--radius-sm)',
            overflowX: 'auto',
            whiteSpace: 'pre-wrap',
          }}
        >
          {error.message}
          {error.stack ? `\n\n${error.stack}` : ''}
        </pre>
      )}
    </div>
  );
}

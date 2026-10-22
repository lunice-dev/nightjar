import { Component, type ReactNode } from 'react';

/**
 * If a screen breaks, show what broke and a way back instead of an empty window.
 */
export class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: { componentStack?: string | null }) {
    console.error('Nightjar screen error', error, info.componentStack);
  }

  render() {
    const e = this.state.error;
    if (!e) return this.props.children;
    return (
      <div className="crash" role="alert">
        <h1>Something on this screen broke</h1>
        <p>Your downloads keep going. Reload the window to carry on.</p>
        <pre>{`${e.message}\n${(e.stack ?? '').split('\n').slice(0, 6).join('\n')}`}</pre>
        <button className="btn" onClick={() => location.reload()}>
          Reload
        </button>
      </div>
    );
  }
}

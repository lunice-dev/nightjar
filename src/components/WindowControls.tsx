import { useEffect, useState } from 'react';
import { inApp, onWindowState, windowAction } from '../lib/host';

/** Minimise, maximise and close, drawn by the page in the Nightjar app's own window. */
export function WindowControls() {
  const [maximized, setMaximized] = useState(false);
  useEffect(() => onWindowState((s) => setMaximized(s.maximized)), []);
  if (!inApp) return null;
  return (
    <div className="win-controls">
      <button className="win-btn" aria-label="Minimise" title="Minimise" onClick={() => windowAction('minimize')}>
        <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden>
          <path d="M0 5h10" stroke="currentColor" strokeWidth="1" />
        </svg>
      </button>
      <button className="win-btn" aria-label={maximized ? 'Restore' : 'Maximise'} title={maximized ? 'Restore' : 'Maximise'} onClick={() => windowAction('maximize')}>
        <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden>
          {maximized ? (
            <path d="M2.5 2.5V.5h7v7h-2M.5 2.5h7v7h-7z" fill="none" stroke="currentColor" strokeWidth="1" />
          ) : (
            <rect x=".5" y=".5" width="9" height="9" fill="none" stroke="currentColor" strokeWidth="1" />
          )}
        </svg>
      </button>
      <button className="win-btn close" aria-label="Close to the icon next to the clock" title="Close (Nightjar keeps running next to the clock)" onClick={() => windowAction('close')}>
        <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden>
          <path d="M.5.5l9 9M9.5.5l-9 9" stroke="currentColor" strokeWidth="1" />
        </svg>
      </button>
    </div>
  );
}

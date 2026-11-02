import { useEffect, useState } from 'react';
import { inApp, onWindowState, windowAction, windowResize, type WindowEdge } from '../lib/host';

const EDGES: WindowEdge[] = ['left', 'right', 'top', 'bottom', 'topleft', 'topright', 'bottomleft', 'bottomright'];

/** Invisible strips along the window's borders and corners: press and drag one to resize the window. */
export function ResizeEdges() {
  const [state, setState] = useState({ maximized: false, resizable: false });
  useEffect(() => onWindowState(setState), []);
  if (!inApp || state.maximized || !state.resizable) return null;
  return (
    <div aria-hidden>
      {EDGES.map((edge) => (
        <div
          key={edge}
          className={`resize-edge ${edge}`}
          onMouseDown={(e) => {
            if (e.button !== 0) return;
            e.preventDefault();
            windowResize(edge);
          }}
        />
      ))}
    </div>
  );
}

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
      <button className="win-btn close" aria-label="Close to the icon next to the clock" title="Close (nightjar keeps running next to the clock)" onClick={() => windowAction('close')}>
        <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden>
          <path d="M.5.5l9 9M9.5.5l-9 9" stroke="currentColor" strokeWidth="1" />
        </svg>
      </button>
    </div>
  );
}

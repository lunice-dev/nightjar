import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useStore } from '../store';

export interface Line {
  key: string;
  username: string;
  text: string;
  timestamp: string;
  mine: boolean;
}

const time = (iso: string) => {
  const d = new Date(iso.endsWith('Z') || iso.includes('+') ? iso : `${iso}Z`);
  const today = new Date().toDateString() === d.toDateString();
  return today
    ? d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    : d.toLocaleDateString([], { day: 'numeric', month: 'short' }) + ' ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
};

/** A scrolling list of messages that sticks to the bottom unless you've scrolled up to read. */
export function MessageList({ lines, showNames, empty }: { lines: Line[]; showNames: boolean; empty: string }) {
  const box = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  const openProfile = useStore((s) => s.openProfile);

  useLayoutEffect(() => {
    const el = box.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [lines.length]);

  return (
    <div
      className="messages"
      ref={box}
      onScroll={(e) => {
        const el = e.currentTarget;
        stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
      }}
      role="log"
      aria-live="polite"
    >
      {lines.length === 0 && <p className="hint-text">{empty}</p>}
      {lines.map((l, i) => {
        const prev = lines[i - 1];
        const grouped = prev && prev.username === l.username && Date.parse(l.timestamp) - Date.parse(prev.timestamp) < 5 * 60_000;
        return (
          <div key={l.key} className={`msg ${l.mine ? 'mine' : ''} ${grouped ? 'grouped' : ''}`}>
            {!grouped && (
              <div className="msg-head">
                {showNames && !l.mine && (
                  <button className="user-link" onClick={() => openProfile(l.username)}>
                    {l.username}
                  </button>
                )}
                {showNames && l.mine && <span className="me">You</span>}
                <time dateTime={l.timestamp}>{time(l.timestamp)}</time>
              </div>
            )}
            <div className="msg-body">{l.text}</div>
          </div>
        );
      })}
    </div>
  );
}

export function Composer({ placeholder, onSend, disabled }: { placeholder: string; onSend: (t: string) => Promise<void>; disabled?: boolean }) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    input.current?.focus();
  }, [placeholder]);

  const send = async () => {
    const t = text.trim();
    if (!t || busy) return;
    setBusy(true);
    try {
      await onSend(t);
      setText('');
    } finally {
      setBusy(false);
      input.current?.focus();
    }
  };

  return (
    <form
      className="composer"
      onSubmit={(e) => {
        e.preventDefault();
        send();
      }}
    >
      <label className="sr-only" htmlFor="composer">
        {placeholder}
      </label>
      <textarea
        id="composer"
        ref={input}
        className="input"
        rows={1}
        placeholder={placeholder}
        value={text}
        disabled={disabled}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            send();
          }
        }}
      />
      <button className="btn" type="submit" disabled={disabled || busy || !text.trim()}>
        Send
      </button>
    </form>
  );
}

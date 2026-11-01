import { useState } from 'react';

const KEY = 'nightjar.classicPlayer';

/** Goes back to the earlier large-player layout (the new ones are Console on wide screens and Hush on phones). */
export function ClassicPlayerSwitch() {
  const [on, setOn] = useState(() => {
    try {
      return localStorage.getItem(KEY) === '1';
    } catch {
      return false;
    }
  });
  const flip = () => {
    const next = !on;
    setOn(next);
    try {
      if (next) localStorage.setItem(KEY, '1');
      else localStorage.removeItem(KEY);
    } catch {
      /* not kept */
    }
  };
  return (
    <section aria-labelledby="cp-h" style={{ margin: '28px 0 8px' }}>
      <h2 id="cp-h">Large player</h2>
      <label className="toggle" style={{ alignItems: 'flex-start' }}>
        <input type="checkbox" checked={on} onChange={flip} />
        <span>
          Use the classic layout
          <small className="dim" style={{ display: 'block' }}>
            Off: Console on wide screens and the PC, Hush on phones. On: the earlier layout everywhere. It applies the next time you open the player.
          </small>
        </span>
      </label>
    </section>
  );
}

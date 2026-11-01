import { useState } from 'react';

const KEY = 'nightjar.displayTests';

/** Switches that turn one part of the large player's drawing off, to find which part causes a glitch that only shows on the screen itself. */
export const DISPLAY_TESTS: { id: string; label: string; hint: string }[] = [
  { id: 'nobg', label: 'No blurred background picture', hint: 'Hides the blurred cover behind the player.' },
  { id: 'notint', label: 'Plain dark player colour', hint: 'Replaces the coloured gradient with flat dark grey.' },
  { id: 'nowill', label: 'No layer hint on the player', hint: 'Stops asking iOS to keep the player as one separate layer.' },
  { id: 'noclip', label: 'No clipping of the player', hint: 'The player no longer cuts off what is outside its edges.' },
  { id: 'noanim', label: 'No animations in the player', hint: 'Everything in the player is drawn without moving or fading.' },
  { id: 'nobrand', label: 'Hide the NIGHTJAR name', hint: 'Hides the name in the top bar.' },
];

const read = (): string[] => {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? '[]');
    return Array.isArray(v) ? v.filter((x) => typeof x === 'string') : [];
  } catch {
    return [];
  }
};

/** Puts the saved switches on <html> as classes (dx-…); called at startup and whenever one changes. */
export function applyDisplayTests(on: string[] = read()) {
  const root = document.documentElement;
  for (const t of DISPLAY_TESTS) root.classList.toggle(`dx-${t.id}`, on.includes(t.id));
}

export function DisplayTests() {
  const [on, setOn] = useState<string[]>(read);
  const flip = (id: string) => {
    const next = on.includes(id) ? on.filter((x) => x !== id) : [...on, id];
    setOn(next);
    applyDisplayTests(next);
    try {
      localStorage.setItem(KEY, JSON.stringify(next));
    } catch {
      /* not kept */
    }
  };
  return (
    <section aria-labelledby="dx-h" style={{ margin: '28px 0 8px' }}>
      <h2 id="dx-h">Display tests</h2>
      <p className="dim">For finding what draws a stray line on the large player. Switch one on, open the player and look; switch it off again afterwards.</p>
      <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'grid', gap: 10 }}>
        {DISPLAY_TESTS.map((t) => (
          <li key={t.id}>
            <label className="toggle" style={{ alignItems: 'flex-start' }}>
              <input type="checkbox" checked={on.includes(t.id)} onChange={() => flip(t.id)} />
              <span>
                {t.label}
                <small className="dim" style={{ display: 'block' }}>{t.hint}</small>
              </span>
            </label>
          </li>
        ))}
      </ul>
    </section>
  );
}

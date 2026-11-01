import { useEffect, useState } from 'react';

/** The window is a computer's: wide, with a mouse. These get the newer shell (see the shell styles in app.css). */
export const PC_SHELL = '(hover: hover) and (pointer: fine) and (min-width: 1100px)';

export function usePcShell() {
  const [pc, setPc] = useState(() => matchMedia(PC_SHELL).matches);
  useEffect(() => {
    const m = matchMedia(PC_SHELL);
    const on = () => setPc(m.matches);
    m.addEventListener('change', on);
    return () => m.removeEventListener('change', on);
  }, []);
  return pc;
}

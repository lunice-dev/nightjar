import { useEffect, useState } from 'react';
import { useStore } from '../store';

/** Whether this computer's file helper (the Nightjar app) is reachable; checked once per page. */
let filesAvailable: Promise<boolean> | undefined;
let filesKnown: boolean | undefined;
export function useFilesAvailable() {
  return useFilesState() ?? false;
}

/** Like useFilesAvailable, but undefined until the check has answered (so a screen can wait instead of guessing). */
export function useFilesState(): boolean | undefined {
  const backend = useStore((s) => s.backend);
  const [ok, setOk] = useState<boolean | undefined>(filesKnown);
  useEffect(() => {
    if (!backend) return;
    filesAvailable ??= backend.files.available();
    filesAvailable.then((v) => {
      filesKnown = v;
      setOk(v);
    });
  }, [backend]);
  return ok;
}

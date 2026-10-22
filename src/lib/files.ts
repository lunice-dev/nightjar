import { useEffect, useState } from 'react';
import { useStore } from '../store';

/** Whether this computer's file helper (the Nightjar app) is reachable; checked once per page. */
let filesAvailable: Promise<boolean> | undefined;
export function useFilesAvailable() {
  const backend = useStore((s) => s.backend);
  const [ok, setOk] = useState(false);
  useEffect(() => {
    if (!backend) return;
    filesAvailable ??= backend.files.available();
    filesAvailable.then(setOk);
  }, [backend]);
  return ok;
}

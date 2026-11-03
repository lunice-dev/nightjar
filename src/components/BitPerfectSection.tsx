import { useEffect, useState } from 'react';
import { bitPerfectAvailable, describeFormats, engineApi, useEngine, type EngineDevice } from '../lib/engine';

/** The bit-perfect switch and the choice of sound device. Only in nightjar's own window on the computer. */
export function BitPerfectSection() {
  const { on, device, setOn, setDevice } = useEngine();
  const [devices, setDevices] = useState<EngineDevice[] | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!bitPerfectAvailable) return;
    let alive = true;
    engineApi
      .devices()
      .then((r) => {
        if (!alive) return;
        // An older app answers with an error instead of a list.
        if (Array.isArray(r?.devices)) setDevices(r.devices);
        else setFailed(true);
      })
      .catch(() => alive && setFailed(true));
    return () => {
      alive = false;
    };
  }, []);

  if (!bitPerfectAvailable) return null;

  const chosen = devices?.find((d) => d.id === device) ?? devices?.find((d) => d.isDefault);
  const takes = chosen ? describeFormats(chosen.exclusive) : '';

  return (
    <section aria-labelledby="bp-h" style={{ margin: '28px 0 8px' }}>
      <h2 id="bp-h">Bit-perfect playback</h2>
      <label className="toggle" style={{ alignItems: 'flex-start' }}>
        <input type="checkbox" checked={on && !failed} disabled={failed} onChange={() => setOn(!on)} />
        <span>
          Send music to the sound device exactly as it is
          <small className="dim" style={{ display: 'block' }}>
            Each file plays at its own sample rate and bit depth, without Windows’ mixer in between. While music plays, other
            programs can’t use that device, and the volume is set on the device or amplifier. Files the device can’t take as
            they are play the usual way.
          </small>
        </span>
      </label>
      {failed && <p className="hint-text">This version of the nightjar app can’t play bit-perfect yet. Update it to use this.</p>}
      {devices && (
        <div style={{ marginTop: 12 }}>
          <label htmlFor="bp-device" className="dim" style={{ display: 'block', marginBottom: 6 }}>
            Sound device
          </label>
          <select id="bp-device" className="input" value={device ?? ''} onChange={(e) => setDevice(e.target.value || null)}>
            <option value="">The Windows default{devices.find((d) => d.isDefault) ? ` (${devices.find((d) => d.isDefault)!.name})` : ''}</option>
            {devices.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>
          {chosen && (
            <p className="hint-text" style={{ marginTop: 8 }}>
              {takes ? `Takes ${takes}.` : 'This device doesn’t allow exclusive use, so music on it plays the usual way.'}
            </p>
          )}
        </div>
      )}
    </section>
  );
}

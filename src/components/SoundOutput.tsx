import { useEffect, useRef, useState } from 'react';
import { usePlayer, trackTier, type QueueItem } from '../lib/player';
import { bitPerfectAvailable, describeFormats, splitDeviceName, takesAsIs, useEngine, type EngineDevice } from '../lib/engine';
import { openSettings } from '../lib/settingsNav';

/**
 * Where the sound goes on the computer, in the player itself: a line by the volume that opens the bit-perfect
 * switch and the list of outputs, and the Sound panel that shows the path from the file to the device. Only in
 * nightjar's own window; phones keep their own sound quality panel.
 */

type Kind = 'perfect' | 'converted' | 'windows' | 'checking';

const khz = (rate: number) => `${+(rate / 1000).toFixed(1)} kHz`;
const engineFormats = ['flac', 'wav'];

/** What is happening to the sound right now, from the switch, the chosen output and the engine's answer. */
function useSound() {
  const { on, device, devices, now } = useEngine();
  const t = usePlayer((s) => s.queue[s.index]) as QueueItem | undefined;
  const fallback = devices?.find((d) => d.isDefault) ?? null;
  const chosen = devices?.find((d) => d.id === device) ?? fallback;

  let kind: Kind;
  if (!on) kind = 'windows';
  else if (!t || !now) kind = 'checking';
  else if (now.mode === 'engine') kind = 'perfect';
  else if (now.format) kind = 'converted';
  else kind = 'windows';

  // The output the sound reaches: the engine says which; through the page it is whatever Windows uses.
  const out = splitDeviceName(kind === 'perfect' || kind === 'converted' ? now?.device : kind === 'windows' ? fallback?.name : chosen?.name);
  const outDevice = kind === 'windows' ? fallback : chosen;
  const eligible = !!t && engineFormats.includes(t.format) && t.rate > 0 && t.bits > 0;
  const better = eligible && devices ? devices.find((d) => takesAsIs(d, t!.rate, t!.bits)) ?? null : null;

  let short: string;
  if (kind === 'perfect' && t) short = `Bit-perfect · ${t.bits}/${+(t.rate / 1000).toFixed(1)}`;
  else if (kind === 'converted') short = outDevice?.mix ? `Converted to ${khz(outDevice.mix)}` : 'Converted by Windows';
  else if (kind === 'windows') short = on ? 'Through Windows' : 'Bit-perfect off';
  else short = 'Bit-perfect';

  return { on, kind, t, now, out, outDevice, chosen, devices, eligible, better, short };
}

/** The line by the volume, and its menu. `compact`: the small bar at the bottom shows only the dot and the state. */
export function OutputControl({ compact = false }: { compact?: boolean }) {
  const s = useSound();
  const { device, setOn, setDevice, loadDevices } = useEngine();
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (bitPerfectAvailable && !useEngine.getState().devices) void loadDevices();
  }, [loadDevices]);

  // Open: the list is asked for again (a DAC may have been plugged in), and a click elsewhere or Esc closes it.
  useEffect(() => {
    if (!open) return;
    void loadDevices();
    const away = (e: PointerEvent) => {
      if (!box.current?.contains(e.target as Node)) setOpen(false);
    };
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('pointerdown', away);
    document.addEventListener('keydown', esc);
    return () => {
      document.removeEventListener('pointerdown', away);
      document.removeEventListener('keydown', esc);
    };
  }, [open, loadDevices]);

  if (!bitPerfectAvailable) return null;
  const label = s.on ? s.out.name || 'Sound output' : 'Windows default';

  return (
    <div className={`so${compact ? ' compact' : ''}`} ref={box}>
      <button className={`so-btn so-${s.kind}`} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((o) => !o)} title={`${label} · ${s.short}`}>
        <span className="so-dot" aria-hidden />
        {compact ? (
          <span className="so-state">{s.short}</span>
        ) : (
          // Two lines, so a long device name is never cut short beside the play buttons.
          <span className="so-text">
            <strong>{label}</strong>
            <span className="so-state">{s.short}</span>
          </span>
        )}
        <svg className="so-caret" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d="m6 15 6-6 6 6" />
        </svg>
      </button>
      {open && (
        <div className="so-menu" role="menu" aria-label="Sound output">
          <button className="so-row" role="menuitemcheckbox" aria-checked={s.on} onClick={() => setOn(!s.on)}>
            <span>
              Bit-perfect
              <small>The file’s own samples, at its own rate. The volume moves to the device.</small>
            </span>
            <span className={`so-switch${s.on ? ' on' : ''}`} aria-hidden />
          </button>
          <div className="so-line" />
          <p className="so-label">Output</p>
          {s.devices === null ? (
            <p className="so-empty">Looking for sound devices…</p>
          ) : s.devices.length === 0 ? (
            <p className="so-empty">Windows reports no sound devices.</p>
          ) : (
            s.devices.map((d) => <DeviceRow key={d.id} d={d} picked={device ? d.id === device : d.isDefault} converts={s.on && s.eligible && !takesAsIs(d, s.t!.rate, s.t!.bits)} onPick={() => setDevice(d.id)} />)
          )}
          <div className="so-line" />
          <button
            className="so-foot"
            onClick={() => {
              setOpen(false);
              usePlayer.getState().setExpanded(false);
              openSettings('app');
            }}
          >
            All sound settings
          </button>
        </div>
      )}
    </div>
  );
}

function DeviceRow({ d, picked, converts, onPick }: { d: EngineDevice; picked: boolean; converts: boolean; onPick: () => void }) {
  const { name, kind } = splitDeviceName(d.name);
  const takes = describeFormats(d.exclusive);
  return (
    <button className="so-dev" role="menuitemradio" aria-checked={picked} onClick={onPick}>
      <svg className="so-tick" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <path d="m5 12.5 4.5 4.5L19 7.5" />
      </svg>
      <span>
        <b>{name}</b>
        <small>{[kind, d.isDefault ? 'Windows default' : '', takes || 'shared use only'].filter(Boolean).join(' · ')}</small>
      </span>
      {converts ? <span className="so-note">converts this</span> : <span />}
    </button>
  );
}

/** The Sound panel in the large player: a verdict, then the path from the file to the device. */
export function SoundPanel() {
  const s = useSound();
  const dataSaver = usePlayer((p) => p.dataSaver);
  const { setOn, setDevice } = useEngine.getState();
  useEffect(() => {
    void useEngine.getState().loadDevices();
  }, []);
  const t = s.t;
  if (!t) return null;

  const tier = trackTier(t);
  const depth = t.bits ? `${t.bits}-bit / ${khz(t.rate)}` : t.kbps ? `${t.kbps} kbit/s` : t.rate ? khz(t.rate) : '';
  const name = s.out.name || 'sound device';
  const mix = s.outDevice?.mix ? khz(s.outDevice.mix) : '';
  const betterName = s.better ? splitDeviceName(s.better.name).name : '';

  const verdict = { perfect: 'Bit-perfect', converted: 'Converted by Windows', windows: 'Through Windows', checking: 'Checking the output…' }[s.kind];
  const lede =
    s.kind === 'perfect'
      ? `Your ${name} gets the file’s own samples, at ${depth}.`
      : s.kind === 'converted'
        ? s.now?.reason && !/doesn't accept/.test(s.now.reason)
          ? s.now.reason
          : `The ${name} doesn’t take ${depth}, so Windows converts it on the way.`
        : s.kind === 'windows'
          ? s.on
            ? s.now?.reason ?? 'This file plays the usual way.'
            : 'Bit-perfect is off. Windows mixes nightjar with other sounds and converts it to the output’s format.'
          : '';

  const steps: { k: string; v: string; d: string; hl?: boolean }[] = [
    { k: 'The file', v: [t.format.toUpperCase(), depth].filter(Boolean).join(' · '), d: tier === 'hires' ? 'Lossless, hi-res' : tier === 'lossless' ? 'Lossless' : 'Lossy' },
  ];
  if (s.kind === 'perfect' || s.kind === 'converted') steps.push({ k: 'nightjar', v: 'Sends it as it is', d: t.format === 'flac' ? 'Unpacked from FLAC, nothing changed' : 'Read as it is, nothing changed' });
  else steps.push({ k: 'nightjar', v: dataSaver && (tier === 'hires' || tier === 'lossless') ? 'Sends a smaller AAC copy' : 'Sends the original file', d: 'Windows takes it from there' });
  if (s.kind === 'converted') steps.push({ k: 'Windows', v: mix ? `Converts it to ${mix}` : 'Converts it', d: `The ${name} takes ${describeFormats(s.outDevice?.exclusive ?? []) || 'only shared use'}`, hl: true });
  if (s.kind === 'windows') steps.push({ k: 'Windows', v: mix ? `Mixes it at ${mix}` : 'Mixes it', d: 'With every other sound on the computer', hl: true });
  steps.push({
    k: s.out.kind || 'Output',
    v: name,
    d: s.kind === 'perfect' ? (s.now?.format ?? '').replace(', exclusive', ' · exclusive') : s.kind === 'checking' ? '' : 'Shared with other programs',
    hl: s.kind === 'perfect',
  });

  return (
    <div className={`snd snd-${s.kind}`}>
      <div className="snd-verdict">
        <span className="so-dot" aria-hidden />
        <h3>{verdict}</h3>
      </div>
      {lede && <p className="snd-lede">{lede}</p>}
      <ol className="snd-chain">
        {steps.map((x) => (
          <li key={x.k} className={x.hl ? 'hl' : undefined}>
            <span className="snd-node" aria-hidden />
            <div>
              <div className="snd-k">{x.k}</div>
              <div className="snd-v">{x.v}</div>
              {x.d && <div className="snd-d">{x.d}</div>}
            </div>
          </li>
        ))}
      </ol>
      {s.kind === 'perfect' && (
        <div className="snd-aside">
          <p>The volume is set on the {name}. Windows’ volume doesn’t apply while nightjar has it, and other programs can use it again half a minute after you pause.</p>
        </div>
      )}
      {s.kind === 'converted' && s.better && (
        <div className="snd-aside">
          <p>The {betterName} takes this file as it is.</p>
          <button className="snd-act" onClick={() => setDevice(s.better!.id)}>
            Play it on the {betterName} <span aria-hidden>→</span>
          </button>
        </div>
      )}
      {s.kind === 'windows' && !s.on && s.better && (
        <div className="snd-aside">
          <p>Your {betterName} can play this file untouched.</p>
          <button
            className="snd-act"
            onClick={() => {
              if (s.chosen && !takesAsIs(s.chosen, t.rate, t.bits)) setDevice(s.better!.id);
              setOn(true);
            }}
          >
            Turn on bit-perfect <span aria-hidden>→</span>
          </button>
        </div>
      )}
    </div>
  );
}

/** "Volume is set on the …", where the volume slider was, while the device is held. */
export function HeldVolume({ className }: { className: string }) {
  const s = useSound();
  if (s.kind !== 'perfect') return null;
  return <p className={className}>Volume is set on the {s.out.name || 'sound device'}</p>;
}

import { useState } from 'react';
import { TIER_LABEL, type Tier } from '../lib/quality';

/**
 * What the quality words mean, for anyone wondering: the labels in Search and Library (what the files say about
 * themselves) and the results of Check quality (what their sound shows). Opens in place from a small link.
 */
const LABELS: [Tier, string][] = [
  ['hires', 'Lossless files above CD quality: 24-bit, or more than 48 kHz. Usually genuine, but some are CD audio in a bigger file; Check quality tells.'],
  ['lossless', 'CD quality: 16-bit, 44.1 or 48 kHz, in FLAC, WAV, ALAC and the like. Nothing is lost.'],
  ['high', 'The best MP3 or AAC: smaller files, very close to CD quality for most ears.'],
  ['mid', 'MP3s between 192 and 300 kbps, often “V0”. Good, a step below 320.'],
  ['low', 'Low-bitrate MP3s. The loss is often audible.'],
  ['unknown', 'The person’s client didn’t say what the files are.'],
];

const CHECKS: { mark: '✓' | '⚠' | '✕'; name: string; text: string }[] = [
  { mark: '✓', name: 'Verified lossless', text: 'Every track has the full range of sound a CD holds: real lossless.' },
  { mark: '✓', name: 'Verified hi-res', text: 'The sound reaches well above what a CD can hold: real hi-res.' },
  {
    mark: '✓',
    name: 'Probably hi-res',
    text: 'Nothing wrong found, but too little high sound to prove it’s hi-res. Common with older recordings and quiet music; not a fake.',
  },
  { mark: '✓', name: 'Lossless', text: 'A track with full range, or one that fades out gently as many recordings do.' },
  { mark: '✓', name: 'MP3 320 kbps (and so on)', text: 'An MP3 whose sound matches the bitrate it claims.' },
  { mark: '⚠', name: 'Mostly fine', text: 'A few tracks look wrong; “Each track” shows which. The rest are fine.' },
  { mark: '⚠', name: 'Fake 24-bit', text: 'CD audio padded to 24 bits. Sounds like CD quality, takes more space.' },
  { mark: '⚠', name: 'Upsampled', text: 'Sold as hi-res, but made from a CD-quality master: the sound stops where a CD’s does.' },
  { mark: '⚠', name: 'Suspicious', text: 'Cut off sharply near 20 kHz, like a 320 kbps MP3. Often sounds fine, but probably not true lossless.' },
  { mark: '⚠', name: 'Upconverted', text: 'An MP3 re-saved at a higher bitrate than its sound really has.' },
  { mark: '⚠', name: 'Uncertain', text: 'Too quiet to tell.' },
  { mark: '✕', name: 'Lossy source', text: 'A lossless file made from an MP3 or AAC: bigger, but no better than the MP3.' },
  { mark: '✕', name: 'Corrupt / Unreadable', text: 'Damaged or cut short: part of the music is missing. Download it again from someone else.' },
];

export function QualityGuide({ first = 'labels' }: { first?: 'labels' | 'checks' }) {
  const [open, setOpen] = useState(false);
  const labels = (
    <section key="labels">
      <h3>Labels in Search and Library</h3>
      <p className="dim">What the files say about themselves. Nobody has listened to them yet.</p>
      <dl>
        {LABELS.map(([tier, text]) => (
          <div key={tier}>
            <dt>
              <span className={`chip t-${tier} static`}>{TIER_LABEL[tier]}</span>
            </dt>
            <dd>{text}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
  const checks = (
    <section key="checks">
      <h3>Check quality results</h3>
      <p className="dim">What the sound itself shows, track by track. ✓ fine, ⚠ worth a look, ✕ not what it claims.</p>
      <dl>
        {CHECKS.map((c) => (
          <div key={c.name}>
            <dt>
              <span className={`check-chip ${c.mark === '✓' ? 'ok' : c.mark === '⚠' ? 'warn' : 'bad'}`}>
                {c.mark} {c.name}
              </span>
            </dt>
            <dd>{c.text}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
  return (
    <div className="quality-guide">
      <button className="link" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        {open ? 'Hide what the labels mean' : 'What do these labels mean?'}
      </button>
      {open && <div className="quality-guide-body">{first === 'labels' ? [labels, checks] : [checks, labels]}</div>}
    </div>
  );
}

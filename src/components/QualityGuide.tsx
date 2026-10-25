import { useEffect, useRef, useState } from 'react';
import { TIER_LABEL, type Tier } from '../lib/quality';
import { Icon } from './Icon';

/**
 * What the quality words mean, for anyone wondering: the labels in Search and Library (what the files say about
 * themselves) and the results of Check quality (what their sound shows).
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

/**
 * One button per page (Search, Downloads, Library) that opens the guide over the page. `first` puts the part that
 * page is about on top; `button` draws it like the page's other header buttons instead of a text link.
 */
export function QualityGuide({ first = 'labels', button = false }: { first?: 'labels' | 'checks'; button?: boolean }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const d = dialog.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    else if (!open && d.open) d.close();
  }, [open]);
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
    <>
      <button className={button ? 'btn quiet small' : 'link guide-link'} onClick={() => setOpen(true)} aria-haspopup="dialog">
        What do the labels mean?
      </button>
      <dialog
        ref={dialog}
        className="quality-guide"
        aria-label="What the quality labels mean"
        onClose={() => setOpen(false)}
        // A click on the dimmed backdrop (the dialog element itself, outside its content) closes it.
        onClick={(e) => e.target === e.currentTarget && setOpen(false)}
      >
        {open && (
          <div className="quality-guide-body">
            <div className="quality-guide-top">
              <h2>What the labels mean</h2>
              <button className="icon-btn" onClick={() => setOpen(false)} aria-label="Close">
                <Icon name="close" size={18} />
              </button>
            </div>
            {first === 'labels' ? [labels, checks] : [checks, labels]}
          </div>
        )}
      </dialog>
    </>
  );
}

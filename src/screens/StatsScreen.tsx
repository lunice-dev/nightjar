import { useEffect, useMemo, useState } from 'react';
import { bytes, speed as speedText } from '../lib/quality';
import {
  RANGES,
  change,
  failureReasons,
  fileTypes,
  heat,
  inRange,
  periodOf,
  records,
  series,
  toRows,
  topPeople,
  totals,
  type Measure,
  type RangeKey,
  type Row,
} from '../lib/stats';
import { useStore } from '../store';

const MEASURES: { key: Measure; label: string }[] = [
  { key: 'size', label: 'Size' },
  { key: 'files', label: 'Files' },
  { key: 'speed', label: 'Speed' },
  { key: 'failures', label: 'Failures' },
  { key: 'failRate', label: 'Failure rate' },
  { key: 'wait', label: 'Queue wait' },
];

const SLICES = 36;
const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

/** The history is large and rarely changes: keep it for a few minutes between visits. */
let cache: { at: number; backend: unknown; rows: Row[] } | null = null;

const number = (n: number) => Math.round(n).toLocaleString();
const minutes = (ms: number) => {
  const m = ms / 60_000;
  if (m < 1) return 'under a minute';
  if (m < 90) return `${Math.round(m)} min`;
  const h = m / 60;
  return h < 48 ? `${h.toFixed(1)} h` : `${Math.round(h / 24)} days`;
};
const dayText = (t: number) => new Date(t).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });

function format(measure: Measure, v: number) {
  switch (measure) {
    case 'size':
      return bytes(v);
    case 'speed':
      return speedText(v);
    case 'failRate':
      return `${v.toFixed(1)}%`;
    case 'wait':
      return minutes(v * 60_000);
    default:
      return number(v);
  }
}

function useHistory() {
  const backend = useStore((s) => s.backend);
  const [rows, setRows] = useState<Row[] | null>(cache && cache.backend === backend ? cache.rows : null);
  const [problem, setProblem] = useState<string | null>(null);
  const [again, setAgain] = useState(0);
  useEffect(() => {
    if (!backend) return;
    if (again === 0 && cache && cache.backend === backend && Date.now() - cache.at < 5 * 60_000) return;
    let live = true;
    setProblem(null);
    (async () => {
      // One after the other: the engine refuses some requests that arrive together, and a phone's connection is slow.
      const all: Row[] = [];
      const missed: string[] = [];
      let why = '';
      for (const [dir, way, name] of [['download', 'in', 'what came in'], ['upload', 'out', 'what went out']] as const) {
        try {
          all.push(...toRows(await backend.history(dir), way));
        } catch (e) {
          missed.push(name);
          why = why || (e as Error).message;
        }
      }
      if (!live) return;
      if (missed.length === 2) {
        setProblem(`The history could not be read (${why}).`);
        return;
      }
      if (missed.length === 0) cache = { at: Date.now(), backend, rows: all };
      setRows(all);
      if (missed.length) setProblem(`Couldn’t read ${missed[0]} (${why}). Showing the rest.`);
    })();
    return () => {
      live = false;
    };
  }, [backend, again]);
  return { rows, problem, retry: () => setAgain((n) => n + 1) };
}
function Chart({ a, b, measure }: { a: number[]; b: number[]; measure: Measure }) {
  const [at, setAt] = useState<number | null>(null);
  const W = 720;
  const H = 180;
  const top = Math.max(1, ...a, ...b);
  const x = (i: number) => (i / (SLICES - 1)) * W;
  const y = (v: number) => H - 4 - (v / top) * (H - 12);
  const line = (v: number[]) => v.map((n, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)} ${y(n).toFixed(1)}`).join(' ');
  return (
    <div className="st-chart">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="none"
        role="img"
        aria-label="Over time"
        onPointerMove={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          setAt(Math.max(0, Math.min(SLICES - 1, Math.round(((e.clientX - r.left) / r.width) * (SLICES - 1)))));
        }}
        onPointerLeave={() => setAt(null)}
      >
        {[0.25, 0.5, 0.75].map((f) => (
          <line key={f} x1="0" x2={W} y1={H * f} y2={H * f} className="st-grid" />
        ))}
        <path d={line(b)} className="st-line out" vectorEffect="non-scaling-stroke" />
        <path d={line(a)} className="st-line in" vectorEffect="non-scaling-stroke" />
        {at !== null && <line x1={x(at)} x2={x(at)} y1="0" y2={H} className="st-cursor" vectorEffect="non-scaling-stroke" />}
      </svg>
      <p className="st-readout" aria-live="polite">
        {at === null ? (
          <>
            Highest point: <b>{format(measure, top)}</b>
          </>
        ) : (
          <>
            <i className="dot in" /> Came in <b>{format(measure, a[at])}</b> <i className="dot out" /> Went out <b>{format(measure, b[at])}</b>
          </>
        )}
      </p>
    </div>
  );
}

function Big({ label, value, sub, delta }: { label: string; value: string; sub?: string; delta?: { text: string; up: boolean } | null }) {
  return (
    <div className="st-card">
      <p className="st-label">{label}</p>
      <p className="st-big">{value}</p>
      <p className="st-sub">
        {delta && <span className={delta.up ? 'up' : 'down'}>{delta.text}</span>} {sub}
      </p>
    </div>
  );
}

function People({ title, rows }: { title: string; rows: Row[] }) {
  const list = useMemo(() => topPeople(rows), [rows]);
  const top = list[0]?.bytes || 1;
  return (
    <section className="st-block">
      <h2>{title}</h2>
      {list.length === 0 ? (
        <p className="st-empty">Nothing in this period.</p>
      ) : (
        <ol className="st-bars">
          {list.map((p) => (
            <li key={p.person}>
              <span className="st-bar" style={{ width: `${Math.max(3, (p.bytes / top) * 100)}%` }} />
              <span className="st-name">{p.person}</span>
              <span className="st-val">
                {bytes(p.bytes)} · {number(p.files)} {p.files === 1 ? 'file' : 'files'}
              </span>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

export function StatsScreen() {
  const { rows, problem, retry } = useHistory();
  const [range, setRange] = useState<RangeKey>('30d');
  const [measure, setMeasure] = useState<Measure>('size');
  const now = useMemo(() => Date.now(), [rows]);

  const view = useMemo(() => {
    if (!rows) return null;
    const p = periodOf(range, now, rows);
    const mine = inRange(rows, p.from, p.to);
    const before = p.prev === null ? null : inRange(rows, p.prev, p.from);
    const inn = mine.filter((r) => r.way === 'in');
    const out = mine.filter((r) => r.way === 'out');
    const ti = totals(inn);
    const to = totals(out);
    const bi = before ? totals(before.filter((r) => r.way === 'in')) : null;
    const bo = before ? totals(before.filter((r) => r.way === 'out')) : null;
    return {
      p,
      inn,
      out,
      ti,
      to,
      bi,
      bo,
      a: series(inn, p.from, p.to, SLICES, measure),
      b: series(out, p.from, p.to, SLICES, measure),
      types: fileTypes(inn).slice(0, 6),
      grid: heat(mine),
      rec: records(inn),
      why: failureReasons(mine),
    };
  }, [rows, range, measure, now]);

  const hotMax = view ? Math.max(1, ...view.grid.flat()) : 1;

  return (
    <div className="page">
      <div className="page-inner stats">
        <div className="page-head">
          <h1 className="page-title">Statistics</h1>
          <p className="page-sub">Everything nightjar has moved, as far back as your engine remembers.</p>
        </div>

        <div className="st-ranges" role="group" aria-label="Period">
          {RANGES.map((r) => (
            <button key={r.key} className={range === r.key ? 'on' : ''} aria-pressed={range === r.key} onClick={() => setRange(r.key)}>
              {r.label}
            </button>
          ))}
        </div>

        {problem && (
          <p className="st-empty">
            {problem}{' '}
            <button className="link" onClick={retry}>
              Try again
            </button>
          </p>
        )}
        {!rows && !problem && <p className="st-empty">Reading your history… this can take a moment on a phone.</p>}

        {view && (
          <>
            <div className="st-cards">
              <Big label="Came in" value={bytes(view.ti.bytes)} sub={`${number(view.ti.files)} files`} delta={view.bi ? change(view.ti.bytes, view.bi.bytes) : null} />
              <Big label="Went out" value={bytes(view.to.bytes)} sub={`${number(view.to.files)} files`} delta={view.bo ? change(view.to.bytes, view.bo.bytes) : null} />
              <Big
                label="Share ratio"
                value={view.ti.bytes ? (view.to.bytes / view.ti.bytes).toFixed(2) : view.to.bytes ? 'All out' : '–'}
                sub={view.to.bytes >= view.ti.bytes ? 'You give more than you take' : 'You take more than you give'}
              />
              <Big label="People" value={number(new Set([...view.inn, ...view.out].filter((r) => r.ok).map((r) => r.person)).size)} sub="you exchanged files with" />
            </div>

            <section className="st-block">
              <div className="st-head">
                <h2>Over time</h2>
                <div className="st-measures" role="group" aria-label="Measure">
                  {MEASURES.map((m) => (
                    <button key={m.key} className={measure === m.key ? 'on' : ''} aria-pressed={measure === m.key} onClick={() => setMeasure(m.key)}>
                      {m.label}
                    </button>
                  ))}
                </div>
              </div>
              <Chart a={view.a} b={view.b} measure={measure} />
              <p className="st-legend">
                <i className="dot in" /> Came in <i className="dot out" /> Went out
              </p>
            </section>

            <div className="st-two">
              <People title="Who gave you the most" rows={view.inn} />
              <People title="Who you gave the most" rows={view.out} />
            </div>

            <div className="st-two">
              <section className="st-block">
                <h2>File types</h2>
                {view.types.length === 0 ? (
                  <p className="st-empty">Nothing in this period.</p>
                ) : (
                  <ul className="st-types">
                    {view.types.map((t) => (
                      <li key={t.ext}>
                        <b>{t.ext}</b>
                        <span>
                          {number(t.files)} files · {bytes(t.bytes)}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
              <section className="st-block">
                <h2>When it happens</h2>
                <div className="st-heat" role="img" aria-label="Files by weekday and hour">
                  {view.grid.map((day, d) => (
                    <div key={DAYS[d]} className="st-heat-row">
                      <span>{DAYS[d]}</span>
                      {day.map((n, h) => (
                        <i key={h} title={`${DAYS[d]} ${h}:00 · ${n} files`} style={{ opacity: n ? 0.15 + 0.85 * (n / hotMax) : 0.05 }} />
                      ))}
                    </div>
                  ))}
                </div>
              </section>
            </div>

            <section className="st-block">
              <h2>Records</h2>
              <dl className="st-records">
                {view.rec.biggest && (
                  <div>
                    <dt>Biggest file</dt>
                    <dd>
                      {bytes(view.rec.biggest.bytes)} <small>{view.rec.biggest.name}</small>
                    </dd>
                  </div>
                )}
                {view.rec.fastest && (
                  <div>
                    <dt>Fastest</dt>
                    <dd>
                      {speedText(view.rec.fastest.speed)} <small>{view.rec.fastest.name}</small>
                    </dd>
                  </div>
                )}
                {view.rec.longestWait && (
                  <div>
                    <dt>Longest wait in a queue</dt>
                    <dd>{minutes(view.rec.longestWait.wait)}</dd>
                  </div>
                )}
                {view.rec.busiestDay && (
                  <div>
                    <dt>Busiest day</dt>
                    <dd>
                      {dayText(view.rec.busiestDay.day)} <small>{bytes(view.rec.busiestDay.bytes)} in {number(view.rec.busiestDay.files)} files</small>
                    </dd>
                  </div>
                )}
              </dl>
            </section>

            <section className="st-block">
              <h2>What didn’t work</h2>
              {view.why.length === 0 ? (
                <p className="st-empty">Nothing failed in this period.</p>
              ) : (
                <ul className="st-types">
                  {view.why.map((w) => (
                    <li key={w.why}>
                      <b>{w.why}</b>
                      <span>{number(w.count)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </>
        )}
      </div>
    </div>
  );
}

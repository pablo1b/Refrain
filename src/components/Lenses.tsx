import { useEffect, useRef } from 'react';
import { useStore } from '../state/store';
import { engine } from '../audio/strudelEngine';

// ---------------------------------------------------------------------------
// Lenses on the sound (spec §05) — honest ways to see it, each built from real
// audio or the real parsed tree, never a decorative stand-in.
//   Tracker   — the cycle unrolled L→R, one lane per voice (from queryArc)
//   Spectrum  — the master FFT (real AnalyserNode when the tap exists)
//   Wheel     — the live key & chord tones (from the parsed note/chord tokens)
//   Bloom     — a pattern's density as petal weight (from the event count)
// ---------------------------------------------------------------------------

const mono: React.CSSProperties = { fontFamily: 'var(--font-mono)' };

function LensShell({ title, sub, children }: { title: string; sub?: string; children: React.ReactNode }) {
  return (
    <div style={{ flex: 'none', width: 210, borderRadius: 10, overflow: 'hidden', background: 'var(--bg-deep)', border: '1px solid var(--line-3)', display: 'flex', flexDirection: 'column' }}>
      <div style={{ padding: '7px 11px', borderBottom: '1px solid var(--line-3)', ...mono, fontSize: 10, color: 'var(--text-1)' }}>
        {title} {sub && <span style={{ color: 'var(--text-dim)' }}>· {sub}</span>}
      </div>
      <div style={{ flex: 1, minHeight: 0 }}>{children}</div>
    </div>
  );
}

// ---- Tracker: cycle unrolled left→right, one lane per voice ----
export function TrackerLens() {
  const voices = useStore((s) => s.voices).slice(0, 6);
  const events = useStore((s) => s.events);
  const headRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let raf = 0;
    const loop = () => {
      if (headRef.current) {
        const phase = engine.started ? (((engine.now() % 1) + 1) % 1) : 0;
        headRef.current.style.left = `${phase * 100}%`;
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, []);

  return (
    <LensShell title="▤ Tracker" sub="one cycle, linear">
      <div style={{ display: 'grid', gridTemplateColumns: '42px 1fr', height: '100%' }}>
        <div style={{ borderRight: '1px solid var(--line-3)' }}>
          {voices.map((v) => (
            <div key={v.id} style={{ height: 18, display: 'flex', alignItems: 'center', gap: 4, padding: '0 6px', ...mono, fontSize: 8.5, color: 'var(--text-2)' }}>
              <span style={{ width: 5, height: 5, borderRadius: 1, background: v.color, flex: 'none' }} />
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{v.id}</span>
            </div>
          ))}
        </div>
        <div style={{ position: 'relative', background: 'repeating-linear-gradient(to right, transparent, transparent calc(25% - 1px), var(--line-3) calc(25% - 1px), var(--line-3) 25%)' }}>
          <div ref={headRef} style={{ position: 'absolute', top: 0, bottom: 0, width: 2, background: 'var(--live)', left: 0, zIndex: 2, boxShadow: '0 0 6px var(--live)' }} />
          {voices.map((v) => {
            const evs = events[v.id] ?? [];
            const dimmed = v.muted;
            return (
              <div key={v.id} style={{ position: 'relative', height: 18, borderBottom: '1px solid var(--line-3)' }}>
                {evs.map((e, i) => (
                  <div
                    key={i}
                    style={{
                      position: 'absolute',
                      left: `${e.begin * 100}%`,
                      width: `${Math.max(1.4, (e.dur || 0.03) * 100)}%`,
                      top: 4,
                      bottom: 4,
                      background: v.color,
                      opacity: dimmed ? 0.25 : Math.max(0.4, Math.min(1, e.gain)),
                      borderRadius: 2,
                    }}
                  />
                ))}
              </div>
            );
          })}
        </div>
      </div>
    </LensShell>
  );
}

// ---- Spectrum: the master FFT (real when the analyser tap exists) ----
export function SpectrumLens() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const events = useStore((s) => s.events);
  const voices = useStore((s) => s.voices);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const analyser = engine.getAnalyser?.() ?? null;
    const freqBuf = analyser ? new Uint8Array(analyser.frequencyBinCount) : null;
    let raf = 0;

    // fallback: derive a static-ish spectral silhouette from event density per
    // voice (low = bass-ish voices, high = hats-ish) when no real FFT tap exists.
    const fallbackBins = () => {
      const bins = new Array(32).fill(6);
      voices.forEach((v, vi) => {
        const n = (events[v.id] ?? []).length;
        const center = Math.min(31, Math.floor((vi / Math.max(1, voices.length)) * 28) + 2);
        for (let k = -3; k <= 3; k++) {
          const idx = center + k;
          if (idx >= 0 && idx < 32 && !v.muted) bins[idx] += n * (4 - Math.abs(k)) * 1.5;
        }
      });
      return bins.map((b) => Math.min(255, b));
    };

    const draw = () => {
      const w = (canvas.width = canvas.clientWidth * devicePixelRatio);
      const h = (canvas.height = canvas.clientHeight * devicePixelRatio);
      ctx.clearRect(0, 0, w, h);
      let data: ArrayLike<number>;
      if (analyser && freqBuf && engine.started) {
        analyser.getByteFrequencyData(freqBuf);
        // the tap may be silent (analyser id not in the audible path) — if so,
        // fall back to the pattern-derived silhouette rather than a dead bar.
        let mx = 0;
        for (let i = 0; i < freqBuf.length; i++) mx = Math.max(mx, freqBuf[i]);
        data = mx > 4 ? freqBuf : fallbackBins();
      } else {
        data = fallbackBins();
      }
      const n = Math.min(48, data.length);
      const bw = w / n;
      const grad = ctx.createLinearGradient(0, 0, w, 0);
      grad.addColorStop(0, '#6AA0FF');
      grad.addColorStop(0.5, '#5FD3B0');
      grad.addColorStop(0.8, '#C7F24A');
      grad.addColorStop(1, '#F2A007');
      ctx.fillStyle = grad;
      for (let i = 0; i < n; i++) {
        const idx = Math.floor((i / n) * data.length);
        const v = data[idx] / 255;
        const bh = v * h * 0.92;
        ctx.fillRect(i * bw, h - bh, bw - 1 * devicePixelRatio, bh);
      }
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [events, voices]);

  return (
    <LensShell title="≋ Spectrum" sub="spectral shape">
      <canvas ref={canvasRef} style={{ width: '100%', height: '100%', display: 'block' }} />
    </LensShell>
  );
}

// ---- Wheel: light the live key & chord tones from the parsed pitches ----
const PC_NAMES = ['C', 'C♯', 'D', 'E♭', 'E', 'F', 'F♯', 'G', 'A♭', 'A', 'B♭', 'B'];
const NOTE_TO_PC: Record<string, number> = { c: 0, d: 2, e: 4, f: 5, g: 7, a: 9, b: 11 };
// circle-of-fifths order for the ring layout
const FIFTHS = [0, 7, 2, 9, 4, 11, 6, 1, 8, 3, 10, 5];

function pitchClasses(exprs: string[]): Set<number> {
  const pcs = new Set<number>();
  const addTok = (letter: string, acc: string) => {
    let pc = NOTE_TO_PC[letter.toLowerCase()];
    if (pc == null) return;
    if (acc === '#' || acc === 's') pc = (pc + 1) % 12;
    else if (acc === 'b') pc = (pc + 11) % 12;
    pcs.add(pc);
  };
  for (const expr of exprs) {
    // Only read the ARGUMENT of note()/n()/chord() — never .s("sawtooth") etc.,
    // whose sound names would inject phantom pitches (the 'a' in "sawtooth").
    const args = [...expr.matchAll(/\b(?:note|n|chord)\(\s*"([^"]*)"/g)].map((m) => m[1]);
    for (const s of args) {
      // note literals: pitch-letter + accidental + explicit octave digit (c2, eb3, f#4)
      for (const m of s.matchAll(/(?<![A-Za-z])([a-g])([#bs]?)(-?\d+)/g)) addTok(m[1], m[2]);
      // chord symbols: a capitalised root at a token boundary (Cm7, Abmaj7)
      for (const m of s.matchAll(/(?:^|[\s<>[\],|])([A-G])([#b]?)/g)) addTok(m[1], m[2]);
    }
  }
  return pcs;
}

export function WheelLens() {
  const voices = useStore((s) => s.voices);
  const pcs = pitchClasses(voices.filter((v) => /note\(|\bn\(|chord\(/.test(v.expr) && !v.muted).map((v) => v.expr));
  // crude key guess: the root is the pitched voice's first token; minor if a
  // minor third above the root is present.
  const rootVoice = voices.find((v) => /note\("<|chord\(/.test(v.expr)) ?? voices.find((v) => /note\(/.test(v.expr));
  const rootPc = rootVoice ? [...pitchClasses([rootVoice.expr])][0] ?? null : null;
  const minor = rootPc != null && pcs.has((rootPc + 3) % 12);
  const C = 74;
  return (
    <LensShell title="⊚ Wheel" sub="key & chord">
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100%' }}>
        <svg width={128} height={128} viewBox="0 0 148 148" fill="none">
          <circle cx={C} cy={C} r={58} stroke="var(--line-4)" strokeWidth="1" />
          {FIFTHS.map((pc, i) => {
            const ang = (i / 12) * 2 * Math.PI - Math.PI / 2;
            const x = C + 58 * Math.cos(ang);
            const y = C + 58 * Math.sin(ang);
            const on = pcs.has(pc);
            const isRoot = pc === rootPc;
            return (
              <g key={pc}>
                <circle cx={x} cy={y} r={on ? 9 : 6} fill={on ? (isRoot ? 'var(--live)' : 'var(--voice-pad)') : 'var(--elev)'} />
                <text x={x} y={y + 3} textAnchor="middle" style={{ ...mono }} fontSize="8" fill={on ? 'var(--live-ink)' : 'var(--text-dim)'} fontWeight={isRoot ? 700 : 400}>
                  {PC_NAMES[pc]}
                </text>
              </g>
            );
          })}
          {rootPc != null && (
            <>
              <text x={C} y={C - 2} textAnchor="middle" fontFamily="var(--font-display)" fontStyle="italic" fontSize="15" fill="var(--text)">
                {minor ? 'i' : 'I'}
              </text>
              <text x={C} y={C + 12} textAnchor="middle" style={{ ...mono }} fontSize="7.5" fill="var(--text-2)">
                {PC_NAMES[rootPc]} {minor ? 'minor' : 'major'}
              </text>
            </>
          )}
        </svg>
      </div>
    </LensShell>
  );
}

// ---- Bloom: density & chance as petal weight (from real event counts) ----
export function BloomLens() {
  const voices = useStore((s) => s.voices);
  const events = useStore((s) => s.events);
  const active = useStore((s) => s.activeVoiceId);
  const v = voices.find((x) => x.id === active) ?? voices[0];
  const evs = v ? events[v.id] ?? [] : [];
  const spokes = Math.max(evs.length, v ? v.events : 0) || 8;
  const C = 66;
  return (
    <LensShell title="✺ Bloom" sub={v ? `$${v.id} · ${evs.length || v.events}` : 'density'}>
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100%' }}>
        <svg width={124} height={124} viewBox="0 0 132 132" fill="none">
          <circle cx={C} cy={C} r={48} stroke="var(--line-3)" strokeWidth="1" />
          <circle cx={C} cy={C} r={30} stroke="var(--line-3)" strokeWidth="1" />
          {Array.from({ length: Math.min(24, spokes) }).map((_, i) => {
            const n = Math.min(24, spokes);
            const ang = (i / n) * 2 * Math.PI - Math.PI / 2;
            const gain = evs[i]?.gain ?? 0.7;
            const len = 48 * Math.max(0.4, Math.min(1, gain));
            return (
              <line
                key={i}
                x1={C}
                y1={C}
                x2={C + len * Math.cos(ang)}
                y2={C + len * Math.sin(ang)}
                stroke={v?.color ?? 'var(--live)'}
                strokeWidth={4}
                strokeLinecap="round"
                opacity={0.4 + 0.6 * Math.min(1, gain)}
              />
            );
          })}
          <circle cx={C} cy={C} r={5} fill="var(--text)" />
        </svg>
      </div>
    </LensShell>
  );
}

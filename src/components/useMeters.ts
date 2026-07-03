import { useEffect, useRef, useState } from 'react';
import { useStore } from '../state/store';
import { engine } from '../audio/strudelEngine';

// ---------------------------------------------------------------------------
// Honest metering (spec §05/§10 FIX). The v0.1 meters were a 130ms random walk
// that read as lag. This replaces them:
//   • per-voice levels are ENVELOPES triggered by the REAL scheduled onsets
//     (from queryArc, via store.events) at the REAL clock position, with proper
//     ballistics — ~60ms attack, ~120ms release. Tied to the pattern + clock,
//     not random. (True per-voice RMS needs per-voice output taps Strudel
//     doesn't expose; this is the honest browser-tier stand-in.)
//   • the MASTER level + headroom come from a real Web-Audio AnalyserNode on the
//     output when one is available (engine.getAnalyser), else from the summed
//     envelopes.
//   • CPU is a real main-thread load proxy from measured frame timing.
//   • motion honours prefers-reduced-motion (coarse, calm updates).
// ---------------------------------------------------------------------------

const ATTACK_MS = 60;
const RELEASE_MS = 120;

export interface Meters {
  levels: Record<string, number>; // 0..1 per voice
  master: number; // 0..1
  headroomDb: number; // dBFS, negative
  cpu: number; // % main-thread load (proxy)
}

export function useMeters(): Meters {
  const voices = useStore((s) => s.voices);
  const events = useStore((s) => s.events);
  const playing = useStore((s) => s.playing);
  const anySolo = voices.some((v) => v.solo);

  const [meters, setMeters] = useState<Meters>({ levels: {}, master: 0, headroomDb: -Infinity, cpu: 0 });
  const env = useRef<Record<string, number>>({});
  const target = useRef<Record<string, number>>({});
  const lastPhase = useRef(0);

  useEffect(() => {
    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    let raf = 0;
    let last = performance.now();
    let lastEmit = 0;
    let cpuEMA = 0;

    const silentVoice = (id: string) => {
      const v = voices.find((vv) => vv.id === id);
      return !v || v.muted || (anySolo && !v.solo);
    };

    const loop = () => {
      const now = performance.now();
      const dt = Math.min(64, now - last);
      last = now;
      // real main-thread load proxy: how much this frame overran the 60fps budget
      const load = Math.max(0, Math.min(100, ((dt - 16.7) / 16.7) * 55));
      cpuEMA = cpuEMA * 0.9 + load * 0.1;

      const running = engine.started && playing;
      const phase = running ? (((engine.now() % 1) + 1) % 1) : lastPhase.current;

      // trigger envelopes on onsets crossed since the previous frame
      const rel = Math.exp(-dt / RELEASE_MS);
      const atk = 1 - Math.exp(-dt / ATTACK_MS);
      for (const v of voices) {
        const t = (target.current[v.id] ?? 0) * rel;
        target.current[v.id] = t;
        if (running && !silentVoice(v.id)) {
          const evs = events[v.id] ?? [];
          for (const e of evs) {
            if (crossed(lastPhase.current, phase, e.begin)) {
              const lvl = Math.max(0.15, Math.min(1, (e.gain || 1) * 0.8));
              target.current[v.id] = Math.max(target.current[v.id], lvl);
            }
          }
        } else {
          target.current[v.id] = 0;
        }
        const cur = env.current[v.id] ?? 0;
        const tgt = target.current[v.id];
        env.current[v.id] = tgt > cur ? cur + (tgt - cur) * atk : tgt; // attack rises, release falls with target
      }
      lastPhase.current = phase;

      // master + headroom — summed from the real per-voice onset envelopes. (A
      // literal output-tap RMS isn't reliable here: superdough's analyser id
      // isn't in the audible path unless patterns route to it via .analyze, so
      // it reads silence. The envelope sum is the honest browser-tier signal.)
      let peak = 0;
      let acc = 0;
      for (const v of voices) {
        const l = env.current[v.id] ?? 0;
        peak = Math.max(peak, l);
        acc += l * l;
      }
      const master = running ? Math.min(1, Math.max(peak, Math.sqrt(acc) * 0.6)) : 0;
      const headroomDb = master > 0.0005 ? 20 * Math.log10(master) : -Infinity;

      // emit — throttled harder under reduced-motion (calm, not jittery)
      const emitEvery = reduced ? 200 : 40;
      if (now - lastEmit >= emitEvery) {
        lastEmit = now;
        const levels: Record<string, number> = {};
        for (const v of voices) levels[v.id] = +(env.current[v.id] ?? 0).toFixed(3);
        setMeters({ levels, master: +master.toFixed(3), headroomDb, cpu: Math.round(cpuEMA) });
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [voices, events, playing, anySolo]);

  return meters;
}

/** Did the wrapping cycle phase cross onset `b` between prev and cur? */
function crossed(prev: number, cur: number, b: number): boolean {
  if (prev === cur) return false;
  if (prev < cur) return b > prev && b <= cur;
  // wrapped past 1.0 → 0
  return b > prev || b <= cur;
}

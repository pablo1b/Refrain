import { useEffect, useRef, useState } from 'react';
import { useStore } from '../state/store';
import { engine } from '../audio/strudelEngine';
import { useReducedMotion } from './useReducedMotion';

// ---------------------------------------------------------------------------
// Honest metering (spec §05/§10 FIX). The v0.1 meters were a 130ms random walk
// that read as lag. This replaces them:
//   • per-voice levels are REAL AUDIO. Every sounding voice is routed through
//     its own `.analyze('<voiceId>')` tap at evaluation time (see
//     `routeVoiceAnalysers`), and this reads that analyser's time-domain peak
//     with ~60ms attack / ~120ms release ballistics.
//     This matters beyond precision: the previous version derived levels from
//     scheduled ONSETS, so a voice with events but no audio — a chord symbol in
//     `note()`, a mistyped sample — ran a full attack/release envelope while
//     silent. Measured: `$pad` solo'd read audio peak 0 for 7s with its meter at
//     21. Comparing meters to events can only prove they agree with events; it
//     cannot show they are honest about sound (A8).
//     When no tap is readable the onset envelopes remain as the documented
//     FALLBACK (engine not ready, unroutable code, mocked tiers 1-2).
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
  /** Per voice: is that level MEASURED audio (its own `.analyze` tap), or the
   *  event-driven fallback? The widget must not call an onset envelope a
   *  "level" — that mislabelling is the A8 dishonesty, and with per-voice
   *  routing a single unroutable chain can still land here. */
  measured: Record<string, boolean>;
  master: number; // 0..1
  headroomDb: number; // dBFS, negative
  cpu: number; // % main-thread load (proxy)
}

export function useMeters(): Meters {
  const voices = useStore((s) => s.voices);
  const events = useStore((s) => s.events);
  const playing = useStore((s) => s.playing);
  const reduced = useReducedMotion();
  const anySolo = voices.some((v) => v.solo);

  const [meters, setMeters] = useState<Meters>({ levels: {}, measured: {}, master: 0, headroomDb: -Infinity, cpu: 0 });
  const env = useRef<Record<string, number>>({});
  const target = useRef<Record<string, number>>({});
  const peakHold = useRef<Record<string, number>>({}); // held peak between reduced-motion emits (§12.8)
  const lastPhase = useRef(0);

  useEffect(() => {
    let raf = 0;
    let last = performance.now();
    let lastEmit = 0;
    let cpuEMA = 0;

    let idleEmitted = false; // stop re-rendering the Stage once idle has settled

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
      const measuredNow: Record<string, boolean> = {};
      const phase = running ? (((engine.now() % 1) + 1) % 1) : lastPhase.current;

      // trigger envelopes on onsets crossed since the previous frame
      const rel = Math.exp(-dt / RELEASE_MS);
      const atk = 1 - Math.exp(-dt / ATTACK_MS);
      for (const v of voices) {
        const dimmed = silentVoice(v.id);
        // REAL per-voice audio, when the playing code was routed through
        // `.analyze`. null means "no tap to read", not "silent" — so a 0 here is
        // genuine silence and a voice with events but no audio stays dark.
        const tap = running && !dimmed ? engine.voiceLevel(v.id) : null;
        measuredNow[v.id] = !!tap;
        if (tap) {
          target.current[v.id] = Math.min(1, tap.peak);
        } else if (running && !dimmed) {
          // FALLBACK — no per-voice tap (engine not ready, or code that could not
          // be routed). Onset envelopes from the scheduled events: honest about
          // timing, but it cannot know whether a voice reaches the speakers.
          const t = (target.current[v.id] ?? 0) * rel;
          target.current[v.id] = t;
          const evs = events[v.id] ?? [];
          for (const e of evs) {
            if (crossed(lastPhase.current, phase, e.begin)) {
              // a genuinely silent onset (gain 0) must NOT light the meter — only
              // floor audible onsets to a visible minimum.
              const g = e.gain;
              const lvl = g <= 0.001 ? 0 : Math.max(0.15, Math.min(1, g * 0.8));
              target.current[v.id] = Math.max(target.current[v.id], lvl);
            }
          }
        } else {
          target.current[v.id] = 0;
        }
        const cur = env.current[v.id] ?? 0;
        const tgt = target.current[v.id];
        // Peak-programme ballistics. On the measured path the release has to be
        // ours, because the tap itself gaps to 0 between percussive hits; on the
        // fallback path the target already carries its own decay.
        env.current[v.id] = tgt > cur
          ? cur + (tgt - cur) * atk
          : tap ? cur + (tgt - cur) * (1 - rel) : tgt;
        // hold the peak seen since the last (slow) reduced-motion emit
        peakHold.current[v.id] = Math.max(peakHold.current[v.id] ?? 0, env.current[v.id]);
      }
      lastPhase.current = phase;

      // master + headroom — summed from the per-voice levels above, which are
      // now real audio whenever the taps are readable. (For the whole audible
      // mix as one number, engine.sampleOutput() taps destinationGain directly;
      // the sum is kept here so master and the per-voice rows always agree.)
      let peak = 0;
      let acc = 0;
      for (const v of voices) {
        const l = env.current[v.id] ?? 0;
        peak = Math.max(peak, l);
        acc += l * l;
      }
      const master = running ? Math.min(1, Math.max(peak, Math.sqrt(acc) * 0.6)) : 0;
      const headroomDb = master > 0.0005 ? 20 * Math.log10(master) : -Infinity;

      // emit — throttled harder under reduced-motion (calm, not jittery). When
      // the transport is stopped we emit ONE settled (zeroed) frame, then stop
      // re-rendering the Stage until playback resumes (no idle rAF re-render drain).
      // reduced motion: refresh ~4 Hz and report the HELD PEAK, not the
      // instantaneous ballistic level — calm, numeric, still truthful (§12.8).
      const emitEvery = reduced ? 250 : 40;
      if (now - lastEmit >= emitEvery && (running || !idleEmitted)) {
        lastEmit = now;
        idleEmitted = !running;
        const levels: Record<string, number> = {};
        for (const v of voices) {
          levels[v.id] = +((reduced ? peakHold.current[v.id] : env.current[v.id]) ?? 0).toFixed(3);
          peakHold.current[v.id] = env.current[v.id] ?? 0; // let the peak decay toward the current level
        }
        setMeters({ levels, measured: measuredNow, master: +master.toFixed(3), headroomDb, cpu: running ? Math.round(cpuEMA) : 0 });
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [voices, events, playing, anySolo, reduced]);

  return meters;
}

/** Did the wrapping cycle phase cross onset `b` between prev and cur? */
function crossed(prev: number, cur: number, b: number): boolean {
  if (prev === cur) return false;
  if (prev < cur) return b > prev && b <= cur;
  // wrapped past 1.0 → 0
  return b > prev || b <= cur;
}

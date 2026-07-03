// ---------------------------------------------------------------------------
// Refrain audio engine — a thin wrapper over the *real* Strudel REPL
// (@strudel/web). Nothing about Strudel playback changes; we just hold the
// repl handle so the Cycle clock can read the scheduler and so edits can be
// auditioned and panicked safely.
// ---------------------------------------------------------------------------

import { SAMPLE_PACKS, SAMPLE_JSON } from '../theme/tokens';

type Repl = {
  scheduler: {
    now: () => number;
    cps: number;
    started: boolean;
    pattern?: unknown;
  };
  evaluate: (code: string, autoplay?: boolean) => Promise<unknown>;
  start: () => void;
  stop: () => void;
  setCps: (cps: number) => void;
  state: { started: boolean; pattern?: unknown; error?: unknown };
};

export type EngineStatus = 'idle' | 'loading' | 'ready' | 'error';

/** One scheduled onset within a cycle: begin/dur in cycles (0..1), relative gain. */
export interface EngineEvent {
  begin: number;
  dur: number;
  gain: number;
}

class StrudelEngine {
  private repl: Repl | null = null;
  private transpile: ((code: string) => Promise<{ pattern: any }>) | null = null;
  private web: any = null;
  private analyser: AnalyserNode | null = null;
  status: EngineStatus = 'idle';
  error: string | null = null;
  private initPromise: Promise<boolean> | null = null;
  onStatus: ((s: EngineStatus, error?: string | null) => void) | null = null;

  private set(s: EngineStatus, err: string | null = null) {
    this.status = s;
    this.error = err;
    this.onStatus?.(s, err);
  }

  get ready() {
    return this.status === 'ready' && !!this.repl;
  }

  /** Idempotent. Resolves true when audio + samples are ready. */
  async init(): Promise<boolean> {
    if (this.initPromise) return this.initPromise;
    this.initPromise = (async () => {
      try {
        this.set('loading');
        const web = await import('@strudel/web');
        const { initStrudel, samples, registerSynthSounds, aliasBank } = web as any;
        // Keep the module around for the master analyser (getAudioContext /
        // superdough analyser helpers) — see getAnalyser().
        this.web = web as any;

        const repl = await initStrudel({
          prebake: async () => {
            const ds = SAMPLE_PACKS.dough;
            const ts = SAMPLE_PACKS.todepond;
            try {
              await Promise.all([
                registerSynthSounds?.(),
                ...SAMPLE_JSON.map((f) => samples(`${ds}${f}`)),
              ]);
              aliasBank?.(`${ts}tidal-drum-machines-alias.json`);
            } catch (e) {
              // Samples are best-effort — synth voices still sound offline.
              console.warn('[refrain] sample prebake partial:', e);
            }
          },
        });
        this.repl = repl as Repl;

        // A separate, non-playing evaluator for clock queries. We must NOT use
        // @strudel/web's exported `evaluate` — that one is bound to the live
        // playback repl (it calls `repl.evaluate(code, /*autoplay*/ true)`), so
        // querying a voice would hijack the scheduler and replace the score.
        // @strudel/transpiler.evaluate is the *pure* `core.evaluate(code, F)`:
        // it returns { pattern } with no repl, no scheduler, no side effects.
        //
        // It does pull in a second @strudel/core instance, which logs the benign
        // "loaded more than once" warning. That second core is only ever used
        // here for read-only one-shot queryArc (tick drawing) — its objects are
        // never fed back into web's repl — so the duplication is harmless. We
        // clear the load flag around the import to suppress the noisy warning
        // (graceful: if the internal flag name ever changes, the warning simply
        // returns; nothing breaks).
        const g = globalThis as any;
        const hadCore = g._strudelLoaded;
        g._strudelLoaded = undefined;
        try {
          const { evaluate: transpilerEvaluate } = await import('@strudel/transpiler');
          this.transpile = typeof transpilerEvaluate === 'function'
            ? (code: string) => transpilerEvaluate(code)
            : null;
        } finally {
          g._strudelLoaded = hadCore ?? true;
        }

        this.set('ready');
        return true;
      } catch (e: any) {
        this.set('error', e?.message ?? String(e));
        return false;
      }
    })();
    return this.initPromise;
  }

  /** Evaluate code and (by default) play it on the shared scheduler. */
  async evaluate(code: string, autoplay = true): Promise<{ ok: boolean; error?: string }> {
    if (!this.repl) return { ok: false, error: 'engine not ready' };
    try {
      // repl.evaluate SWALLOWS transpile/eval errors — it logs, sets
      // repl.state.error and resolves undefined (never rejects). So the try/catch
      // only catches synchronous throws; we must also inspect state.error after
      // the await to surface bad-code feedback (skill: strudel-engine).
      const before = this.repl.state?.error;
      await this.repl.evaluate(code, autoplay);
      const err = this.repl.state?.error;
      if (err && err !== before) {
        return { ok: false, error: this.cleanError((err as any)?.message ?? String(err)) };
      }
      return { ok: true };
    } catch (e: any) {
      return { ok: false, error: this.cleanError(e?.message ?? String(e)) };
    }
  }

  stop() {
    try {
      this.repl?.stop();
    } catch {
      /* noop */
    }
  }

  /** PANIC — hush all voices instantly. The transport (clock) keeps running. */
  async panic() {
    try {
      await this.repl?.evaluate('silence', true);
    } catch {
      this.repl?.stop();
    }
  }

  setCps(cps: number) {
    try {
      this.repl?.setCps(cps);
    } catch {
      /* noop */
    }
  }

  /** Fractional cycle position from the live scheduler. */
  now(): number {
    try {
      return this.repl?.scheduler.now() ?? 0;
    } catch {
      return 0;
    }
  }

  get cps(): number {
    return this.repl?.scheduler.cps ?? 0.5;
  }

  get started(): boolean {
    return !!this.repl?.scheduler.started;
  }

  /**
   * A master AnalyserNode for real RMS + FFT (the Meters + Spectrum lenses,
   * spec §05). Best-effort: superdough exposes a master analyser via
   * `getAnalyser(id)` — we look it up on the @strudel/web module. If the audio
   * graph exposes no tap, returns null and the meters fall back to the honest
   * event-driven envelopes. Cached once obtained.
   */
  getAnalyser(): AnalyserNode | null {
    if (this.analyser) return this.analyser;
    const w = this.web;
    if (!w) return null;
    try {
      const getA = w.getAnalyser ?? w.getAnalyserById;
      if (typeof getA === 'function') {
        const a = getA(1) as AnalyserNode;
        if (a && typeof a.getByteTimeDomainData === 'function') {
          this.analyser = a;
          return a;
        }
      }
    } catch {
      /* no tap available — fall back to envelopes */
    }
    return null;
  }

  /**
   * Query one cycle of a voice expression → events with begin offset in [0,1),
   * duration (in cycles) and relative gain. Feeds the Cycle clock rings, the
   * Tracker lens (begin+dur → a bar) and the honest event-driven meters (onset
   * envelopes). Best-effort: a broken voice just yields no events (it never
   * reaches the speakers either).
   */
  async queryEvents(expr: string): Promise<EngineEvent[]> {
    if (!this.transpile || !expr.trim()) return [];
    try {
      const { pattern } = await this.transpile(expr);
      if (!pattern || typeof pattern.queryArc !== 'function') return [];
      // Query a slightly wider arc so onsets nudged just before 0 (rubato) or
      // a late copy spilling past 1.0 (stretto) aren't lost, then fold each
      // begin back into [0,1) so it lands on the correct ring angle.
      const haps = pattern.queryArc(-0.0625, 1) as any[];
      const num = (x: any) => (typeof x?.valueOf === 'function' ? Number(x.valueOf()) : Number(x));
      const events: EngineEvent[] = [];
      const seen = new Set<number>();
      for (const h of haps) {
        if (!h?.whole || !(h.hasOnset?.() ?? true)) continue;
        const raw = num(h.whole.begin);
        if (Number.isNaN(raw)) continue;
        const begin = +(((raw % 1) + 1) % 1).toFixed(4);
        if (seen.has(begin)) continue;
        seen.add(begin);
        const end = num(h.whole.end);
        const dur = Number.isNaN(end) ? 0 : Math.max(0, +(end - raw).toFixed(4));
        const g = h.value && typeof h.value === 'object' ? Number(h.value.gain) : NaN;
        events.push({ begin, dur, gain: Number.isNaN(g) ? 1 : g });
      }
      return events.sort((a, b) => a.begin - b.begin);
    } catch {
      return [];
    }
  }

  /** Back-compat: just the onset offsets (the Cycle clock's ring ticks). */
  async queryTicks(expr: string): Promise<number[]> {
    return (await this.queryEvents(expr)).map((e) => e.begin);
  }

  private cleanError(msg: string): string {
    return msg.replace(/^Error:\s*/, '').replace(/\s*at\s+.*$/s, '').slice(0, 220);
  }
}

export const engine = new StrudelEngine();

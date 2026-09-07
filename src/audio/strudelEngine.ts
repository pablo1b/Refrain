// ---------------------------------------------------------------------------
// Refrain audio engine — a thin wrapper over the *real* Strudel REPL
// (@strudel/web). Nothing about Strudel playback changes; we just hold the
// repl handle so the Cycle clock can read the scheduler and so edits can be
// auditioned and panicked safely.
// ---------------------------------------------------------------------------

import { SAMPLE_PACKS, SAMPLE_JSON } from '../theme/tokens';
import { parseScore } from '../music/parseScore';

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

/**
 * Peak + RMS of a time-domain buffer. Pure, so it is unit-testable without any
 * Web Audio at all — which matters, because the thing it serves (A-12) exists
 * precisely to make an otherwise unobservable audio behaviour observable.
 */
export function rmsPeak(buf: Float32Array): { rms: number; peak: number } {
  if (!buf.length) return { rms: 0, peak: 0 };
  let sum = 0;
  let peak = 0;
  for (let i = 0; i < buf.length; i++) {
    const v = buf[i];
    sum += v * v;
    const a = Math.abs(v);
    if (a > peak) peak = a;
  }
  return { rms: Math.sqrt(sum / buf.length), peak };
}

/** One scheduled onset within a cycle: begin/dur in cycles (0..1), relative gain. */
export interface EngineEvent {
  begin: number;
  dur: number;
  gain: number;
}

/**
 * Append `.analyze('<voiceId>')` to every sounding voice so each one gets its own
 * real audio tap. superdough wires the `analyze` control as a SEND —
 * `effectSend(post, analyserNode, 1)` (superdough.mjs) connects
 * `post → send → analyser`, and the analyser is a leaf with no onward
 * connection — so this is inaudible and cannot double the signal. The node is
 * cached by id, readable via `getAnalyserById`.
 *
 * This is what makes per-voice metering HONEST: without it nothing routes to a
 * per-voice analyser, so meters could only be inferred from scheduled events,
 * and a voice with events but no audio (a chord symbol in `note()`, a mistyped
 * sample) lit its meter anyway.
 *
 * Pure, so it is unit-testable with no Web Audio at all.
 */
export function routeVoiceAnalysers(score: string): { code: string; ids: string[] } {
  const { voices } = parseScore(score);
  if (!voices.length) return { code: score, ids: [] };
  const lines = score.split('\n');
  const ids: string[] = [];
  for (const v of [...voices].reverse()) {
    if (v.expr.trim() === 'silence') continue; // muted / solo-dimmed: no audio to tap
    // Already routed — never double-wrap. Strip comments first: `.analyze(` in a
    // trailing comment is not a real tap, and treating it as one skipped the
    // voice and silently dropped it back to event-driven metering.
    if (/\.analyze\s*\(/.test(stripComments(v.expr))) continue;
    // `parseScore` ends a voice block at the first column-0 line, so a chain
    // whose closing paren is unindented leaves `expr` mid-argument-list. Appending
    // there yields either a syntax error (trailing comma) or — worse, because
    // nothing signals it — a tap bound to one inner sub-expression, so the voice
    // meters only part of itself. Route a voice only if it stands alone as an
    // expression WITH the tap attached; skip the rest, so one awkward chain
    // cannot darken every other voice's meter.
    if (!parsesAsExpression(`${v.expr}\n.analyze('${v.id}')`)) continue;
    lines.splice(v.endLine + 1, 0, `${v.indent}.analyze('${v.id}')`);
    ids.push(v.id);
  }
  return { code: lines.join('\n'), ids };
}

/** Drop line + block comments, so a commented-out method never reads as real. */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
}

/**
 * Does `src` parse as a single JavaScript expression? `new Function` COMPILES
 * without executing, so nothing runs and no Strudel global has to exist — this
 * is a pure syntax check.
 */
function parsesAsExpression(src: string): boolean {
  try {
    new Function(`return (\n${src}\n);`);
    return true;
  } catch {
    return false;
  }
}

class StrudelEngine {
  private repl: Repl | null = null;
  private masterTap: AnalyserNode | null = null;
  private tappedNode: AudioNode | null = null;
  private tapBuf: Float32Array<ArrayBuffer> | null = null;
  private transpile: ((code: string) => Promise<{ pattern: any }>) | null = null;
  private web: any = null;
  private analyser: AnalyserNode | null = null;
  /** Voice ids the last evaluate really routed through `.analyze` — so a zero
   *  reading means genuine silence, not a missing tap. Per-voice, because a
   *  chain that cannot be routed safely must not darken everyone else's meter. */
  private routedIds = new Set<string>();
  private voiceBufs = new Map<string, Float32Array<ArrayBuffer>>();
  private voiceTaps = new Map<string, AnalyserNode>();
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

  /**
   * Evaluate code and (by default) play it on the shared scheduler.
   *
   * The score is routed through per-voice analysers first (`routeVoiceAnalysers`)
   * so the meters can read real audio. If the routed code fails to evaluate we
   * retry the ORIGINAL verbatim: metering must never be able to take the audio
   * down with it.
   */
  async evaluate(code: string, autoplay = true): Promise<{ ok: boolean; error?: string }> {
    if (!this.repl) return { ok: false, error: 'engine not ready' };
    let routed = code;
    let ids: string[] = [];
    try {
      const r = routeVoiceAnalysers(code);
      routed = r.code;
      ids = r.ids;
    } catch {
      routed = code; // never let the metering rewrite block playback
      ids = [];
    }
    if (routed !== code) {
      const res = await this.runCode(routed, autoplay);
      if (res.ok) {
        this.routedIds = new Set(ids);
        return res;
      }
      // fall through: play the user's code unrouted rather than not at all
      this.routedIds.clear();
      return this.runCode(code, autoplay);
    }
    this.routedIds.clear();
    return this.runCode(code, autoplay);
  }

  private async runCode(code: string, autoplay: boolean): Promise<{ ok: boolean; error?: string }> {
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
   * A MASTER output analyser — deliberately distinct from `getAnalyser()`, which
   * returns superdough's per-`analyze` node and is SILENT unless a pattern opts
   * in (superdough's own master tap is commented out upstream). This taps
   * `controller.output.destinationGain`, the gain node everything audible passes
   * through, and connects nowhere onward, so it is completely inaudible.
   *
   * Re-taps if superdough rebuilt its output graph (`output.reset()` nulls
   * destinationGain). Testability only (A-12); no component reads this.
   */
  private masterAnalyser(): AnalyserNode | null {
    if (!this.ready) return null; // never build an AudioContext before a gesture
    const w = this.web;
    if (!w || typeof w.getSuperdoughAudioController !== 'function') return null;
    try {
      const node = w.getSuperdoughAudioController()?.output?.destinationGain as AudioNode | null | undefined;
      if (!node) return null;
      if (this.masterTap && this.tappedNode === node) return this.masterTap;
      // superdough rebuilt its output: drop the tap on the discarded node first,
      // or it stays attached to a gain node nobody can reach any more.
      try {
        this.masterTap?.disconnect();
      } catch {
        /* already detached with its old graph */
      }
      const ac = (node as any).context as BaseAudioContext;
      const a = new AnalyserNode(ac, { fftSize: 2048, smoothingTimeConstant: 0 });
      node.connect(a); // leaf: no onward connection, so nothing is heard twice
      this.masterTap = a;
      this.tappedNode = node;
      this.tapBuf = new Float32Array(new ArrayBuffer(a.fftSize * 4));
      return a;
    } catch {
      return null;
    }
  }

  /**
   * Sample what is actually reaching the speakers right now. Returns null when
   * there is nothing to sample rather than a fake zero, so a caller can tell
   * "silent" apart from "no tap" (A-12).
   */
  sampleOutput(): { rms: number; peak: number; cycle: number; playing: boolean; when: number } | null {
    try {
      const a = this.masterAnalyser();
      if (!a) return null;
      if (!this.tapBuf || this.tapBuf.length !== a.fftSize) this.tapBuf = new Float32Array(new ArrayBuffer(a.fftSize * 4));
      a.getFloatTimeDomainData(this.tapBuf);
      const { rms, peak } = rmsPeak(this.tapBuf);
      return { rms, peak, cycle: this.now(), playing: this.started, when: Date.now() };
    } catch {
      return null;
    }
  }

  /**
   * REAL per-voice level, from that voice's own `analyze` tap. Returns null when
   * there is no tap to read — engine not ready, or the playing code was not
   * routed — so a caller can tell "this voice is silent" (0) apart from "we
   * cannot know" (null) and fall back honestly. This is the measurement A8 needs:
   * a voice with scheduled events but no audio reads 0 here.
   *
   * `getAnalyserById` CREATES a node on demand (and would create an
   * AudioContext), so it is gated on `ready` — never build one before a gesture.
   *
   * WHAT THE TAP ACTUALLY MEASURES — the contract, so nobody over-reads a zero:
   * the `analyze` send sits on the voice's own post-FX chain, PRE-master. So
   * - `room`/`delay` are separate sends to global buses whose returns never come
   *   back through this node, and with `.dry(...)` the tap reads pre-dry: a voice
   *   audible ONLY through its reverb tail can still read 0 here.
   * - anything applied downstream of the voice (master-bus processing) is not
   *   seen, so this is "what this voice puts out", not literally "what reaches
   *   the speakers".
   * - duplicate voice ids share one analyser id, so two rows with the same id
   *   both read the SUMMED level. That is the known-open duplicate-id defect
   *   (`toggleMute`/`cycleMiniRoll` act on both rows too), not a metering bug.
   */
  voiceLevel(voiceId: string): { rms: number; peak: number } | null {
    if (!this.ready || !this.routedIds.has(voiceId)) return null;
    const getA = this.web?.getAnalyserById;
    if (typeof getA !== 'function') return null;
    try {
      // Ask for the size it ALREADY has, so we never fight superdough over
      // fftSize: it builds these at 2**(fft+5) with fft defaulting to 8 (8192),
      // and `getAnalyserById` resizes + reallocates whenever the size differs.
      const cached = this.voiceTaps.get(voiceId);
      const a = getA(voiceId, cached?.fftSize ?? 8192) as AnalyserNode;
      if (!a || typeof a.getFloatTimeDomainData !== 'function') return null;
      this.voiceTaps.set(voiceId, a);
      let buf = this.voiceBufs.get(voiceId);
      if (!buf || buf.length !== a.fftSize) {
        buf = new Float32Array(new ArrayBuffer(a.fftSize * 4));
        this.voiceBufs.set(voiceId, buf);
      }
      a.getFloatTimeDomainData(buf);
      return rmsPeak(buf);
    } catch {
      return null;
    }
  }

  /**
   * superdough's per-`analyze` AnalyserNode, looked up on the @strudel/web
   * module — feeds the Meters + Spectrum lenses (spec §05). Best-effort: it
   * only carries audio for haps that set the `analyze` control, so if no tap is
   * available this returns null and the meters fall back to the honest
   * event-driven envelopes. Cached once obtained. For the whole audible mix,
   * see `masterAnalyser()` / `sampleOutput()` instead.
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

// Dev-only instrumentation for the tier-3 rubric (A-12): the A2 release gate
// ("HUSH fades over one cycle without snapping back") cannot otherwise be
// observed by an agent, because the meters are `playing`-gated by design and
// Performance Mode unmounts the analyser-backed Spectrum lens. Sampling the real
// master output makes the fade measurable. It does NOT close the gate — the
// shipped build is what a performer uses, so a human still has to listen.
if (import.meta.env.DEV) {
  const g = globalThis as any;
  g.__refrain = {
    ...(g.__refrain ?? {}),
    sampleOutput: () => engine.sampleOutput(),
    voiceLevel: (id: string) => engine.voiceLevel(id),
  };
}

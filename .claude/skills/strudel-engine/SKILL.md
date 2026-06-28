---
name: strudel-engine
description: The Strudel engine boundary in Refrain — how src/audio/strudelEngine.ts wraps @strudel/web (initStrudel + prebake, the repl/scheduler API, evaluate/autoplay, start/stop, panic-via-silence, the cps clock + setCps) and uses @strudel/transpiler's pure evaluate + pattern.queryArc for read-only tick visualization. Use when touching the audio/clock boundary, debugging playback/scheduler/tempo, adding sample packs or soundfonts to prebake, surfacing eval errors, fixing the "core loaded more than once" warning, the AudioContext-needs-a-gesture rule, or anything that calls engine.* / repl.*.
---

# The Strudel engine boundary (`src/audio/strudelEngine.ts`)

Refrain plays sound through **one real Strudel REPL** (`@strudel/web`). The engine
is a thin singleton wrapper (`export const engine`) that holds the repl handle so
the Cycle clock can read the scheduler, edits can be auditioned, and PANIC can hush
safely. **Audio is fully optional** — the app (and all of `src/music/*`) works with
no keys and no audio; the engine just no-ops when not `ready`.

This is the *system boundary*. Everything here is a dynamic `import()` into
`@strudel/web` / `@strudel/transpiler` + Web Audio. Two hard rules govern it:

1. **Strudel method names must be REAL** — see `.claude/skills/strudel-*` for the
   verified vocabulary. Don't invent functions; the transpiler `evaluate` of a
   read-only query (and the live repl) will throw or silently yield nothing.
2. **In tiers 1–2 the engine is always mocked** (`tests/mocks/engine.ts`). Never
   let `initStrudel` / the AudioWorklet run in a unit test. See `/write-tests`.

## The `@strudel/*` package architecture

`@strudel/web` is an opinionated all-in-one browser bundle. It `export *`s its
dependencies, so a single `import('@strudel/web')` gives you the whole vocabulary.

| Package | Role | Refrain uses |
|---------|------|--------------|
| `@strudel/core` | the Tidal pattern engine: `Pattern`, `Hap`, `queryArc`, `silence`, `register`, controls factory | indirectly (via web + transpiler) |
| `@strudel/mini` | mini-notation parser (`s("bd*2")`) | indirectly |
| `@strudel/tonal` | `scale`/`voicing`/`transpose`/`rootNotes` | indirectly |
| `@strudel/webaudio` | default output → drives `superdough` (the synth/sampler/FX engine) | indirectly |
| `@strudel/transpiler` | **pure** `evaluate(code) → { pattern }`, no repl/audio | **directly** (clock ticks) |
| `@strudel/web` | `initStrudel`, re-exports of all the above, `samples`, `aliasBank`, `registerSynthSounds` | **directly** (playback) |

**Installed versions (pinned, NOT lockstep):** `@strudel/web@1.3.0` and
`@strudel/webaudio@1.3.0`, but `core`/`mini`/`tonal`/`transpiler` at **1.2.6**.
If you ever add a standalone `@strudel/*` dep (e.g. `@strudel/soundfonts`,
`@strudel/draw`, `@strudel/midi`), **pin it to the version `@strudel/web` depends
on (1.2.6 for core-line packages)** or you'll load a *third* mismatched core.

## Boot: `initStrudel` + `prebake`

```ts
const web = await import('@strudel/web');
const { initStrudel, samples, registerSynthSounds, aliasBank } = web as any;

const repl = await initStrudel({
  prebake: async () => {
    /* additive: defaultPrebake already ran (synths exist) — add samples here */
  },
});
```

Key facts (verified against the installed source):

- `initStrudel(options)` **returns a `Promise<repl>`** that resolves *after*
  `defaultPrebake()` then your `prebake()` finish. Always `await` it — Refrain
  does (`this.repl = await initStrudel(...)`). It does **not** return the repl
  synchronously.
- `initStrudel` **always runs `defaultPrebake()` first**, which `evalScope`s
  core/mini/tonal/webaudio and calls `registerSynthSounds()`. Your `prebake` is
  purely **additive** — synth waveforms already exist before it runs.
- **`defaultPrebake` loads NO sample packs and registers NO soundfonts.** That's
  exactly why Refrain's prebake must call `samples(...)` itself.
- Options are `{ prebake, miniAllStrings, ...replOptions }`; `replOptions` forward
  to the core `repl()` factory. There is **no `autoplay` option** on `initStrudel`.
  Useful forwardable hooks if ever needed: `onUpdateState(state)`,
  `onEvalError(err)`, `editPattern(p)=>p`.

### What Refrain's prebake loads

From `src/theme/tokens.ts` `SAMPLE_PACKS` (felixroos/dough-samples raw + todepond):

```ts
await Promise.all([
  registerSynthSounds?.(),               // idempotent (defaultPrebake already did it)
  samples(`${ds}tidal-drum-machines.json`),
  samples(`${ds}piano.json`),
  samples(`${ds}Dirt-Samples.json`),
  samples(`${ds}EmuSP12.json`),
  samples(`${ds}vcsl.json`),
  samples(`${ds}mridangam.json`),
]);
aliasBank?.(`${ts}tidal-drum-machines-alias.json`);  // → bank('tr909') etc.
```

- `samples(urlOrMap, baseUrl?, options?)` and `aliasBank(urlOrMap | (bank,alias))`
  are **async** (they `fetch` JSON + audio). They can fail (network/CORS) — wrap in
  `try/catch` so synth voices still sound offline. Refrain does exactly this and
  logs `[refrain] sample prebake partial`.
- `aliasBank` registers short bank names (`tr909`, `tr808`) for the
  tidal-drum-machines pack; lookup is **case-insensitive**, so `bank('RolandTR909')`
  and `bank('tr909')` both resolve. Prefer canonical names in generated code.
- **Lazy-load caveat:** only the name→URL map loads up front. Audio buffers fetch
  on **first trigger**, so a sound can be *silent the first time it plays*. This is
  expected, not an engine error.
- **strudel.json is aggressively browser-cached** — bust with `?version=N` if a
  pack updates.
- Optional `{ tag: 'drum-machines' }` on `samples` groups sounds in the sounds-tab
  UI (strudel.cc does this; Refrain currently doesn't — packs land under 'user').

## The repl / scheduler API

The handle Refrain types and stores (`type Repl`):

```ts
type Repl = {
  scheduler: { now: () => number; cps: number; started: boolean; pattern?: unknown };
  evaluate: (code: string, autoplay?: boolean) => Promise<unknown>;
  start: () => void;
  stop: () => void;
  setCps: (cps: number) => void;
  state: { started: boolean; pattern?: unknown; error?: unknown };
};
```

| Engine method | Wraps | Notes |
|---------------|-------|-------|
| `engine.evaluate(code, autoplay=true)` | `repl.evaluate(code, autostart)` | the 2nd arg is **autostart** (Refrain names it `autoplay`); auto-starts the clock if stopped |
| `engine.stop()` | `repl.stop()` | hard stop: pauses audio **and rewinds** cycle pos to 0 |
| `engine.panic()` | `repl.evaluate('silence', true)` | hush all voices, **clock keeps running** |
| `engine.setCps(cps)` | `repl.setCps(cps)` | tempo, cycles-per-second |
| `engine.now()` | `repl.scheduler.now()` | fractional cycle pos; **0 until started** |
| `engine.cps` | `repl.scheduler.cps` | defaults to `0.5` |
| `engine.started` | `repl.scheduler.started` | clock running? |

### `repl.evaluate` — the autoplay path

`repl.evaluate(code, autostart=true, shouldHush=true)`:

- Transpiles + evaluates `code`, collects all `$:`-registered named patterns into a
  `stack()`, sets it on the scheduler, and (if `autostart`) starts the clock.
- **It swallows eval/transpile errors** — on a bad expression it logs, sets
  `repl.state.error` / `repl.state.evalError`, calls `onEvalError`, and **resolves
  `undefined` (does NOT reject).** So `engine.evaluate`'s `try/catch` only catches
  *synchronous* throws. To surface bad-code feedback robustly, also inspect
  `repl.state.error` after the await. *(Refrain's engine currently relies on the
  try/catch; this is the known refinement point — see open questions.)*
- The 3rd arg `shouldHush` (default true) clears previously-registered `$:` voices
  before this eval; pass `false` to layer without clearing.

### Named voices: `$drums: s("bd*2")`

Refrain's score model maps directly onto Strudel's `$:` mechanism. The transpiler
rewrites any `label: expr` statement to `expr.p('label')`; `Pattern.prototype.p`
registers the pattern under the label in the repl's `pPatterns` map, and `evaluate`
stacks them all to play in parallel. Special label semantics worth knowing:

- An id containing `$` gets an auto-increment suffix internally (`$drums` →
  `$drums0`) — so each `$name:` slot is an independent, parallel voice.
- A label **starting or ending with `_`** (`_drums:` / `drums_:`) returns
  `silence` → a **mute** toggle that keeps the code.
- A multi-char label starting with uppercase **`S`** (`Sdrums:`) **solos** that slot.

Refrain's store currently mutes by rewriting a voice line to `${sigil}: silence`
(`store.ts:156`), but the built-in `_name:` / `Sname:` label semantics are an
alternative primitive for mute/solo without deleting code.

## The cps clock + tempo

Strudel measures tempo in **cps (cycles per second)**, not BPM. Default `cps = 0.5`
→ one cycle every 2s (≈ 120 BPM at 4 beats/cycle).

- From JS: `engine.setCps(cps)` → `repl.setCps(cps)`. **`setCpm` is NOT a method on
  the repl object** — only `setCps` is. To set cycles-per-*minute* from JS use
  `repl.setCps(cpm / 60)`.
- In user/score code: both `setcps(x)` and `setcpm(x)` globals exist
  (`setcpm(x) === setcps(x/60)`). Refrain's `parseScore` detects a `cps`/`setcps`
  line (`parseScore.ts`), and `store.setCps` rewrites that line in place.
- BPM target: `setCps(bpm / 60 / beatsPerCycle)`, e.g. 120 BPM in 4/4 →
  `setCps(0.5)`.
- `repl.scheduler.now()` short-circuits to **0 when not started** — a clock readout
  reads 0 before playback, not the last paused position. `engine.now()` already
  defaults to 0 on error, consistent with this.
- cps can also be patterned per-hap (a hap carrying a `cps` value retunes the clock
  mid-cycle); the directives `accel`/`rit` exploit this and require a cps line.

## PANIC / hush — three distinct operations

Be precise; these are easy to conflate:

| Operation | Effect | Clock |
|-----------|--------|-------|
| `engine.panic()` = `repl.evaluate('silence', true)` | replaces every voice with the `silence` pattern | **keeps running** |
| `engine.stop()` = `repl.stop()` | stops audio | **stops + rewinds to 0** |
| in-code global `hush()` | clears the `$:` registry, returns `silence` | keeps running |
| `@strudel/web` export `hush()` | = `repl.stop()` | stops + rewinds |

`silence` is a **real exported Pattern** (`= gap(1)`, produces no events), used as a
value, not a function. Refrain panics with `evaluate('silence')` so the Cycle UI
keeps advancing while nothing sounds — the "hush voices but keep transport" semantic.
The store's HUSH command routes through `engine.panic()` too (`store.ts`).

## Read-only tick visualization: the pure transpiler path

The Cycle clock lays event ticks on rings by **querying** voices without playing
them. This is the one place Refrain uses `@strudel/transpiler` directly.

```ts
const { pattern } = await transpilerEvaluate(expr);   // pure: { mode, pattern, meta }
const haps = pattern.queryArc(-0.0625, 1);            // Hap[]
const begins = haps
  .filter(h => h?.whole && (h.hasOnset?.() ?? true))  // onsets only; skip continuous/tail
  .map(h => Number(h.whole.begin.valueOf()));          // begin is a Fraction → valueOf()
```

**Two same-named `evaluate` exports — do not confuse them:**

| Import | Behavior |
|--------|----------|
| `@strudel/web`'s `evaluate` | calls `repl.evaluate(code, /*autoplay*/ true)` → **plays on the live scheduler** (hijacks the transport, replaces the score) |
| `@strudel/transpiler`'s `evaluate` | **pure**: `core.evaluate(code, transpiler)` → `{ mode, pattern, meta }`, **no repl, no scheduler, no audio** |

Always import the **transpiler** one for read-only work, exactly as Refrain does
(`this.transpile`).

### `queryArc` / `Hap` mechanics (the part that bites)

- `pattern.queryArc(begin, end, controls={})` maps a time span (in cycles) to a
  `Hap[]`. It's **exception-safe** — on error it returns `[]` (so a broken voice
  yields no ticks rather than throwing; degrades silently). You can query a wider /
  negative-begin arc; Refrain queries `-0.0625..1` to catch rubato/late onsets and
  folds each begin back into `[0,1)`.
- A `Hap` has `whole` (TimeSpan or **`undefined`** for continuous signals like
  `sine`/`rand`/`perlin`), `part` (the slice in this query, possibly a fragment),
  and `value`. **Always null-check `h.whole`** before reading `h.whole.begin`.
- `h.hasOnset()` is `whole != undefined && whole.begin.equals(part.begin)` — true
  only at an event's **attack**, not its tied tail. Filter on it to count real note
  starts (continuous signals never have onsets).
- **Times are fraction.js `Fraction`s, not JS numbers.** `h.whole.begin === 0.25`
  is always false. Convert with `.valueOf()` / `Number()`; compare with
  `.equals()`/`.eq()`. Refrain's `Number(b.valueOf())` is correct.
- Non-determinism: `?` (degradeBy) and `|` (random choice) are seeded per cycle —
  the rand stream is deterministic, so a single `queryArc(0,1)` snapshot **is
  stable** and reproducible (good for tick previews and tests).

## The "core loaded more than once" warning

`@strudel/core/index.mjs` logs `'@strudel/core was loaded more than once'` whenever
`globalThis._strudelLoaded` is already truthy at import. In Refrain this fires
**by design**: `@strudel/web` bundles its own core, and importing `@strudel/transpiler`
standalone (for pure queries) pulls a **second** core.

It is **benign** here: the transpiler's core is used only for read-only one-shot
`queryArc`; its `Pattern` objects are never fed back into web's repl. Refrain
suppresses the noise by clearing the flag around the import and restoring it:

```ts
const g = globalThis as any;
const hadCore = g._strudelLoaded;
g._strudelLoaded = undefined;
try {
  const { evaluate: transpilerEvaluate } = await import('@strudel/transpiler');
  this.transpile = (code) => transpilerEvaluate(code);
} finally {
  g._strudelLoaded = hadCore ?? true;   // graceful: if the flag name changes, warning just returns
}
```

The save/clear/restore matches the **exact** flag the warning checks. The "real" fix
(single-core dedup via Vite resolve.dedupe / `npm ls @strudel/core`) conflicts with
importing the transpiler standalone, so the suppression is the pragmatic choice.
**Corollary:** because there are two cores, any `register('myFn', …)` custom-method
work must run in the **live `@strudel/web` core**, not the throwaway transpiler core
(custom fns won't exist there).

## AudioContext needs a user gesture

`initStrudel` calls `initAudioOnFirstClick()` internally: a one-time `document`
**`mousedown`** listener that resumes the `AudioContext`. The browser autoplay
policy means **no sound until that gesture fires.**

- It listens specifically for `mousedown` — a synthetic `.click()`, keyboard-only
  activation, or touch-without-mousedown may **not** unlock audio. For robust unlock
  in custom UI, also call `audioContext.resume()` inside your own real gesture
  handler.
- Refrain's store gates `initAudio()`/`play()` behind real user actions
  (`store.ts`), which satisfies the policy. `engine.init()` is idempotent
  (memoized via `initPromise`) — calling it again returns the same promise.

## Vite config (the AudioWorklet)

`@strudel/webaudio`/`superdough` register AudioWorklet processors. Refrain's
`vite.config.ts` is the right minimal setup:

```ts
build: { target: 'esnext' },
optimizeDeps: {
  include: ['@strudel/web', '@strudel/transpiler'],
  esbuildOptions: { target: 'esnext' },
},
```

**No COOP/COEP / SharedArrayBuffer headers are needed.** Those are required only
when the repl is created with `sync: true` (the `NeoCyclist` / SharedWorker
multi-instance path). Refrain uses the **default single-instance `Cyclist`**, which
needs none of that.

## How transforms reach the engine (the rest of Refrain)

- `src/music/directives.ts` builds Strudel code strings (`.gain`, `.lpf`, `.room`,
  `.swingBy(1/3,n)`, `.add(note(±12))`, `.bank`, …). They reach the engine through
  the same `engine.evaluate(fullScore, true)` path — **no new engine API needed**.
- `src/music/lanes.ts` templates emit voice code (`s("...").gain(...).bank(...)`,
  `note("...").s("sawtooth")`, signal modulation via `sine`/`saw`/`perlin.range`).
- `src/music/parseScore.ts` splits the score into `$name:` voices + a cps line and
  feeds `engine.queryTicks(voice.expr)` per voice for the clock.

The engine itself stays dumb: it boots once, evaluates the full score on every edit,
reads the scheduler for the clock, and panics with `silence`. Adding a new Strudel
feature (soundfonts, a wavetable pack, MIDI) is a **prebake / import change** at this
boundary — see open questions and the sibling `strudel-*` skills for the verified
function vocabulary before emitting any new method name.

## Sources

- [@strudel/web `web.mjs`](https://codeberg.org/uzu/strudel/raw/branch/main/packages/web/web.mjs) — `initStrudel`, `defaultPrebake` order, `hush`/`evaluate` web exports, re-exports.
- [@strudel/core `repl.mjs`](https://codeberg.org/uzu/strudel/raw/branch/main/packages/core/repl.mjs) — `repl()` factory, `evaluate(code, autostart, shouldHush)`, `start`/`stop`/`pause`, `setCps`, `state`, `Pattern.prototype.p` (`$:` / mute / solo).
- [`cyclist.mjs`](https://codeberg.org/uzu/strudel/raw/branch/main/packages/core/cyclist.mjs) — scheduler `now()` (0 if not started), default `cps = 0.5`, `started`.
- [`index.mjs`](https://codeberg.org/uzu/strudel/raw/branch/main/packages/core/index.mjs) — the "loaded more than once" warning + `globalThis._strudelLoaded`.
- [`pattern.mjs`](https://codeberg.org/uzu/strudel/raw/branch/main/packages/core/pattern.mjs) / [`hap.mjs`](https://codeberg.org/uzu/strudel/raw/branch/main/packages/core/hap.mjs) — `queryArc`, `hasOnset`, `silence = gap(1)`.
- [@strudel/transpiler `index.mjs`](https://codeberg.org/uzu/strudel/raw/branch/main/packages/transpiler/index.mjs) — pure `evaluate(code) → { mode, pattern, meta }`.
- [superdough `sampler.mjs`](https://codeberg.org/uzu/strudel/raw/branch/main/packages/superdough/sampler.mjs) / [`superdough.mjs`](https://codeberg.org/uzu/strudel/raw/branch/main/packages/superdough/superdough.mjs) — `samples`, `aliasBank`, `registerSynthSounds`, `initAudioOnFirstClick`.
- [strudel.cc cycles](https://strudel.cc/understand/cycles/) — cps definition, `setcps`/`setcpm`, cps↔BPM.
- Repo note: source moved github.com/tidalcycles/strudel → **codeberg.org/uzu/strudel** (old GitHub raw paths 404).

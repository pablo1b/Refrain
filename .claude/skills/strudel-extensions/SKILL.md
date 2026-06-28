---
name: strudel-extensions
description: Extend Refrain with optional Strudel packages — MIDI out/in, OSC, SoundFonts (GM instruments), Csound, Hydra visuals, gamepad/motion signals, serial, MQTT, plus the tonal & soundfont capabilities already shipping inside @strudel/web. Use when asked to "add capability X to Refrain": each package's install + import + registration call, the pattern functions it exposes, exactly where to wire it into strudelEngine.ts (prebake vs import-for-side-effect), and which need extra infra (OSC bridge server, serial/gamepad/motion browser APIs, MQTT broker). Honest about cost and Chromium-only gotchas. Centered on the engine boundary; cross-references directives.ts / lanes.ts vocabulary.
---

# Extending Refrain with optional Strudel packages

Refrain embeds **`@strudel/web ^1.3.0`** as its single audio dependency
(`src/audio/strudelEngine.ts`). That bundle already re-exports `core`, `mini`,
`transpiler`, `webaudio`, `tonal`, and `edo` — so a large vocabulary is available
*today* with zero new deps. The **I/O extensions** (midi, osc, mqtt, csound,
hydra, gamepad, motion, serial, soundfonts) are **separate `@strudel/*` npm
packages** that are NOT in the web bundle. Adding one is a deliberate
`strudelEngine.ts` change — and some need infrastructure outside the browser.

This is the catalog for "add capability X". Read the [wiring rules](#how-the-engine-boots)
first, then jump to the package.

> **Hard rule (from CLAUDE.md):** Strudel method names must be REAL. Every
> function below is grounded in the verified corpus (Codeberg `uzu/strudel`
> source / strudel.cc). Don't invent. If unsure, leave it out.

> **Repo moved:** canonical source is now `codeberg.org/uzu/strudel`. The old
> `github.com/tidalcycles/strudel` raw paths 404.

---

## At a glance — what each extension costs

| Package | Adds | npm dep? | Extra infra? | Browser limit |
|---|---|---|---|---|
| (in `@strudel/web`) **tonal** | `scale`/`voicing`/`chord`/`transpose`/`rootNotes`/`arp` | no — bundled | none | — |
| **@strudel/soundfonts** | GM instruments `gm_*` for `note()` | yes | lazy font fetch (CORS) | — |
| **@strudel/midi** | `.midi()` out, `midin()`/`midikeys()` in, CC/PC/bend | yes | none (WebMIDI) | secure context |
| **@strudel/osc** | `.osc()` → SuperCollider/SuperDirt | yes | **bridge server** (`pnpm run osc`) + SC | — |
| **@strudel/soundfonts** | (see above) | | | |
| **@strudel/csound** | `.csound()` via `@csound/browser` | yes | none (wasm) | — |
| **@strudel/hydra** | `initHydra()` + `H(pattern)` visuals | yes | none (WebGL) | — |
| **@strudel/gamepad** | `gamepad(i)` button/axis **signals** | yes | a gamepad | Gamepad API |
| **@strudel/motion** | `enableMotion()` + tilt/accel **signals** | yes | permission grant | mobile / DeviceMotion |
| **@strudel/serial** | `.serial()` to e.g. Arduino | yes | a serial device | **Chromium only** |
| **@strudel/mqtt** | `.mqtt()` send-only to a broker | yes | **MQTT broker** (wss) | — |

**Lowest-friction, highest payoff:** SoundFonts (more instruments, mirrors the
existing `samples()` prebake) and MIDI (drive hardware, no server). **Highest
visual payoff:** Hydra. **Needs a server:** OSC, MQTT.

---

## How the engine boots (the two wiring slots)

Refrain's `initStrudel({ prebake })` always runs Strudel's internal
`defaultPrebake()` (which `evalScope`s core/mini/edo/tonal/webaudio and calls
`registerSynthSounds()`) **first**, then awaits your `prebake`. So your prebake
is purely **additive** — synth sounds already exist; you add samples/aliases/
soundfonts. There are exactly two ways to wire an extension:

1. **Sound registration → goes in `prebake`** (async, awaited). This is the
   `samples(...)` / `aliasBank(...)` slot already used in `strudelEngine.ts`.
   SoundFonts register here.
2. **Pattern-method extensions → a top-level `import` for side-effect.**
   Importing `@strudel/midi`, `@strudel/osc`, etc. *registers* the pattern
   methods (`.midi()`, `.osc()`, …) onto `Pattern.prototype` in the live core.
   No prebake call needed — the import itself is the registration.

### The dual-core caveat — register into the LIVE core only

`strudelEngine.ts` deliberately keeps **two** `@strudel/core` instances: the one
inside `@strudel/web` (live playback) and the one `@strudel/transpiler` pulls in
(read-only `queryArc` tick drawing). **Pattern-method extensions mutate the
global `Pattern` class of whichever core they import.** They must register into
the **`@strudel/web` core**, i.e. be imported in the same module graph as
`initStrudel`, *after* (or alongside) the web import. A method registered only
on the transpiler's throwaway core would not exist during playback.

```ts
// Correct: import the extension right where @strudel/web loads.
const web = await import('@strudel/web');
await import('@strudel/midi'); // registers .midi()/midin() onto the LIVE core
const { initStrudel /* … */ } = web as any;
```

Pin any new `@strudel/*` dep to the version `@strudel/web@1.3.0` depends on
(`@strudel/core`/`mini`/`tonal`/`transpiler` are at **1.2.6**; `webaudio` at
**1.3.0**) so you don't introduce a *third* mismatched core.

### No COOP/COEP headers needed

`vite.config.ts` (esnext + `optimizeDeps`) is sufficient. Refrain uses the
default single-instance `Cyclist` scheduler. SharedArrayBuffer / cross-origin
isolation is required *only* for `repl` created with `sync: true` (NeoCyclist /
SharedWorker multi-instance), which Refrain does not use. Add a new extension's
package name to `optimizeDeps.include` for stable dev loads.

### Errors don't reject — inspect state

`repl.evaluate` swallows eval/transpile errors (sets `repl.state.error`, resolves
`undefined`). Refrain's `engine.evaluate` only catches *synchronous* throws.
Extensions that fail at evaluate time (e.g. a missing MIDI port) surface via
`repl.state.error`, not a rejected promise.

---

## Already in @strudel/web: tonal (use now, no new dep)

`scale`, `voicing`, `chord`, `transpose`, `scaleTranspose`, `rootNotes`, `arp`
all ship in the bundle. These are the lowest-cost vocabulary additions for
`directives.ts` and `lanes.ts`.

```js
n("0 2 4 6 4 2").scale("C:major")          // scale degrees → notes (0-indexed)
n("0 1 2 3").chord("<C Am F G>").voicing()  // chord symbols → voiced notes
"<C^7 A7 Dm7 G7>".rootNotes(2).note()       // bassline under a progression
note("<[c,eb,g] [c,f,ab]>").arp("0 [0,2] 1 [0,2]")  // arpeggiate stacked notes
note("c3 e3 g3").transpose("<0 5 7>")       // semitones OR interval strings (3M, 5P)
```

Guardrails for any generated tonal code:
- Scale names use **colons, not spaces**: `"C:bebop:major"` (a space parses as a
  pattern). Roots default to **octave 3**.
- It's `arp`, **not `arpeggiate`** (no such function). Lower-level: `arpWith`.
- It's `voicing()` (no `s`); `voicings('dict')` is deprecated positional form.
- `n()` is **not** pitch on its own — `.scale()` makes it a scale degree,
  `.voicing()` a voice index; bare with a sample it's a sample index.
- Octave shift is `.add(note(12))` / `.transpose(12)` — exactly what `directives.ts`
  already emits for `octup`/`octdown`.
- `voicing()` on an unknown chord logs a warning and is **silent** (no throw).

Refrain upgrade targets: the `lanes.ts` "chord stab" (`note("<Cm7 Fm9>")`) and
"rising arp" templates could move to the real `chord().voicing()` /
`arp(...)` / `rootNotes(2)` pipeline; `directives.ts` could add an "in key"
directive via `.scale(...)` + `.scaleTranspose(...)` and a "up a fifth" via
`.transpose(7)`.

---

## SoundFonts — GM instruments (lowest-friction sound expansion)

Adds hundreds of General-MIDI melodic instruments (`gm_piano`, `gm_epiano1`,
`gm_marimba`, `gm_xylophone`, …) playable via `note(...).s('gm_…')`. **NOT** in
`@strudel/web` (the re-export is commented out), so `gm_*` is unavailable in
Refrain today. This mirrors the existing `registerSynthSounds()`/`samples()`
prebake exactly.

```bash
npm i @strudel/soundfonts@1.2.6   # match the web bundle's core line
```

Wire into the **prebake** (dynamic-import to dodge SSR `window is not defined`,
as strudel.cc does):

```ts
// inside initStrudel({ prebake: async () => { … } }) in strudelEngine.ts
try {
  const { registerSoundfonts /*, setSoundfontUrl */ } = await import('@strudel/soundfonts');
  // setSoundfontUrl('https://my-cdn/soundfonts'); // optional; default felixroos.github.io
  await registerSoundfonts();
} catch (e) {
  console.warn('[refrain] soundfonts unavailable:', e);
}
```

Then `note("c e g").s("gm_epiano1")`. Each instrument's `.js` font is **lazy
per-instrument fetched** (CORS-gated), so the first note of a fresh instrument
may be silent while it downloads — same first-trigger behavior as `samples()`.
This is a `lanes.ts`/`directives.ts` palette win (real melodic timbres), no
audio-graph change.

---

## MIDI — output and input (cheapest live-hardware extension)

WebMIDI, **no external server**. `.midi()` sends note-on/off; `midin()` /
`midikeys()` receive. On macOS route to other apps via the **IAC Driver**; on
Linux a **Midi Through Port**; or connect hardware directly.

```bash
npm i @strudel/midi@1.2.6
```

```ts
await import('@strudel/midi'); // side-effect import → registers .midi()/midin()/…
```

Output:

```js
note("c4 e4 g4").midichan(1).midi('IAC Driver Bus 1')  // device name optional
note("c a f e").ccn(74).ccv(sine.slow(4)).midi()        // CC #74 ← LFO 0..1
note("c a f e").control([74, sine.slow(4)]).midi()      // same, tuple form
progNum("<0 5 9>").midi()                                // program change 0-127
midicmd("clock*48 [stop,start]/2").midi()                // transport / clock sync
```

Input (returns a function you call with a CC number; values normalized 0–1):

```js
const cc = await midin('IAC Driver Bus 1');
n("0 2 4").lpf(cc(74).range(200, 2000))
```

| Method | What | Range |
|---|---|---|
| `.midi(port?)` | send notes to output | — |
| `.midichan(n)` | output channel | 1–16 (default 1) |
| `.ccn(n)` / `.ccv(v)` | CC number / value | 0–127 / **0–1 normalized** |
| `.control([n, v])` | CC as a tuple | = `.ccn(n).ccv(v)` |
| `.progNum(n)` | program change | 0–127 |
| `.midibend(v)` | pitch bend | **−1..1** |
| `.miditouch(v)` | aftertouch | 0..1 |
| `.midiport(name)` | select/patternable device | — |
| `.midicmd(cmd)` | `clock`/`start`/`stop`/`continue` | — |
| `midin(input?)` | open input → `cc(n)` signal fn | — |
| `midikeys(input?)` | MIDI keyboard → pattern source | — |

Gotchas: CC/touch values are **normalized 0–1** (scaled to 0–127 internally),
bend is **−1..1**. A pattern wired to a non-existent port surfaces via
`repl.state.error` (evaluate doesn't reject).

Refrain fit: a "MIDI out" toggle in the engine would let a `$voice` drive an
external synth instead of (or alongside) `superdough`. `directives.ts` could
gain a `.midichan()` / `.ccn().ccv()` directive family once enabled.

---

## OSC — to SuperCollider / SuperDirt (needs a bridge server)

`.osc()` sends each hap as an OSC message (default address `/dirt/play`) over a
**WebSocket to `localhost:8080`**. Unlike MIDI, OSC needs infrastructure: run
the bridge (`pnpm run osc` in the strudel repo) which forwards REPL → SuperDirt,
and have **SuperCollider + SuperDirt** running. Use this to drive the
TidalCycles-style audio engine instead of `superdough`.

```bash
npm i @strudel/osc@1.2.6
```

```ts
await import('@strudel/osc'); // registers .osc()
```

```js
s("bd sd").osc()  // → /dirt/play over ws://localhost:8080 → SuperDirt
```

Be honest with the user: this only sounds if the **external bridge + SC stack**
is up. It's a power-user / studio-integration path, not a default Refrain feature.

---

## Csound — `@csound/browser` (experimental, parameter-limited)

Renders a voice through a named Csound instrument (wasm, no external app).

```bash
npm i @strudel/csound
```

```ts
await import('@strudel/csound'); // registers .csound()/.csoundm()/loadOrc/loadCsound
```

```js
await loadOrc('github:kunstmusik/csound-live-code/master/livecode.orc');
note("c a f e").csound('FM1')                 // p4=freq(Hz), p5=gain(0..1)
note("c e g").csoundm('FM1')                  // .csoundm: p4=MIDI key, p5=velocity
// or define inline:
await loadCsound`instr CoolSynth
  // …orc code…
endin`;
note("c e g").csound('CoolSynth')
```

**Limitation:** only `p1–p5` map (instr, time, dur, freq/key, gain/vel). Strudel's
normal effect chain (`.lpf/.room/.delay/…`) does **NOT** apply to a `.csound()`
voice. Flag as experimental in any UI.

---

## Hydra — visuals behind the editor (highest visual payoff)

WebGL visual synth (`hydra-synth`), no server. Initialize **before** any Hydra
ops; `H(pattern)` injects a Strudel pattern as a Hydra input.

```bash
npm i @strudel/hydra
```

```ts
await import('@strudel/hydra'); // exposes initHydra/H + hydra functions
```

```js
await initHydra({ detectAudio: true })           // FFT-driven visuals via a.fft[i]
shape(H("3 4 5 [6 7]*2")).scrollY(() => a.fft[0] * .25).out(o0)
// or feed Strudel's own viz through hydra effects:
await initHydra({ feedStrudel: 1 })
```

`initHydra(options)` is **async** and options pass straight to `hydra-synth`
(`{detectAudio}`, `{feedStrudel}`). For Refrain this would be a background
canvas behind `ScoreEditor` — note Hydra owns its own canvas + render loop.

---

## Gamepad & Motion — patternable control SIGNALS

These don't add audio; they add **signals** that behave exactly like Refrain's
already-used `saw`/`sine`/`rand`/`perlin` — chain `.range(min,max)`/`.slow()`/
`.segment()` and feed any control (`.lpf`, `.gain`, `.room`). They slot directly
into `lanes.ts` templates as alternative modulation sources.

### Gamepad (`@strudel/gamepad`, Gamepad API)

```ts
await import('@strudel/gamepad'); // exposes gamepad()
```

```js
const gp = gamepad(0);            // index, default 0
note("c4 d3 a3 e3").s("sawtooth")
  .lpf(gp.x1.range(100, 4000))    // left stick X (0..1)
  .lpq(gp.y1.range(5, 30))
s("free_hadouken -").mask(gp.btnSequence(['d','r','a']))  // combo → 1 for ~1s
```

`gp` exposes button signals (face `a`/`b`/`x`/`y` + `tgl*` toggles, shoulders
`lb/rb/lt/rt`, dpad `u/d/l/r`, sticks `l3/r3`, `start`/`back`), analog
`x1/y1/x2/y2` (0..1) and bipolar `x1_2/y1_2` (−1..1), and `btnSequence()`
(aliases `btnSeq`/`btnseq`) for combos.

### Motion (`@strudel/motion`, DeviceMotion — mostly mobile)

```ts
await import('@strudel/motion'); // exposes enableMotion() + signals
```

```js
enableMotion();                   // async/permission-gated — call first
n("0 1 3 5").scale("C:major")
  .lpf(gravityY.range(200, 2000))
  .room(rotationGamma.range(0, 0.8))
  .s("sawtooth")
```

Signals: `accelerationX/Y/Z` (`accX/Y/Z`), `gravityX/Y/Z` (`gravX/Y/Z`),
`rotationAlpha/Beta/Gamma`, `orientationAlpha/Beta/Gamma`. Most are normalized
0–1; orientation has native ranges (beta −180..180, gamma −90..90) so wrap with
`.range()` to be safe. `enableMotion()` prompts for permission and must run
before the signals are used (iOS lacks `absoluteOrientation*`).

---

## Serial & MQTT — output-only edges (be honest about infra)

### Serial (`@strudel/serial`, Web Serial — **Chromium only**)

```ts
await import('@strudel/serial'); // registers .serial()
```

```js
s("bd sd").serial()  // writes haps to navigator.serial (e.g. an Arduino)
// .serial(baud=115200, sendcrc=false, singlecharids=false, name='default')
```

Output-only; opens a writer on first use; optional CRC16 (CCITT-FALSE). Requires
a connected serial device and a Chromium-family browser (no Firefox/Safari).

### MQTT (`@strudel/mqtt`, **send-only**, needs a broker)

```ts
await import('@strudel/mqtt'); // registers .mqtt()
```

```js
s("a b c").mqtt(undefined, undefined, '/topic', 'wss://broker:8883/')
// .mqtt(username?, password?, topic?, host='wss://localhost:8883/', client?, latency=0, add_meta=true)
// .robot(id, address)  — convenience wrapper for IoT/robot control
```

Sends JSON-encoded control messages over secure WebSockets. **Cannot receive.**
Needs an MQTT broker accepting wss connections.

---

## Recipe: add an extension to Refrain end-to-end

Using MIDI as the worked example (same shape for any pattern-method package):

1. **Install**, version-matched to the web bundle's core line:
   `npm i @strudel/midi@1.2.6`
2. **Pre-bundle** for Vite — add to `optimizeDeps.include` in `vite.config.ts`:
   `include: ['@strudel/web', '@strudel/transpiler', '@strudel/midi']`
3. **Register into the live core** in `strudelEngine.ts` `init()`, next to the
   `@strudel/web` import (NOT in the transpiler block):
   ```ts
   const web = await import('@strudel/web');
   await import('@strudel/midi'); // side-effect: registers .midi() etc.
   ```
   For a **sound-registering** package (SoundFonts) put the call in `prebake`
   instead, inside the existing best-effort `try/catch`.
4. **Surface it** — expose a toggle/method on the `engine` singleton if it needs
   activation (`midin()`, `enableMotion()`, `initHydra()` are async/gated), and
   widen `directives.ts`/`lanes.ts` vocabulary if appropriate.
5. **Verify** — the method must exist on the playing pattern. Because evaluate
   swallows errors, check `repl.state.error` after an `engine.evaluate(...)` of
   a voice that uses the new method, and confirm sound/MIDI/visual output. For
   anything touching audio or hardware this is a **tier-3 agent-manual** check
   (`TESTING.md`) against the live app — unit/browser tiers mock the engine.

### What stays unchanged
`parseScore.ts`/`diff.ts` need no changes: every extension method is just a
chained `Pattern` method or control inside an existing `$voice: …` block, and
the `$name:` voice grammar (transpiled to `.p('$name')` and stacked) is
untouched. The read-only `queryArc` tick path also needs no change — but note
extension methods that only exist on the live core won't resolve in the
transpiler's core, so a voice using `.midi()`/`.osc()` may simply yield **no
ticks** in the clock preview (harmless; it never reaches `superdough` either).

---

## Forbidden / non-existent (don't emit)

- `arpeggiate()` → use `arp(indices)`.
- `voicings(...)` positional → deprecated; use `voicing()`.
- `whenmod`, `quantise`/`quantize` → not in Strudel core (TidalCycles-only,
  unported); they'd throw in `evaluate`/the transpiler.
- `registerSoundfonts` from `@strudel/web` → undefined there; import from
  `@strudel/soundfonts`.
- Supersaw unison params `detunepower`/`detuneblend`/`detunestack` → do **not**
  exist; the real unison controls are `detune`/`unison`/`spread`.

---

## Sources

- [Packages overview](https://strudel.cc/technical-manual/packages/) ·
  [monorepo package list](https://codeberg.org/api/v1/repos/uzu/strudel/contents/packages)
- [Input/Output (MIDI/OSC/MQTT)](https://strudel.cc/learn/input-output/) ·
  [`packages/midi/midi.mjs`](https://codeberg.org/uzu/strudel/raw/branch/main/packages/midi/midi.mjs) ·
  [`packages/osc/osc.mjs`](https://codeberg.org/uzu/strudel/raw/branch/main/packages/osc/osc.mjs) ·
  [`packages/mqtt/mqtt.mjs`](https://codeberg.org/uzu/strudel/raw/branch/main/packages/mqtt/mqtt.mjs) ·
  [`packages/serial/serial.mjs`](https://codeberg.org/uzu/strudel/raw/branch/main/packages/serial/serial.mjs)
- [Csound](https://codeberg.org/uzu/strudel/raw/branch/main/website/src/pages/learn/csound.mdx) ·
  [Hydra](https://codeberg.org/uzu/strudel/raw/branch/main/website/src/pages/learn/hydra.mdx)
- [Gamepad](https://codeberg.org/uzu/strudel/raw/branch/main/packages/gamepad/docs/gamepad.mdx) ·
  [Motion](https://codeberg.org/uzu/strudel/raw/branch/main/packages/motion/docs/devicemotion.mdx)
- [`@strudel/soundfonts`](https://codeberg.org/uzu/strudel/raw/branch/main/packages/soundfonts/index.mjs) ·
  [Tonal functions](https://strudel.cc/learn/tonal/)
- [`@strudel/web` (initStrudel, prebake order, re-exports)](https://codeberg.org/uzu/strudel/raw/branch/main/packages/web/web.mjs) ·
  [version graph](https://codeberg.org/uzu/strudel/raw/branch/main/packages/web/package.json) ·
  [official prebake (soundfonts + tags)](https://codeberg.org/uzu/strudel/raw/branch/main/website/src/repl/prebake.mjs)
- Refrain: `src/audio/strudelEngine.ts`, `vite.config.ts`, `src/theme/tokens.ts`
  (`SAMPLE_PACKS`), `src/music/directives.ts`, `src/music/lanes.ts`.

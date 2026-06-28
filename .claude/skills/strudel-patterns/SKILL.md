---
name: strudel-patterns
description: Authoring and reviewing Strudel pattern code for Refrain — mini-notation syntax (sequences, [], <>, *, /, !, @, ?, |, euclid, {}%n, .., :n), notes/scales/chords (note/n/scale/voicing/transpose/arp), and the full transform vocabulary (signals, time/conditional/random modifiers, accumulation, effects). Use whenever you edit directives.ts (the Maestro's verbs → real Strudel methods), lanes.ts (variation templates), parseScore.ts (the event-estimate heuristic), or generate/validate any `$voice: …` expression. The authority for the hard rule "never invent functions": every method here is verified against @strudel/core / @strudel/tonal source. If a function is not in this skill, do not emit it — confirm it first.
---

# Authoring Strudel pattern code

The code **is** the score. A Refrain voice is `$name: <strudel expression>`, e.g.
`$drums: s("bd*2")`. Each `$name:` is transpiled to `expr.p('$name')` and all
named voices are `stack()`ed and played in parallel by `repl.evaluate(fullScore)`
(`src/audio/strudelEngine.ts`). The Maestro's job is to turn intent into *real,
inspectable* Strudel — so the iron rule is **method names must be real**. This
skill is the allowed vocabulary; anything not listed here you must verify before
emitting (then add it).

Strudel moved to **codeberg.org/uzu/strudel** — old `github.com/tidalcycles/strudel`
raw URLs 404. Refrain runs `@strudel/web ^1.3.0` (core/mini/tonal/transpiler 1.2.6).

## The shape of a `$voice` expression

```
$name: <constructor>("<mini-notation>")  .modifier(arg)  .control(arg)  …
       └ pitch/sound source ┘            └─ chained pattern transforms ─┘
```

- **Constructor** turns a mini-notation string into a Pattern: `s()`/`sound()`
  (sample or synth name), `note()` (pitch), `n()` (index — sample / scale degree
  / voice), `freq()` (Hz). Factory forms: `stack`, `cat`/`slowcat`, `seq`/`fastcat`,
  `silence`, `run(n)`.
- **Modifiers & controls** are chained methods, each taking `number | Pattern`
  (or `string | Pattern` for `vowel`/`distort` type/`ir`). They compose:
  `note("c e g").s("sawtooth").lpf(800).room(0.4)`.
- Continuation lines must be **indented** — `parseScore` ends a voice block at a
  blank line, the next `$name:`, or a non-indented line. `directives.ts`
  `appendChain` adds a new indented `.method(...)` line just after the block.

```
setcps(0.5)
$drums: s("bd*2, hh*8").bank("RolandTR909")
$bass:  note("<c2 g1>*4").s("sawtooth").lpf(700)
        .gain(0.6)
```

Double quotes `"…"` = mini-notation; single quotes `'…'` = plain JS string (NOT
parsed). Refrain voices are single-line **double-quoted** — always use `"`.

---

## Mini-notation (the inner string)

Space-separated tokens are a **sequence squashed into ONE cycle**: N tokens →
each is `1/N` of the cycle. Adding tokens shortens each, never lengthens the cycle.

| Symbol | Name | Meaning | Method form |
|--------|------|---------|-------------|
| `a b c` | sequence | N events in one cycle | `seq(a,b,c)` |
| `[a b]` | subsequence | nest into ONE outer slot (fastcat) | `[a b]` |
| `<a b c>` | alternation | **one per cycle** (slowcat) — spans 3 cycles | `cat(a,b,c)` |
| `a*n` | fast | n copies compressed into the slot (speeds up) | `.fast(n)` |
| `a/n` | slow | stretch over n cycles | `.slow(n)` |
| `a!n` | replicate | n **full-length** consecutive copies (no speedup) | — |
| `a@n` / `a _` | elongate | weight n (bare `_` = weight 2 = one extra step) | — |
| `~` / `-` | rest | a silent step (`-` is an exact alias of `~`) | `silence` |
| `a?` / `a?p` | degrade | 50% (or p) chance removed per cycle | `.degradeBy(p)` |
| `a\|b\|c` | random choice | one picked at random **per cycle** | `chooseCycles(…)` |
| `a,b,c` | stack | play **simultaneously** (chord / parallel) | `stack(a,b,c)` |
| `a(p,s)` | euclid | p onsets over s steps (Bjorklund) | `.euclid(p,s)` |
| `a(p,s,r)` | euclid+rot | rotate the onsets by r steps | `.euclidRot(p,s,r)` |
| `{a b, c d}` | polymeter | sub-seqs advance at same step rate | `polymeter(…)`/`pm(…)` |
| `{…}%n` | polymeter steps | force n steps per cycle | `.pace(n)` |
| `0 .. 7` | range | inclusive integer run `0 1 … 7` (descending ok) | `run(8)` |
| `name:n` | sample index | nth sample (`bd` == `bd:0`); wraps mod count | `s("name").n(n)` |
| `a b . c d` | feet | `.`-separated subsequence groups | `[a b] [c d]` |

**Traps (these matter for `parseScore` and generation):**
- `a*2` (compress into one slot) ≠ `a!2` (two full slots). `<a b c>` is slowcat —
  it spans **3 cycles**, not a faster group; use `<a b c>*3` or `[a b c]` to fit one cycle.
- `,` (simultaneous) vs `|` (random per cycle) do opposite things.
- `?` and `|` are **non-deterministic per cycle** (seeded RNG advances each cycle) —
  never assert a fixed outcome; a single `queryArc` snapshot of them is not stable.
- `{a b c, d e}` **without `%n`** defaults steps-per-cycle to the FIRST sub-seq's
  top-level step count (here 3), counting `[x y]` as one step.
- `bd:3` is a **sample index**, not a rhythmic separator — do not split on `:`.
- euclid step counts must be **integers** — `bd(3,8.5)` throws (`Array(5.5)` RangeError).
- `(3,8,3)` parses pulses=3, steps=8, rotation=3 — identical to `.euclidRot(3,8,3)`.
- Modifier args can themselves be patterns: `hh*<2 3>`, `bd(<3 5>,8)`.

`parseScore.estimateEvents` already approximates this: strips `<…>` (≈1/cycle),
takes the **max** comma branch, removes `[]`, counts `~`/`-` as a step, applies
`*n`, clamps to `[1,64]`. When extending it, account for `!`/`@`/`{}%n`/`(p,s)`/`..`.

---

## Notes, scales & chords (`@strudel/tonal`, bundled in `@strudel/web`)

Three ways to express pitch — they are **not** interchangeable:

| | What it sets | Example |
|---|---|---|
| `note(v)` | absolute pitch: name (`c3`, `eb2`, `f#4`) or MIDI (`69`=A4) | `note("c4 a4 f4 e4")` |
| `n(v)` | an **index** — sample (with wrap), scale degree (with `.scale`), or voice (with `.voicing`) | `n("0 2 4").scale("C:major")` |
| `freq(hz)` | raw frequency, bypasses note/MIDI mapping | `freq("220 440").s("triangle")` |

- **Octave**: a digit after the letter+accidental; **defaults to 3** when omitted
  (`c` == `c3`, scale/chord roots default to octave 3). Accidentals stack (`fbb1`).
- **`n()` alone with a sample is a sample index, NOT pitch.** For pitch use `note()`.
  Putting MIDI-like numbers in `n()` expecting pitch is a classic bug.

| Function | Signature | Note |
|----------|-----------|------|
| `scale` | `.scale("root:type[:type]")` | turns degrees → notes / quantizes. **No spaces** — `"C:bebop:major"`. Patternable: `.scale("C:<major minor>/2")` |
| `transpose` | `.transpose(semitones \| "<deg><type>")` | type = M/m/P/A/d (`"5P"`, `"3m"`). No scale needed |
| `scaleTranspose` | `.scaleTranspose(steps)` | shifts by **scale steps**; requires a prior `.scale()` |
| `add` | `.add(value \| pattern)` | numeric add; on notes converts to MIDI. `.add(note(12))` = +1 octave |
| `arp` | `.arp("0 [0,2] 1 …")` | arpeggiate stacked chord notes by index (NOT `arpeggiate`) |
| `chord` | `.chord("<C Am G7 Bb^7>")` | chord-symbol control consumed by `voicing()` |
| `voicing` | `.voicing()` | render chord symbols → notes. Controls: `dict`/`anchor`(c5)/`mode`(below\|above\|duck\|root)/`offset`/`octaves`/`n` |
| `rootNotes` | `.rootNotes(octave)` | bassline from a chord progression |

Built-in voicing dicts: `ireal` (default), `ireal-ext`, `lefthand`, `triads`,
`guidetones`, `legacy`. Register custom with `addVoicings(name, dict, [lo,hi])`.

**Tonal traps:** `arpeggiate` does NOT exist (use `arp`). `voicings()` (with s) is
deprecated → use `voicing()`. Scale names use colons not spaces. `voicing()` on an
unknown chord logs a warning and produces **silence** (silent failure). Octave
up/down = `±12` semitones — Refrain's `octdown`/`octup` emit exactly `.add(note(-12))`
/`.add(note(12))` when there are no explicit octave digits to rewrite.

---

## Transform vocabulary

### Signals (LFOs) — for modulating any numeric control
Bare **values**, not functions: `sine cosine saw isaw tri square` (0..1) and their
bipolar `*2` variants (`sine2`…, -1..1); `perlin` (smooth), `rand` (0..1). Called as
functions: `irand(n)` (ints 0..n-1), `run(n)`, `brand`/`brandBy(p)`, `choose(…)`,
`chooseCycles(…)`, `wchoose([v,w]…)`, `wchooseCycles(…)`.

Scaling: `.range(min,max)` (unipolar 0..1 only), `.range2(min,max)` (bipolar `*2`
signals), `.rangex(min,max)` (exponential — good for cutoff/freq). `.segment(n)`/`.seg(n)`
samples a continuous signal into n discrete steps per cycle.

```
s("hh*8").lpf(sine.range(500, 4000))     // sine is 0..1 → use .range
s("hh*8").lpf(sine2.range2(500, 4000))   // sine2 is -1..1 → use .range2
```

### Time
`fast`/`slow`/`hurry` · `rev` · `palindrome` · `iter(n)`/`iterBack(n)` · `ply(n)`
(repeat each event n×) · `plyWith` · `segment` · `compress(b,e)` · `fastGap` · `zoom(b,e)`
· `early(c)`/`late(c)` (nudge ∓ cycles) · `struct("x ~ x")` (impose rhythm) ·
`mask("1 0 1")` (filter, keep where true) · `euclid`/`euclidRot`/`euclidLegato`/`euclidLegatoRot`
· `swingBy(amount, n)` / `swing(n)` (= `swingBy(1/3, n)`) · `inside`/`outside` · `repeatCycles(n)`.

### Conditional
`every(n,f)`/`firstOf(n,f)` (apply f on first of each n cycles) · `lastOf(n,f)` ·
`when(boolPat, f)` · `within(start,end,f)` · `chunk(n,f)`/`chunkBack`/`fastChunk` · `invert`.

### Random
`degradeBy(p)`/`degrade` (= `degradeBy(0.5)`) · `undegradeBy`/`undegrade` (complementary)
· `sometimesBy(p,f)`/`sometimes` and the fixed-probability family `often`(.75)/`rarely`(.25)/
`almostNever`(.1)/`almostAlways`(.9)/`never`(0)/`always`(1) · `someCyclesBy(p,f)`/`someCycles`
(decided per **cycle**). `useRNG('legacy'|'precise')`.

### Accumulation (layering / stereo)
`stack`/`cat`/`slowcat`/`fastcat`/`seq` · `arrange([cycles,pat]…)` · `superimpose(f)`
(original + transformed) · `layer(…f)` (transformed only, no original) · `off(time,f)`
(delayed transformed copy — pitched echo/canon) · `jux(f)`/`juxBy(w,f)`/`juxFlip(f)`
(stereo split, pass a function reference like `rev`) · `echo(times,time,fb)` ·
`echoWith(times,time,fn)`. Math: `add`/`sub`/`mul`/`div`.

**Modifier traps:**
- Higher-order modifiers (`every` `when` `jux` `superimpose` `layer` `off` `chunk`
  `sometimes`…) take a **function**: `jux(rev)` or `x=>x.rev()`, never `jux(rev())`.
- `echo(times, time, feedback)` vs deprecated `stut(times, feedback, time)` — 2nd/3rd args swap.
- `superimpose` keeps the original; `layer` drops it.
- `whenmod` and `quantise`/`quantize` do **NOT** exist in Strudel core — never emit them
  (they'd crash the transpiler's `evaluate`, which Refrain uses for read-only tick queries).

### Effects / controls
| Group | Controls (canonical · aliases) |
|-------|--------------------------------|
| filter | `lpf`·cutoff/ctf/lp · `lpq`·resonance · `hpf`·hp/hcutoff · `hpq` · `bpf`·bandf/bp · `bpq` · `vowel` (a e i o u …) · `djf` · `ftype` (0=12db,1=ladder,2=24db) |
| filter env | `lpenv`/`lpa`/`lpd`/`lps`/`lpr` (+ `hp*`, `bp*`), `fanchor` |
| reverb | `room` (wet 0..1) · `roomsize`·rsize/sz/size (decay 0..10) · `roomfade` · `roomlp` · `ir`·iresponse |
| delay | `delay` · `delaytime`·dt · `delayfeedback`·dfb (≥1 runs away) · `delaysync` |
| distortion | `distort`·dist (`"amt:postgain:type"`) · `crush` (1..16) · `coarse` · `shape` (deprecated → distort) |
| dynamics | `gain` (exponential, default 0.8) · `velocity`·vel (×gain) · `postgain` · `compressor("thr:ratio:knee:att:rel")` |
| spatial | `pan` (0..1) · `orbit`·o (shared delay/reverb bus) |
| modulation | `phaser`/`phaserdepth`/`phasercenter`/`phasersweep` · `tremolo`/`tremolosync`/`tremolodepth`/`tremoloshape` |
| duration | `clip` **===** `legato` (same control — duration multiplier; cuts samples at slot end) |
| sample | `speed` (neg = reverse) · `begin`/`end` (0..1) · `chop`/`striate`/`slice`/`loopAt`/`loop`/`cut` |

**Colon-packing** in mini-notation fills multi-name controls positionally:
`s("bd:2:0.8")` → s=bd, n=2, gain=0.8; `delay("0.5:0.25:0.7")` → delay/delaytime/delayfeedback;
`lpf("1000:10")` → cutoff+resonance; `distort("3:0.5:diode")`. **The 2nd colon field
after a sound is `n` (sample index), the 3rd is `gain`** — not pan.

**Effect traps:** `clip` and `legato` are the **same** control (don't treat as two
params). `room` (wet) ≠ `roomsize`/`size` (decay) even though "size" aliases both.
`delay`/`room` are **global per-`orbit`** buses — voices sharing an orbit share the
bus; give distinct `orbit(n)` for independent delay/reverb. `amp`/`dry` are
`@superdirtOnly` (no effect in the web engine — prefer `gain`/`room`).

### Synth shaping
Waveforms via `s()`: `sine sawtooth`(`saw`)`square triangle` (triangle is the
**default** when `note()` has no `.s()`), plus `supersaw`, `pulse`, noise sources
`white`/`pink`/`brown`/`crackle`. Amplitude ADSR: `attack`·att/`decay`·dec/`sustain`·sus
(level 0..1)/`release`·rel, or `adsr("a:d:s:r")`. Pitch env: `penv`(semitones, neg
flips)/`pattack`/`pdecay`/`prelease`/`pcurve`(0=lin,1=exp)/`panchor`. FM:
`fm`(index)/`fmh`(harmonicity)/`fmattack`·fmatt/`fmdecay`·fmdec/`fmsustain`·fmsus/`fmenv`("lin"|"exp").
Vibrato: `vib(hz)` + `vibmod(semitones)` (or `vib("4:.5")`). Additive: `partials([…])`
(+ `sound("user")`)/`phases`. Noise amount on a pitched osc: `.noise(amt)`.

> **Unverified — do NOT emit:** supersaw unison params `detunepower`/`detuneblend`/
> `detunestack` (don't exist; real ones are `detune`/`unison`/`spread`).

### Sounds & banks
`s("bd hh sd")` plays samples; `s("sawtooth")` plays a synth (same control). Pick a
drum machine with `.bank("RolandTR909")` (prepends `RolandTR909_`); bank names are
case-insensitive, patternable (`bank("<RolandTR808 RolandTR909>")`), and the short
aliases (`tr909`, `tr808`) work via `tidal-drum-machines-alias.json`. Standard
suffixes: `bd sd rim cp hh oh cr rd ht mt lt sh cb tb perc`. Sample index via `:n`
or `.n(n)` — **wraps** mod the folder count (never errors/silent). House/techno
staples: TR-808/909/707/606.

`samples(jsonUrlOrMap[, baseUrl])` loads packs (async, boundary). Refrain's prebake
(`strudelEngine.ts`) loads from `SAMPLE_PACKS.dough` (felixroos/dough-samples):
`tidal-drum-machines.json`, `piano.json`, `Dirt-Samples.json`, `EmuSP12.json`,
`vcsl.json`, `mridangam.json`, then `aliasBank(todepond/tidal-drum-machines-alias.json)`.
GM soundfonts (`gm_*`) are **not** loaded — don't emit them. First trigger of a
sample may be silent (lazy load); `strudel.json` is aggressively browser-cached.

---

## Quick reference — methods Refrain already emits (all real)

Whitelist for `directives.ts` / `lanes.ts`. Every one is verified; editing these is
safe, and the `codeHint` strings must stay honest (one real method each).

| Refrain use | Emitted Strudel | Directive id / lane |
|-------------|-----------------|---------------------|
| crescendo/diminuendo | `.gain(saw.range(0.35,1).slow(n))` | `crescendo`/`diminuendo` |
| accent downbeat | `.gain("1.6 0.8 0.8 0.8")` | `sforzando` |
| humanize timing | `.late(rand.range(-0.012,0.012))` | `rubato` |
| tighter canon | `.superimpose(x => x.late(0.0625))` | `stretto` |
| staccato / legato | `.clip(0.4)` / `.clip(1).legato(1.4)` | `staccato`/`legato` |
| con fuoco | `.distort("1.6:0.4").gain(1.1)` | `confuoco` |
| misterioso | `.room(0.6).lpf(700).degradeBy(0.3)` | `misterioso` |
| swing | `.swingBy(1/3, n)` | `swing` |
| half/double time | `.slow(2)` / `.fast(2)` | `halftime`/`doubletime` |
| octave shift | rewrite octave digits, else `.add(note(±12))` | `octdown`/`octup` |
| darker/brighter | `.lpf(600)` / `.lpf(4500)` | `darker`/`brighter` |
| sparser/busier | `.degradeBy(0.4)` / `.ply(2)` | `sparser`/`busier` |
| louder/quieter/drop | `.gain(1.2)` / `.gain(0.6)` / `.gain(0)` | `louder`/`quieter`/`drop` |
| reverb / pan | `.room(0.6)` / `.pan(sine.range(0.2,0.8).slow(4))` | `reverb`/`pan` |
| accel/rit | rewrites the `setcps(…)` value (needs a cps line) | `accel`/`rit` |
| lane templates | `s("white").lpf(sine.range(…))`, `s("sd*[8 N]").gain(saw.range(…)).bank("RolandTR909")`, `note("c4 eb4 g4 bb4").s("triangle")`, `note("c2*4").s("sawtooth").lpf(…)`, `s("hh*16").gain(perlin.range(…)).pan(sine.range(…))`, `note("<Cm7 Fm9>").s("sawtooth").struct("t ~ t ~").room(…)` | `lanes.ts` |

**Safe additions** (real, currently unused): `.jux(rev)` (stereo widen),
`.off(1/8, x=>x.add(7))` (pitched echo), `.every(4, x=>x.rev())`, `.iter(4)`,
`.echo(3,1/6,.8)`, `.someCyclesBy(.3, f)`, the `often`/`rarely` family, `.euclid(p,s)`/
`.euclidRot(p,s,r)`, `chord(…).voicing()` + `.rootNotes(2)`, `.arp("0 [0,2] 1 [0,2]")`,
`.transpose("5P")` / `.scale("C:major").scaleTranspose(n)` for "in key" / "up a fifth".

## Reviewing / generating: the checklist

1. **Every method real?** Cross-check against this skill. Unknown → verify against
   `@strudel/core` `controls.mjs`/`pattern.mjs` or `@strudel/tonal` before using; if
   unsure, leave it out. Never emit `whenmod`, `quantise`, `arpeggiate`, `voicings`,
   `detunestack`, `gm_*`.
2. **Right constructor?** `note()` for pitch, `n()` for index (sample/scale degree),
   `s()` for sound. Don't put pitch numbers in `n()`.
3. **Signal scaling?** `.range` for 0..1 signals, `.range2` for `*2` signals.
4. **Higher-order args are functions**, not calls.
5. **Determinism for previews:** `?`/`|`/random modifiers shift each cycle, so a
   single `queryTicks`/`queryArc` snapshot won't be stable — assert shape, not exact onsets.
6. **Octave/chord safety:** shifting octave digits must not corrupt chord symbols
   (e.g. `Abmaj7`) — see `shiftOctave`'s regex guard in `directives.ts`.

## Sources

- Mini-notation: <https://strudel.cc/learn/mini-notation/> · grammar `packages/mini/krill.pegjs`
- Notes/Tonal: <https://strudel.cc/learn/notes/> · <https://strudel.cc/learn/tonal/>
- Effects: <https://strudel.cc/learn/effects/> · Synths: <https://strudel.cc/learn/synths/>
- Time/Conditional/Random modifiers: <https://strudel.cc/learn/time-modifiers/> · `/conditional-modifiers/` · `/random-modifiers/`
- Factories: <https://strudel.cc/learn/factories/> · Samples: <https://strudel.cc/learn/samples/>
- Source of truth: `codeberg.org/uzu/strudel` — `packages/core/{controls,pattern,signal,euclid}.mjs`, `packages/tonal/{tonal,voicings}.mjs`

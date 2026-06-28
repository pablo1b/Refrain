---
name: strudel-sounds
description: Strudel's sonic palette for Refrain — what actually makes sound. Use when changing Refrain's instruments, samples, or effect vocabulary: the s()/n()/note()/freq() source-and-pitch model, the built-in synth engine (waveforms, FM, additive, noise, ADSR + pitch envelope), the sample library and drum abbreviations, drum-machine banks, loading custom packs via samples()/aliasBank() (the strudel.json map format, github:/shabda shortcuts, soundfonts), and every audio-effect control (filters, reverb, delay, distortion, pan, dynamics, modulation) with real canonical names + aliases. Maps to strudelEngine.ts prebake / SAMPLE_PACKS and directives.ts. Every function name here is verified against @strudel/web 1.3.0 — emit only these.
---

# Strudel sounds, samples & synths (the sonic palette)

Everything that makes a voice *audible* in Refrain. A voice is `$name: s("…")…` —
a sound **source** plus chained **controls**. This skill is the authoritative,
real-names-only reference for sources, the synth engine, sample loading, and
effects. The hard rule: **Strudel method names must be real.** Every name below is
verified against the installed `@strudel/web@1.3.0` graph (core/mini/tonal/webaudio
1.2.6–1.3.0). If it isn't here, don't emit it — add an open question instead.

Repo note: Strudel moved to **codeberg.org/uzu/strudel**; the old GitHub raw paths
404. Rendered docs stay at strudel.cc.

## The source + pitch model — s / n / note / freq

| Function | Aliases | What it does |
|----------|---------|--------------|
| `s(...)` | `sound` | Selects the sound **source** by name: a synth waveform (`"sawtooth"`) OR a loaded sample (`"bd"`, `"piano"`). Registered as the multi-control `['s','n','gain']`. |
| `note(...)` | — | **Pitch** by note name (`c3`, `eb2`, `f#4`) or MIDI number (`69` = A4). Default synth is **triangle** if no `.s()`. |
| `n(...)` | — | An **index**: sample number (wraps), scale degree (after `.scale()`), or voice index (after `.voicing()`). **Not pitch.** |
| `freq(...)` | — | Pitch directly in **Hz** (e.g. `440`). Bypasses note/MIDI mapping. |

```js
s("bd hh sd hh")                  // samples
note("c a f e").s("sawtooth")     // pitch + timbre
note("60 64 67")                  // MIDI → triangle synth
freq("220 275 330 440").s("triangle")
```

**Critical confusions (bake these into generated code):**

- `note()` ≠ `n()`. Bare integers in `note()` are MIDI; in `n()` they are
  sample/scale/voice indices. For a raw melody use `note()`.
- Octave digit follows the letter+accidental and **defaults to 3**: `c` == `c3`.
- `triangle` is the default waveform — `note("c3")` with no `.s()` is a triangle.

### Picking a sample variant

Two equivalent ways; both index zero-based and **wrap** (index 4 on a 4-sample
folder == index 0, never silent/error):

```js
s("hh:0 hh:1 hh:2 hh:3")          // colon in mini-notation
s("hh*4").n("0 1 2 3")            // the n() control
```

The colon carries up to two extra fields — `name:n:gain` — because `s` is
`['s','n','gain']`. So `s("bd:1:1.4")` = sample 1 at gain 1.4 (the **second**
colon field is gain, not pan/speed).

## The synth engine

### Waveforms & noise

`registerSynthSounds()` (called in Refrain's prebake) registers: `triangle`,
`square`, `sawtooth`, `sine`, `user`, `one`; aliases `tri`/`sqr`/`saw`/`sin`;
synths `sbd`, `supersaw`, `bytebeat`, `pulse`, `bus`; and noise sources `white`,
`pink`, `brown`, `crackle`. **`sbd` is the only synth *drum*** — there is no synth
snare/hat. Noise has two forms:

```js
s("bd*2, <white pink brown>*8").decay(.04).sustain(0)  // noise SOURCE
note("c3").noise("<0.1 0.25 0.5>")                      // .noise() ADDS pink noise
s("crackle*4").density("<0.01 0.2 0.5>")                // crackle + density
```

### Amplitude ADSR

| Control | Alias | Meaning |
|---------|-------|---------|
| `attack` | `att` | time to peak (s) |
| `decay` | `dec` | time to sustain level (s) |
| `sustain` | `sus` | sustain **level** (0–1), not a time |
| `release` | `rel` | time from offset to zero (s) |
| `hold` | — | hold time (s); needs attack AND release set |
| `adsr` | — | shorthand: `adsr("a:d:s:r")` |

```js
note("[c3 bb2 f3 eb3]*2").s("sawtooth").lpf(600).adsr(".1:.1:.5:.2")
```

`sustain(0)` + short `decay` = plucky/percussive. (`sustain` is a level;
everything else is seconds.)

### Pitch envelope

`penv(semitones)` (negative flips the sweep down) with its own ADSR: `pattack`/
`patt`, `pdecay`/`pdec`, `prelease`/`prel`, plus `pcurve` (0 = linear default,
1 = exponential — good for kicks), `panchor` (0 → range `[note, note+penv]`;
1 → `[note-penv, note]`), and `psustain`/`psus`. Classic synth kick:

```js
note("g1*4").s("sine").pdec(.5).penv(32).pcurve(1)
```

### FM synthesis

`fm`/`fmi` = modulation index (brightness); `fmh` = harmonicity ratio (whole =
harmonic, decimal = metallic). Modulator envelope: `fmattack`/`fmatt`,
`fmdecay`/`fmdec`, `fmsustain`/`fmsus`, `fmrelease`/`fmrel`, `fmenv`/`fme`
(`"lin"`|`"exp"`), `fmwave` (default `sine`). Up to 8 operators (`fm1..fm8`,
`fmh1..fmh8`, …).

```js
note("c e g b g e").fm(4).fmh("<1 2 1.5 1.61>").fmdecay(.1).fmsustain(.4)
```

### Additive & vibrato

- `partials([…])` — magnitude of each harmonic; **first value is the
  fundamental, not DC**. To build a new waveform use `.s("user")` (on a real
  waveform `partials` only spectrally filters). `phases([…])` sets harmonic phases.
- `vib(freqHz)` (aliases `vibrato`, `v`) + `vibmod(semitones)` (alias `vmod`).
  `vibmod` does nothing unless `vib` is set. Colon shorthand sets both:
  `vib("4:.5")` = 4 Hz, 0.5-semitone depth.

### Supersaw / pulse (verified subset only)

`.s("supersaw")` with `unison` (voice count, default 5), `detune`/`det`
(default ~0.18), `spread` (stereo, default 0.6). Pulse: `pw` (pulse width,
default 0.5), `pwrate`/`pwr`, `pwsweep`/`pws`. **Do not emit** `detunepower`,
`detuneblend`, `detunestack` — they don't exist.

## Sample library & drum machines

### Drum abbreviations (tidal-drum-machines suffixes)

`bd` kick · `sd` snare · `rim` rimshot · `cp` clap · `hh` closed hat · `oh` open
hat · `cr` crash · `rd` ride · `ht`/`mt`/`lt` high/mid/low tom · `sh` shaker ·
`cb` cowbell · `tb` tambourine · `perc` · `misc` · `fx`. Not every bank has every
suffix — a missing one is silent.

### Banks — `bank(name)`

`bank('X')` literally prepends `X_` to each `s` value, so
`s("bd sd").bank('RolandTR909')` === `s("RolandTR909_bd RolandTR909_sd")`. It's
patternable: `bank("<RolandTR808 RolandTR909>")`. Lookup is **case-insensitive**.

```js
s("bd*4, hh:0 hh:1 hh:2 hh:3").bank("RolandTR909")
```

Use canonical folder names (72 machines) — the house/techno staples are
`RolandTR808`, `RolandTR909`, `RolandTR707`, `RolandTR606`, plus `LinnDrum`,
`AkaiMPC60`, `OberheimDMX`, `CasioRZ1`, `EmuSP12`, etc. Short aliases like
`tr909`/`tr808` work **only** because Refrain loads `aliasBank(tidal-drum-machines-alias.json)`
(values like `"RolandTR909": "TR909"`, matched case-insensitively). When in doubt
emit the canonical `RolandTR909`.

## Loading custom packs — `samples()` / `aliasBank()`

`samples()` is an async **system boundary** (a real `fetch` of JSON + audio).
Forms:

```js
samples('https://host/strudel.json')                    // URL to a sample map
samples({ bd:'bd/k.wav', sd:['sd/a.wav','sd/b.wav'] }, baseUrl)  // inline map
samples('github:user/repo/branch')                      // → raw.githubusercontent…/strudel.json (branch defaults main)
samples('shabda:bass:4,hihat:4')                         // freesound query
```

### The sample-map JSON format

A name maps to a path string, an **array** of paths (selectable with `n`/`:`), or
a **nested pitch object** for tuned/multi-region instruments. `_base` (top-level
or per-entry) is the URL prefix. Spaces must be percent-encoded.

```json
{
  "_base": "https://raw.githubusercontent.com/tidalcycles/Dirt-Samples/master/",
  "bassdrum": "bd/BT0AADA.wav",
  "snaredrum": ["sd/rytm-01-classic.wav", "sd/rytm-00-hard.wav"],
  "moog": { "g2": "moog/004_Mighty%20Moog%20G2.wav", "g3": "moog/005_Mighty%20Moog%20G3.wav" }
}
```

Pitched playback uses the nested form so the sampler tunes correctly; pair with
`.clip(1)` to let notes ring: `note("g2 c3").s('moog').clip(1)`.

### Aliasing

- `aliasBank(jsonUrl | map | (bank, alias))` — bank-level aliases (the `_` prefix).
- `soundAlias(original, alias)` — single-sound rename: `soundAlias('RolandTR808_bd','kick')`.

### Soundfonts (not loaded in Refrain)

`registerSoundfonts()` from **`@strudel/soundfonts`** (not re-exported by
`@strudel/web` — the export is commented out) unlocks GM instruments (`gm_piano`,
`gm_epiano1`, `gm_marimba`, …) played via `note()`. Refrain doesn't load these;
adding a dynamic `import('@strudel/soundfonts').then(({registerSoundfonts}) => registerSoundfonts())`
to prebake (as strudel.cc does) would.

### Behaviors to surface in UX, not misreport as errors

- **First-trigger silence**: the map loads eagerly but audio files lazy-load on
  first trigger — a sound may be silent the first time it plays.
- **Aggressive caching**: `strudel.json` and audio are browser-cached; bust with a
  case change or `?version=N`.
- **CORS**: a direct browser fetch — the host must send CORS headers (raw GitHub
  and the Strudel CDN do).

## Audio effects (chainable controls)

Every effect is a control accepting `number | Pattern` (or `string | Pattern` for
`vowel`/`ir`/`distorttype`). Several pack related params via colon (the multi-name
registration shown in the right column).

### Filters

| Control | Aliases | Range / notes | Packed form |
|---------|---------|---------------|-------------|
| `lpf` | `cutoff`, `ctf`, `lp` | 0–20000 Hz | `['cutoff','resonance','lpenv']` → `lpf("1000:10:4")` |
| `lpq` | `resonance` | 0–50 (Q) | |
| `hpf` | `hp`, `hcutoff` | high-pass cutoff | `['hcutoff','hresonance','hpenv']` |
| `hpq` | `hresonance` | 0–50 | |
| `bpf` | `bandf`, `bp` | band-pass center | `['bandf','bandq','bpenv']` |
| `bpq` | `bandq` | Q | |
| `vowel` | — | `a e i o u ae aa oe ue y uh un en an on` (string!) | |
| `ftype` | — | `0`/`12db`, `1`/`ladder`, `2`/`24db` | |
| `djf` | — | <0.5 low-pass, >0.5 high-pass | |

Filter envelopes (per filter, mirror for `hp*`/`bp*`): `lpenv`/`lpe` (depth, can be
negative), `lpattack`/`lpa`, `lpdecay`/`lpd`, `lpsustain`/`lps`, `lprelease`/`lpr`,
plus `fanchor` (0 unipolar+, .5 bipolar, 1 unipolar−). The env only sounds when
both cutoff and `lpenv` are set.

### Reverb (`room` family — a per-`orbit` global bus)

`room` (wet 0–1) is the main knob; `roomsize`/`rsize`/`sz`/`size` (decay 0–10) is a
**distinct** param. Tail: `roomfade`/`rfade`, `roomlp`/`rlp`, `roomdim`/`rdim`. IR
convolution: `ir`/`iresponse`/`i`, `irspeed`, `irbegin`.

```js
s("bd sd").room("<0 .4 .8>").rsize(4).rlp(8000)
```

`roomsize`/`roomfade`/`roomlp`/`roomdim` **recalculate** the reverb when
changed — never pattern them fast.

### Delay (also a per-`orbit` global bus)

`delay` (send 0–1), `delaytime`/`delayt`/`dt` (s), `delayfeedback`/`delayfb`/`dfb`
(0–1 — **≥1 runs away louder forever**), `delayspeed` (feedback pitch),
`delaysync` (time in cycles). Packed: `delay("0.65:0.25:0.9")` =
`['delay','delaytime','delayfeedback']`.

### Distortion / lo-fi

| Control | Alias | Notes |
|---------|-------|-------|
| `distort` | `dist` | wave-shaping; `"amount:postgain:type"` (e.g. `"3:0.5:diode"`); useful 0–10. Prefer over `shape`. |
| `crush` | — | bit-crush 1 (drastic) – 16 (subtle) |
| `coarse` | — | sample-rate reduction (Chromium only) |
| `shape` | — | **deprecated** — can get unpredictably loud; use `distort` |

### Pan / dynamics / modulation

- `pan` (0 left – 1 right, 0.5 center). `jux(fn)` / `juxBy(width, fn)` split stereo
  (pass a **function reference**: `jux(rev)`).
- `gain` (exponential; multiplied with `velocity`/`vel` 0–1), `postgain` (linear,
  after all FX), `compressor("threshold:ratio:knee:attack:release")`. (`amp`, `dry`
  are `@superdirtOnly` — prefer `gain`/`postgain`/`room` on the web engine.)
- `phaser`/`ph`/`phaserrate` + `phaserdepth`/`phd`, `phasercenter`/`phc`,
  `phasersweep`/`phs`.
- `tremolo`/`trem` (Hz) or `tremolosync`/`tremsync` (cycles) + `tremolodepth`,
  `tremoloskew`, `tremolophase`, `tremoloshape` (`tri|square|sine|saw|ramp`).
- `orbit`/`o` — the global FX bus key. Voices sharing an orbit share one
  delay/reverb instance; give layered voices distinct orbits to keep tails
  independent. `duckorbit`/`duck` sidechains a target orbit.

### Sample-playback controls

`begin`/`end` (0–1 buffer offsets), `speed` (rate; negative reverses), `clip`/
`legato` (**same control** — duration multiplier; not "sustain"), `loop`,
`loopAt`, `chop`, `striate`, `slice`, `cut`. Breakbeat idiom:
`s("break").loopAt(4).chop(16)`.

## Maps to Refrain

- **`directives.ts`** already emits real names from this skill: `.lpf(600)`
  (darker) / `.lpf(4500)` (brighter), `.gain(1.2)`/`.gain(0.6)`/`.gain(0)`
  (louder/quieter/drop), `.room(0.6)` (reverb), `.distort("1.6:0.4")` (confuoco),
  `.clip(0.4)` (staccato), `.clip(1).legato(1.4)` (legato — note both names are
  the same control), `.pan(sine.range(0.2,0.8))`. New character directives can
  pull from here: "pluckier" → `sustain(0)` + short `decay`; "metallic" →
  `fm` + non-integer `fmh`; "wobble" → `vib(…).vibmod(…)`; "kick punch" → `sine` +
  `penv` + `pcurve(1)`; "crunchy" → `crush`/`coarse`; "sidechain" →
  `orbit`/`duckorbit`. Untapped: `velocity` (multiplies gain) for accents.
- **`lanes.ts`** templates already use this vocabulary —
  `s("sd*[8 N]").gain(…).bank("RolandTR909")`, `s("hh*16").gain(perlin.range(…))`,
  `note("…").s("sawtooth").distort("…")`, `s("white").lpf(sine.range(…))`,
  `note("<Cm7 Fm9>").s("sawtooth").room(…)`. All validated as real API. A
  bass/lead/pad lane differs mainly in waveform + ADSR + filter.
- **`strudelEngine.ts` prebake** (`SAMPLE_PACKS` in `theme/tokens.ts`) calls
  `registerSynthSounds()`, six `samples(<dough>.json)` packs, and
  `aliasBank(<todepond>tidal-drum-machines-alias.json)` — all confirmed real and
  used correctly. No new engine wiring is needed to add effects/synth controls
  (they evaluate through the existing `repl.evaluate`); only the wavetable (`wt_`)
  and soundfont (`gm_*`) palettes would require new `samples()`/import lines in
  prebake.
- **`parseScore.ts`**: the colon in `s("bd:3")` is a sample index, **not** a
  rhythmic separator — `estimateEvents` must not split on it.

## Pitfalls

- `triangle` is the implicit default — a note with no `.s()` is not a sine.
- `n()` is not pitch. A melody written into `n()` (no `.scale()`) plays sample
  indices, not notes.
- `clip` and `legato` are one control; `room` (wet 0–1) ≠ `roomsize` (decay 0–10)
  even though both alias `size`.
- `lpq`/`hpq`/`bpq` are aliases of `resonance`/`hresonance`/`bandq`; `phaser`'s
  canonical name is `phaserrate`; `ir` is canonical (not `iresponse`).
- `delayfeedback ≥ 1` and `distort`/`shape` can get dangerously loud.
- `vowel`, `ir`, `distorttype` take **string** values — quote them.
- Sample index wraps (never errors); first-trigger silence and stale
  `strudel.json` caches are expected, not bugs.
- Do not invent `detunepower`/`detuneblend`/`detunestack`, a synth snare/hat
  beyond `sbd`, or `arpeggiate`/`quantise`/`whenmod` (use `arp`).

## Sources

- strudel.cc/learn/[sounds](https://strudel.cc/learn/sounds/) ·
  [samples](https://strudel.cc/learn/samples/) ·
  [synths](https://strudel.cc/learn/synths/) ·
  [effects](https://strudel.cc/learn/effects/) ·
  [notes](https://strudel.cc/learn/notes/)
- Source of truth (Codeberg `uzu/strudel`): `packages/core/controls.mjs`
  (every control + alias + range), `packages/superdough/synth.mjs`
  (`registerSynthSounds`), `packages/superdough/sampler.mjs` (`samples`),
  `packages/superdough/superdough.mjs` (`aliasBank`/`soundAlias`),
  `packages/web/web.mjs` (`initStrudel` prebake order),
  `packages/soundfonts/` (`registerSoundfonts`).
- [tidal-drum-machines](https://github.com/geikha/tidal-drum-machines/tree/main/machines)
  (the 72 canonical bank names).

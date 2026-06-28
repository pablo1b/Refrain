# Refrain

**An AI-native live-coding music IDE, built on Strudel.** Compose the loop — by hand or by intention.

Refrain is a workspace where a *Strudel score* and a *musical conversation* are two views of one
composition. Type TidalCycles-style patterns directly, or speak to the **Maestro** in plain musical
language — *make the hats swing, bring the bass down an octave, three ways into the drop* — and watch the
code change, audition it on the next cycle, and accept it. **Every AI action is a real, inspectable,
reversible edit to code you own.** Nothing is a black box.

This is a web implementation of the *Refrain — Design Spec* (imported from a claude.ai/design project),
built with real Strudel audio via [`@strudel/web`](https://www.npmjs.com/package/@strudel/web). The spec
describes a Tauri desktop app; this runs the same instrument in the browser.

## Run it

```bash
npm install
npm run dev      # http://localhost:5173
```

Click anywhere (or press <kbd>Space</kbd>) to start audio — browsers only allow sound after a gesture.
The first start fetches Strudel's sample packs (dirt-samples, drum machines, …) from GitHub, so the very
first play needs a network connection. Synth voices (the bass & pad) sound offline regardless.

```bash
npm run build    # typecheck + production bundle into dist/
npm run preview  # serve the build
```

## The workspace (spec §04)

Four surfaces around one transport:

- **The Shelf** (left) — the live *voice outline* parsed from your score (solo/mute per voice), plus
  files, patches and sample packs.
- **The Score** (centre) — a CodeMirror editor with Strudel syntax colouring, active-voice highlight, and
  inline <kbd>⌘K</kbd>. When the Maestro proposes an edit, a **cycle-aware diff** appears here.
- **The Maestro** (right) — the conversational pair. Every turn becomes a **diff**, **variation lanes**,
  or **an answer**. Type **`/`** for the directive palette.
- **The Stage** (bottom) — the **Cycle clock** (a radial reading of one cycle: each voice a ring, each
  event a tick, a single playhead sweeping the present), per-voice meters, solo/mute.

### The Maestro's three shapes (spec §06)

1. **A diff** — bounded edits to existing code, auditioned live, accepted hunk-by-hunk.
2. **Variation lanes** — 2–4 forks of new material to solo against the mix; commit one, park the rest.
3. **An answer** — explanation, no code change.

**Directives** are curated musical verbs with reproducible transforms — `crescendo`, `rubato`,
`staccato`, `cantabile`, `con fuoco`, `misterioso`, plus gesture verbs (`swing`, `half-time`, `octave
down`, `darker`, …). They run **deterministically and fully offline**. A connected model (Providers panel)
adds free-form edits and theory read-outs, but is never required.

### Other surfaces

Inline diff (§7.1), variation lanes (§7.2), Patch Designer (§7.3), Sample Foundry (§7.4), Notation Bridge
(§7.5), Arrangement scene grid (§7.6), Performance mode (§7.7), Providers & routing / BYOK (§7.8).

## Keyboard

| Key | Action |
| --- | --- |
| <kbd>Space</kbd> | play / stop transport |
| <kbd>⌘⏎</kbd> | evaluate the score |
| <kbd>⌘K</kbd> | ask the Maestro inline |
| <kbd>⏎</kbd> | accept the staged edit |
| <kbd>⌫</kbd> / <kbd>Esc</kbd> | reject the staged edit |
| <kbd>⌘.</kbd> | PANIC — hush all voices (the clock keeps running) |
| <kbd>/</kbd> (in Maestro) | directive palette |

## Architecture

```
src/
  audio/strudelEngine.ts   real @strudel/web wrapper — init + sample prebake, evaluate/play/panic,
                           scheduler readout (now/cps), per-voice hap queries for the clock
  music/parseScore.ts      split a score into named voice blocks ($drums: …)
  music/directives.ts      the musical verbs → bounded, valid Strudel transforms
  music/diff.ts            line-LCS → toggleable hunks + subset-apply (per-hunk accept)
  music/lanes.ts           variation-lane generation (real audible snippets)
  llm/providers.ts         BYOK fetch (Anthropic/OpenAI/Google/Ollama), role→model routing
  state/store.ts           zustand store — the brain (transport, voices, Maestro, staged edits, scenes)
  theme/                   the colour language + clock geometry
  components/              the surfaces (Titlebar, Shelf, ScoreEditor, DiffView, Maestro, Stage,
                           CycleClock, VariationLanes, PerformanceMode, ProvidersModal, Arrangement,
                           PatchDesigner, SampleFoundry, NotationBridge)
```

The colour language carries fixed meaning (spec §10): **lime** = live / the cycle, **amber** = the
Maestro / AI authorship, **blue** = selection / structure, **ink** = the dark stage surface. Type is
Spectral (display) · Hanken Grotesk (UI) · JetBrains Mono (code). Dark is the default; a light theme
preserves the same grammar.

## Status / scope

A faithful MVP of the design. The audio engine, the cycle, directives, diffs, variation lanes, themes,
and all eight surfaces are wired and runnable. MIDI/OSC out, neural sample generation, true score
engraving, and multiplayer are out of scope here (the spec lists them as "next/explore/open").

## License

Refrain is licensed under the **GNU Affero General Public License v3.0 or later**
(`AGPL-3.0-or-later`) — see [`LICENSE`](./LICENSE) for the full text.

Refrain bundles [`@strudel/web`](https://codeberg.org/uzu/strudel) (the live source;
GitHub is an archive), which is itself AGPL-3.0 — so the AGPL is the matching license
for the combined work that ships to the browser. Because the AGPL covers **network use**
(§13), any publicly hosted instance must offer its users the complete corresponding
source of that running version; this repository is that source. If you deploy a modified
Refrain, keep your fork's source available to its users.

Copyright © 2026 Pablo Bariola and the Refrain contributors.

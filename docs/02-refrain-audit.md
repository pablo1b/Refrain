# Refrain — Implementation Audit vs Design Spec (v0.1)

Audit of the current codebase against `Refrain — Design Spec.dc.html` (§01–§11).
Purpose: inform the next design round. Organised as **Implemented / Partial-Divergent /
Missing / Additional**, plus roadmap status and a prioritised punch-list.

Method: four parallel code-vs-spec passes (workspace+cycle, Maestro+directives+diff+lanes,
producer surfaces, cross-cutting flows/craft/system). All citations are repo-root paths.

---

## TL;DR

The **instrument core is genuinely solid and end-to-end**: code-is-the-score with staged,
auditioned, per-hunk-reversible diffs; a real-scheduler Cycle clock; deterministic offline
directives (all 12 spec verbs present); variation lanes; scenes; PANIC; keyboard-first;
BYOK + local-only routing; light/dark with the colour grammar preserved.

The gaps cluster in three places:
1. **The Cycle's *interactive* role** — it's a faithful read-out but not yet a *target* (no
   arc-drag to scope a command, no "time-until-live" marker).
2. **Producer surfaces are uneven** — Arrangement and Performance are real; **Patch Designer,
   Sample Foundry, and Notation Bridge are largely cosmetic shells**.
3. **Cross-cutting promises are unmet** — **no provenance/musical-changelog, no
   time-travel/branchable history, generation is counter- not seed-reproducible, metering is
   simulated, and there is no Tauri/on-disk local-first platform** (browser-only SPA).

---

## 1. Implemented (faithful to spec)

### Workspace shell (§04) & Cycle read-out (§05)
- Four surfaces (Shelf / Score / Maestro / Stage) around one transport — `App.tsx:99-108`
  (grid `188px / 1fr / 312px`, matches the figure).
- Titlebar transport: cycle / bpm / cps from the live scheduler — `Titlebar.tsx:93-99`
  (`LiveCycle` reads `engine.now()` per frame; `bpm = round(cps*240)`).
- Window dots, logo, project name, provider chip + status dot, theme toggle, PANIC —
  `Titlebar.tsx:58-120`.
- Shelf tabs OUTLINE/FILES/PACKS; live voice outline with colour swatch + sigil + S/M;
  PATCHES/SAMPLES sections — `Shelf.tsx:11-122`.
- Score is the real Strudel CodeMirror 6 editor; active-voice highlight + `▸ playing`
  widget; inline ⌘K hint — `ScoreEditor.tsx:96-178, 217-236`.
- Stage = Cycle clock + per-voice meters + solo/mute + CPU/headroom line — `Stage.tsx:16-54`.
- **Cycle clock is honest**: rings per voice, ticks per event from a *pure read-only*
  `@strudel/transpiler` evaluate + `pattern.queryArc` (separate from the playing repl),
  single playhead driven by `engine.now()` via rAF — `CycleClock.tsx:25-88`,
  `strudelEngine.ts:170-192`.
- Edits land on the cycle boundary (Strudel scheduler quantises eval) — `store.ts:482-499`.
- Performance mode fills the screen with the clock ("scales to the room") —
  `PerformanceMode.tsx:99-103`.

### The Maestro & directives (§06, §07.1, §07.2, §07.8)
- **Three output shapes**, exactly one per turn: diff (`store.ts:351-354, 421-444`),
  variation lanes (`store.ts:355-372`), answer (`store.ts:373-376, 396-419`); routed by
  `interpret` (`directives.ts:254-298`).
- **All 12 spec-named directives present**: crescendo, diminuendo, sforzando / rubato,
  accel., rit., stretto / staccato, legato, marcato / cantabile, con fuoco, misterioso —
  `directives.ts:114-186`. Palette summoned by `/` — `Maestro.tsx:24-26`,
  `DirectivePalette.tsx`.
- "Grounded, not guessing" — directives edit parsed voices line-exact and require an
  existing voice; diff against real nodes — `directives.ts:64-132`, `diff.ts`.
- "Nothing reaches the speakers unvetted" — dry-run eval before audition (`store.ts:184-189`),
  lane errors stay in-lane.
- **Inline diff, accept hunk-by-hunk** — per-hunk toggle + `applyEnabled` subset apply —
  `DiffView.tsx:59-111`, `diff.ts:113-127`; re-audition on toggle (`store.ts:513-517`).
- **Variation lanes** — 2–4 forks appended as new `$voice` (never overwrite), solo on top of
  the live mix, commit one + park rest, re-roll — `lanes.ts:83-108`, `store.ts:521-572`.
- **Providers/BYOK** — Anthropic/OpenAI/Google/Ollama real fetch; 4 roles mapped to
  provider+model; local-only switch gates network at the routing layer —
  `providers.ts:12-178`, `ProvidersModal.tsx`, `store.ts:191-199`.

### Producer surfaces that are real
- **Arrangement (§07.6)** — scenes are a real backed type; `snapshotScene` captures the live
  mix; `launchScene` mutates voice state, rebuilds, re-evaluates the transport; grid renders
  real voices×scenes with click-to-launch — `types.ts:77-82`, `store.ts:575-597`,
  `Arrangement.tsx:40-89`.
- **Performance mode (§07.7)** — chrome-clear via Esc; full-screen real-scheduler clock; live
  voice list + meters; scene launchers reuse real store actions; PANIC/HUSH wired —
  `PerformanceMode.tsx:11-127`. `engine.panic()` correctly evaluates `silence` without
  `stop()` (engine keeps the transport alive) — `strudelEngine.ts:131-138`.

### System (§10) & principles (§02)
- Colour language with fixed meaning (lime=live, amber=Maestro, blue=selection, ink=stage),
  code in its own cool palette, light theme preserves the grammar — `index.css:1-140`.
- Three typefaces (Spectral / Hanken Grotesk / JetBrains Mono) — `index.css:12-14`.
- Keyboard-first: Space, ⌘⏎, ⌘K, ⏎, ⌫/Esc, ⌘. — `App.tsx:57-91`, `ScoreEditor.tsx:149-166`.
- Accessibility *form*: meters carry numeric `%` + `role="meter"`/`aria-valuenow` —
  `Stage.tsx:33-43`. prefers-reduced-motion stills the clock sweep — `CycleClock.tsx:23,29`.
- Settling-not-bouncing motion (no spring/confetti) — `index.css:186-210`.

---

## 2. Partial / Divergent (the meat for the next design round)

### The Cycle is a read-out, not yet a *target* (§05)
- **No clock-as-input.** Spec: point/drag an arc to scope a command ("the first beat," "every
  off-beat," "drop the hats here"). The clock is `role="img"` with no pointer handlers —
  `CycleClock.tsx`. No arc-selection → time-span → `.mask()`.
- **No "time-until-live" marker.** Spec: the sweep shows how long until a staged change goes
  live. The quantise *behaviour* exists; the *boundary/countdown visualisation* does not.

### Metering & headroom are simulated, not honest (§10)
- Per-voice levels are a deterministic random-walk stand-in (self-documented) —
  `useMeters.ts:3-33`. The accessible numeric read-out is accurate to the *fake* value.
- Master headroom is a hardcoded `−6.2 dB` and **CPU% is dropped entirely** (figure showed
  `cpu 12% · −6.2 dB`) — `Stage.tsx:24`.
- The meter random-walk runs on a 130ms interval that **ignores prefers-reduced-motion** —
  `useMeters.ts:18-31`.

### Shelf FILES / PACKS / PATCHES are static mock data
- File, pack, and patch lists are hardcoded arrays, not wired to disk or to `SAMPLE_PACKS` —
  `Shelf.tsx:107-114, 157, 171`. Presented in spec as live project surfaces.

### Patch Designer (§07.3) — cosmetic shell
- Knobs are interactive and live-update the displayed chain string — `PatchDesigner.tsx:8-80`.
- **No preview audio** despite "turn a knob to hear it" — zero `engine.*` calls in the file.
- **NL box does nothing** — the `<input>` at `:101` has no handler (spec: "tell the Maestro…
  both edit the same thing").
- **Hardcoded output** — emits a fixed `$warmpad: note("<Cm7 Abmaj7>")…` regardless of which
  Shelf patch was clicked; only lpf/lpq/release reflect the knobs — `:58-62`.

### Sample Foundry (§07.4) — cosmetic shell
- **None of the three sources work**: neural-generate, search, upload are all inert; "render"
  just un-dims a static, procedurally-drawn waveform — `SampleFoundry.tsx:42-67`.
- **No real slicing**; the "auto-sliced · 4 / n0..n3" labels are hardcoded.
- **Not a playable bank** — `add()` inserts a hardcoded `$smp: s("casio").n("0 1 2 3")` using
  the built-in `casio` sample; no `samples()`/`aliasBank()` registration anywhere — `:17-21`.

### Notation Bridge (§07.5) — real code-substitution wrapped in a cosmetic staff
- **Staff is decorative** — note-heads drawn from hardcoded y-coordinate arrays unrelated to
  the actual chord tokens; Roman numerals are literals — `NotationBridge.tsx:25-49, 89-97`.
- **Not bidirectional** — staff is non-interactive SVG; no staff→code path.
- **No audio preview** despite the summary claiming "preview on staff + audio."
- Theory is shallow — `reharmonize` is a small lookup + regex ("key-respecting-ish"); no real
  key analysis; voice-lead/modulate/invert/counterpoint absent. *The code substitution it
  stages is genuinely correct* — `:57-72`.

### Arrangement transition is a stub (§07.6, Flow G)
- "The Maestro writes the transitions" → `askTransition` just sends a canned chat prompt and
  closes the modal — `Arrangement.tsx:19-22`. No transition object, no generated automation,
  no **rehearse/lock** controls, no timeline duration; `Scene.levels` is binary 0/1.

### Variation lanes — minor divergences (§07.2)
- Hard-codes exactly **3** lanes (`lanes.ts:87`), though spec says 2–4 and pools hold 4.
- **No per-lane "refine with a follow-up"** — only re-roll is wired, yet the footer/seed copy
  promises "refine the keeper" — `VariationLanes.tsx:73`, `store.ts:367`.
- **No persistent variation tree** — "⌥ tree" is a static label; re-roll replaces lanes in
  place; committed/parked forks are not a walkable structure — `store.ts:565-572`.

### Providers — keychain divergence (§07.8)
- Keys live in `localStorage`, not the OS keychain (honestly disclosed in code + modal copy,
  but the spec requirement is unmet in this build) — `providers.ts:52-73`.
- Local-only is enforced only at the role-routing layer (no hard global network kill-switch);
  holds in practice because all call sites route through `provForRole` — `store.ts:197`.

### Principle v — time-travel / branching largely NOT as specified (§02.v, §09)
- **No history stack, no undo/redo, no rewind, no tree** in the store. The only "undo" is
  CodeMirror's text history; `acceptEdit` is destructive (overwrites `committed`, clears the
  staged edit) — `store.ts:482-499`. The seed message "Every change is a diff you can read and
  undo" (`store.ts:229`) overstates the actual capability.
- "Fork variations / A-B" is satisfied *only* for new material via variation lanes; there is
  no walkable/rewindable history of committed states.

### Platform — Tauri/desktop "files on disk" is absent (§02.vi, §10, §11)
- **No Tauri/Rust shell** anywhere (no `src-tauri`, no `tauri.conf`, no Rust) — it's a pure
  browser SPA. History/samples/patches are not on disk. README is honest about this, but it is
  a real divergence from the local-first-on-disk requirement (and removes the stated enabler
  for the §11 MIDI/OSC "NEXT" item).

---

## 3. Missing (no implementation)

- **Provenance / "a musical changelog" (§09)** — *the single largest unmet requirement.*
  `StagedEdit` has no seed/model/prompt and is discarded on commit; `Scene` stores only
  `{id,name,levels}`; `LaneSet.prompt` isn't persisted. No provenance data structure or UI —
  `types.ts:34-44, 76-82`.
- **Reproducible seeded generation (§09)** — lanes use a module-level counter, not a stable
  user-visible seed; "re-roll with the same seed" / "nudge the seed" don't exist —
  `lanes.ts:10-11, 88`.
- **Time-travel / rewind / branchable committed-state history (§02.v)** — see Partial.
- **Clock-as-pointer input + staged-change countdown (§05)** — see Partial.
- **Real per-voice audio metering + real CPU read-out (§10)** — see Partial.
- **User-authored directive packs (§06)** — directives are a fixed compiled array; no
  author/bind/import mechanism (spec: "author your own verb… the vocabulary is yours") —
  `directives.ts:22-55`.
- **Selection-scoped ⌘K** (edit a highlighted region) — diff path is reachable via Maestro
  messages, but no selection-scoped inline edit flow was found.
- **Web MIDI / OSC out (Flow H, §11 NEXT)** — no `requestMIDIAccess` anywhere; only a cosmetic
  "◎ MIDI mappable" label — `PerformanceMode.tsx:121`.
- **Ghost-completion in the editor (Flow A)** — not found.
- **Real sample render/generate/upload/auto-slice (Flow E)** — visual only.
- **Real staff engraving + harmonic analysis; bidirectional staff editing (§07.5)** — static
  SVG + tiny lookup.
- **Arrangement automation / crossfade / rehearse / lock (Flow G)** — stub.

---

## 4. Additional (beyond spec — present in code, not in the spec)

- **GESTURE directive group** — 14 plain-language verbs beyond the spec's four groups: swing,
  half-time, double-time, octave down/up, darker, brighter, sparser, busier, louder, quieter,
  reverberant, panned, drop — `directives.ts:40-55`.
- **`hush` (soft panic)** distinct from PANIC — `store.ts:306-312` (note: currently identical
  behaviour to panic; see bug list).
- **Sequential directive stacking** — directives compose against the pending staged result —
  `store.ts:201-206, 449`.
- **Offline fallbacks** — local "explain this line" and "nearest directives" suggestions when
  no model is connected — `store.ts:382-393, 649-677`.
- **Pure read-only tick visualization** via transpiler evaluate + `queryArc`, deliberately
  separated from the playing repl, with the "core loaded more than once" warning suppressed —
  `strudelEngine.ts:76-100, 170-192`.
- **AudioGate gesture toast**, **SurfaceRail nav chips**, **voice-dimming opacity convention**
  across Shelf/Stage/clock, **5th clock ring** (headroom for a 5th voice).
- **Role-based routing with per-role strength**, richer than the spec's BYOK note —
  `types.ts:95-102`.
- **AGPL compliance wiring** (LICENSE + README) for bundled @strudel/web.

---

## 5. Roadmap status (§11 — all deliberately deferred items)

| Item | Tag | Status |
| --- | --- | --- |
| MIDI & OSC out | NEXT | **still-open** — and its stated enabler (the Tauri/Rust shell) does not exist; only a cosmetic label. |
| Live collaboration | EXPLORE | still-open — single-user store, no networking/CRDT/cursors. |
| Directive & patch marketplace | EXPLORE | still-open — directives are a fixed in-code array; no share/import/pack. |
| Tablet performance companion | OPEN | still-open — Performance mode is desktop/keyboard only. |
| Notation-bridge fidelity limits | OPEN | still-open — static staff + toy reharm; no polyrhythm/microtonality handling. |

---

## 6. Confirmed bug (independently flagged by two passes)

- **PANIC visibly stops the on-screen clock — contradicts Fig. 7.7's central promise.**
  `engine.panic()` correctly keeps the real transport running (evaluates `silence`, never
  `stop()` — `strudelEngine.ts:131-138`), but `store.panic()`/`store.hush()` also
  `set({ playing: false })` (`store.ts:302, 310`), and `CycleClock` freezes its sweep when
  `!playing` (`CycleClock.tsx:21`). Net: pressing PANIC stills the visual clock even though
  audio-side it's still running. Fix: keep `playing: true` on panic/hush (only silence the
  audio), or decouple the clock's animation from the `playing` flag.

---

## 7. Suggested priorities for the next design round

**Trust/identity-defining (closest to the spec's thesis):**
1. **Provenance / musical changelog** — retain prompt+directive+seed+model on every staged
   edit, scene, and committed lane; surface a walkable history. This underwrites principles
   v ("branches & rewinds") and the §09 craft model.
2. **Time-travel / branchable history** — a real committed-state tree with rewind, not just
   CodeMirror text undo. Reconcile the seed-message claim with reality.
3. **Seeded, reproducible generation** — replace the module counter with a visible seed.

**Cycle as the signature instrument (§05 is under-delivered):**
4. Clock-as-target: arc-drag → time-span → `.mask()`; a "time-until-live" marker on the sweep.

**Honesty of the Stage:**
5. Real Web Audio metering + CPU read-out (replace `useMeters` random-walk and the hardcoded
   −6.2 dB); honor prefers-reduced-motion in the meters.

**Producer surfaces — promote from cosmetic to real (or rescope in the spec):**
6. Patch Designer: wire knobs/NL → actual emitted chain + held-note preview audio.
7. Sample Foundry: at least real upload + `samples()`/`aliasBank()` registration so banks are
   playable by name; be explicit in-spec about what "neural generate" means in a browser build.
8. Notation Bridge: render the staff from real pitches; decide the bidirectional scope.
9. Arrangement: generate real transition automation + rehearse/lock.

**Quick wins:**
10. Fix the PANIC-stops-clock bug (§6 above).
11. Make variation lanes 2–4 (variable) and add per-lane "refine," matching the promised copy.
12. Decide the platform story: either build the Tauri shell (unlocks on-disk local-first +
    MIDI/OSC) or revise the spec to a browser-first product. Align keychain vs localStorage
    accordingly.

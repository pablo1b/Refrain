# Refrain — Agent Manual Testing Rubric (Tier 3)

A repeatable, **AI-agent-driven** acceptance pass over the *live* app using the
**Chrome DevTools MCP** tools. This is the only tier that runs the real Strudel
engine, real audio scheduler, real network (sample packs), and the full UI — the
things tiers 1–2 deliberately mock away.

- **Target:** `http://localhost:5174/` (run `npm run dev`; vite.config says 5173,
  the user runs on 5174 — confirm with `list_pages` / `navigate_page`).
- **Driver:** an agent invoking the `chrome-devtools-mcp` tools (`navigate_page`,
  `take_snapshot`, `take_screenshot`, `click`, `fill`, `type_text`/`fill`,
  `press_key`, `hover`, `list_console_messages`, `list_network_requests`,
  `evaluate_script`, `wait_for`, `emulate`, `resize_page`).
- **Audio caveat:** the agent can't *hear* output. "Audio works" is proven by
  proxies: engine-ready log line, scheduler `started`, network sample fetches,
  and the **absence** of console/audio errors after an action. Note this honestly
  in every audio-related verdict.

## How the agent runs this

1. `navigate_page` to the app; `take_snapshot` for a baseline element tree + uids.
2. `list_console_messages` → record a **baseline** (expect zero errors before any
   gesture; the engine only boots on first interaction).
3. Execute each scenario **M01…M15** in order. For each: perform the steps, gather
   evidence, decide a verdict against the pass criteria, screenshot on any FAIL.
4. After every scenario, re-check `list_console_messages` for **new** errors —
   an unexpected console error is an automatic FAIL for that scenario.
5. Emit the **Results** block (machine-readable JSON + a short prose summary).

> Optional stronger assertions: if a dev build exposes the store (e.g.
> `window.__refrain = useStore`), the agent may `evaluate_script` to read
> `useStore.getState()` directly. Absent that, assert via DOM text + console/network.
> Reading store state via DOM: the score lives in `.cm-content`; Maestro messages
> are bubbles in the right panel; the activity log lines render in the Stage.

---

## Scenarios

### M01 — Cold boot & clean console
- **Goal:** App mounts with no errors before any audio gesture.
- **Steps:** `navigate_page` → `take_snapshot` → `list_console_messages`.
- **Expected:** Titlebar, left Shelf (voice outline), center ScoreEditor showing the
  `// nightjar — set 02` default score, right Maestro panel with the greeting, and
  the bottom Stage. No `error`-level console messages.
- **Pass:** All four regions present; default score visible; **0 console errors**.
- **Evidence:** baseline snapshot + console dump.

### M02 — Audio gate boots the Strudel engine
- **Goal:** First user gesture initializes audio + loads samples.
- **Steps:** Click anywhere (or the AudioGate CTA) → `wait_for` the engine-ready
  state → `list_console_messages` → `list_network_requests`.
- **Expected:** A log/console line indicating "Strudel engine ready · samples
  loaded"; network requests to the sample packs (raw.githubusercontent.com
  `dough-samples` / `todepond`); status flips toward ready.
- **Pass:** Engine-ready signal observed; sample fetches issued (2xx, or gracefully
  handled per the "best-effort prebake" code); no uncaught errors.
- **Evidence:** console + network list (filter for `samples`/`json`).

### M03 — Transport play/stop (Space)
- **Goal:** Spacebar toggles the transport.
- **Steps:** With focus outside any input, `press_key` Space → snapshot/log →
  `press_key` Space again.
- **Expected:** "▶ transport running" then "⏹ transport stopped" log lines; a
  playing indicator appears (e.g. `▸ playing` marker on the active voice / pulsing
  state) then clears. No audio errors.
- **Pass:** Both transitions logged; UI reflects playing then stopped; no errors.

### M04 — Directive via palette (`/` → swing → Accept)
- **Goal:** Palette directive stages a readable, reversible diff; Enter commits.
- **Steps:** Focus Maestro (`Cmd/Ctrl+K` or click textarea) → `fill`/`type_text`
  `/swing` → `take_snapshot` (palette open) → select `swing` (ArrowDown/Enter or
  click) → observe the staged DiffView → `press_key` Enter to Accept.
- **Expected:** Directive palette lists swing; choosing it opens the center DiffView
  with a `+ .swingBy(1/3, 8)` hunk and an "auditioning · commits on downbeat" note
  if playing; Accept commits and the score editor now contains `.swingBy(1/3, 8)`.
- **Pass:** Diff shown before commit; after Accept the editor text includes
  `.swingBy(1/3, 8)`; a "✓ edit committed" log line appears.

### M05 — Natural-language directive + Reject
- **Goal:** Plain language maps to a bounded directive; Reject discards.
- **Steps:** In Maestro type `make the bass darker` → Enter → observe staged diff →
  `press_key` Backspace (or click "Reject all").
- **Expected:** A staged diff appending `.lpf(600)` to the `$bass` voice; after
  Reject the diff disappears and the score is byte-unchanged.
- **Pass:** Correct voice targeted (`$bass`), correct transform, Reject restores the
  original score; "edit rejected" logged.

### M06 — Variation lanes (generate → solo → commit)
- **Goal:** Generation offers forks without overwriting; one can be committed.
- **Steps:** Maestro `give me 3 ways into the drop` → Enter → `take_snapshot`
  (lanes A/B/C) → solo lane A → commit lane A.
- **Expected:** A lanes message with 3 forks (filter sweep / snare roll / silence→hit
  for a "drop" prompt); soloing auditions it against the mix; committing appends a
  new `$<voice>: …` line to the score; the others stay parked.
- **Pass:** 3 lanes rendered; commit adds exactly one new voice to the editor; a
  "committed lane" log line appears.

### M07 — Mute / solo a voice
- **Goal:** Voice outline mute/solo changes what sounds (effective score).
- **Steps:** With transport running, in the Shelf outline toggle **mute** on `$drums`,
  then **solo** on `$hats`.
- **Expected:** UI marks drums muted / hats soloed; re-evaluation occurs without
  errors (proxy for "drums silenced", "only hats heard"). No console errors.
- **Pass:** Mute and solo toggles reflect in the outline; no errors on re-eval.

### M08 — Tempo nudge (cps)
- **Goal:** Changing cps rewrites the score and updates the clock.
- **Steps:** Use the CycleClock / cps control to nudge tempo up, then down.
- **Expected:** The `setcps(...)` value in the editor updates in place; the cycle
  clock speed/readout reflects the new cps; no snap-back on re-eval.
- **Pass:** Editor `setcps` value changes to match the control; no errors.

### M09 — PANIC (Cmd/Ctrl + .)
- **Goal:** Emergency hush keeps the clock safe.
- **Steps:** Start transport → `press_key` `Cmd/Ctrl+.`.
- **Expected:** "PANIC — all voices hushed; clock safe" log; playing flips false;
  no errors; app remains responsive.
- **Pass:** Panic log present; UI shows stopped; subsequent play still works.

### M10 — Providers modal (BYO key + local-only)
- **Goal:** Key entry connects a provider; local-only gates network.
- **Steps:** Open Providers (Shelf/Titlebar) → enter a dummy key for one provider →
  observe the connected chip → toggle local-only → close (Esc).
- **Expected:** Provider shows "connected"; the Maestro header model tag changes
  (e.g. "Anthropic · routed"); local-only flips the tag to "local-only"; key
  persists to `localStorage` (`refrain.providers`). No real network call is forced.
- **Pass:** Connected state + model-tag reflect the change; Esc closes the modal.

### M11 — Diff hunk toggling (partial accept)
- **Goal:** A multi-hunk edit can be partially accepted.
- **Steps:** Produce a multi-hunk edit (e.g. two sequential directives, or an LLM
  edit) → in DiffView toggle one hunk **off** → Accept.
- **Expected:** Toggling a hunk dims it and (if playing) re-auditions the subset;
  Accept commits only the enabled hunks; the editor reflects exactly that subset.
- **Pass:** Disabled hunk is excluded from the committed score; enabled hunk applied.

### M12 — Performance mode
- **Goal:** Performance mode renders and returns cleanly.
- **Steps:** Switch to Performance mode (Titlebar) → snapshot → return to Studio.
- **Expected:** A distinct performance UI mounts; no errors; returning restores the
  studio layout with state intact (score, voices unchanged).
- **Pass:** Both transitions render without error; state preserved.

### M13 — Scenes / Arrangement
- **Goal:** Snapshot and relaunch a scene.
- **Steps:** Open Arrangement → snapshot a scene from current mute/solo → change
  mutes → launch the saved scene.
- **Expected:** Scene captures the current voice levels; launching restores that
  mute/solo pattern; "scene captured" / "▸ scene" logs appear.
- **Pass:** Launching the scene reproduces its captured mute pattern; no errors.

### M14 — Theme toggle
- **Goal:** Dark/light switch is consistent.
- **Steps:** Toggle theme → `evaluate_script` to read
  `document.documentElement.getAttribute('data-theme')` → `take_screenshot`.
- **Expected:** `data-theme` flips dark⇄light; colors update across editor, panels,
  diff; no layout breakage.
- **Pass:** Attribute flips and the screenshot shows a coherent theme; no errors.

### M15 — Graceful error on invalid Strudel
- **Goal:** A broken pattern fails soft, never crashes the app.
- **Steps:** With transport running, type an invalid expression into a voice (e.g.
  `$drums: s(` ) in the editor → observe.
- **Expected:** An audio/eval error is surfaced in the activity log
  ("audio: …") but the app stays responsive; fixing it recovers playback.
- **Pass:** Error is reported in-app (not an uncaught console throw / white screen);
  recovery works.

---

## Accessibility & performance spot-checks (optional, high value)

- **A11y:** run the `chrome-devtools-mcp:a11y-debugging` skill — keyboard reachability
  of transport/accept/reject, focus visibility, tap-target sizes, contrast of the
  lime "live" accents on dark.
- **Perf:** `performance_start_trace` around app load → `performance_stop_trace` →
  `performance_analyze_insight` for LCP/long tasks; `take_heapsnapshot` after 2–3
  min of editing to check for leaks (CodeMirror views, engine evals).

---

## Scoring

Each scenario → `pass` | `partial` | `fail` | `blocked`.
- **pass:** all pass criteria met, no new console errors.
- **partial:** primary behavior works but a criterion is unmet or a non-error warning appears.
- **fail:** a pass criterion unmet, or a new console error appeared during the scenario.
- **blocked:** couldn't run (precondition missing, app not reachable).

**Release gate:** M01–M06, M09, M15 must be `pass` (core loop + safety + resilience).
M07–M08, M10–M14 may be `partial` with a tracked note.

## Results template (agent emits this)

```json
{
  "target": "http://localhost:5174/",
  "ranAt": "<ISO timestamp>",
  "build": "<git short sha>",
  "baselineConsoleErrors": 0,
  "scenarios": [
    { "id": "M01", "verdict": "pass", "evidence": "…", "notes": "" }
    /* …M02–M15… */
  ],
  "summary": { "pass": 0, "partial": 0, "fail": 0, "blocked": 0 },
  "releaseGate": "green | red",
  "topFindings": [ "…" ]
}
```

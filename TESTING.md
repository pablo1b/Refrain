# Refrain — Testing Protocol

This document is the map of how Refrain is tested, why it's structured this way,
and how to extend it. The day-to-day "how do I write a good test here" guide is the
**`/write-tests` skill** (`.claude/skills/write-tests/SKILL.md`); the quick
reference lives in **`CLAUDE.md`**.

## Philosophy — a three-tier pyramid

Refrain has a clean dependency gradient: pure deterministic music logic at the
core, two well-defined I/O boundaries at the edges, a Zustand store wiring them,
and a React/CodeMirror UI on top. The test strategy follows that gradient.

```
        ╱  Tier 3 — Agent manual rubric (Chrome DevTools MCP, live app, real audio)
       ╱     few, high-value, end-to-end + UX/a11y/perf — tests/manual/RUBRIC.md
      ╱── Tier 2 — Browser unit tests (real Chromium via Playwright)
     ╱       CodeMirror, getComputedStyle theme vars, real layout — *.browser.test.tsx
    ╱──── Tier 1 — Integrated unit tests (happy-dom, boundaries mocked)
   ╱         the bulk: music/*, store, providers, theme, render helpers — *.test.ts(x)
  ╱
 ╱ Foundation — pure functions need no mocks at all (parseScore, diff, directives, lanes)
```

Pick the **lowest** tier that can honestly exercise a behavior. Most logic belongs
in Tier 1; only reach for Tier 2 when a real DOM is genuinely required; reserve
Tier 3 for whole-system flows and the things that can't be faked (audio, samples).

## The two system boundaries

Everything testable sits between two edges that are **always mocked** in Tiers 1–2:

1. **Strudel audio engine** — `src/audio/strudelEngine.ts` (singleton `engine`):
   dynamically imports `@strudel/web`, runs an AudioWorklet, talks to Web Audio.
   Faked by `tests/mocks/engine.ts` → `createFakeEngine()` (every method a spy,
   faithful `init()`/`evaluate()`/`queryTicks()` contract, `__reset()` per test).
2. **LLM / network** — `src/llm/providers.ts` `chat()` (`fetch` to Anthropic/
   OpenAI/Google/Ollama) + `localStorage`. Faked by `tests/helpers/llm.ts`
   (`stubFetch`, `fakeResponse`, `replyBody.*`).

The code *between* them — `src/music/*` and the store's decision logic — is the real
code under test and is **never** mocked.

## Tier 1 — Integrated unit tests

- Runner: Vitest `unit` project, `happy-dom` environment, globals on.
- Files: `src/**/*.test.ts(x)`. Setup: `tests/setup.unit.ts` (jest-dom matchers,
  `cleanup()` + `localStorage.clear()` + `vi.clearAllMocks()` after each test).
- Store reset: `resetStore()` / `state()` from `tests/helpers/store.ts`.
- Run: `npm test` · watch: `npm run test:watch` · coverage: `npm run coverage`.

Covered: `parseScore`, `diff` (LCS hunks + `applyEnabled` round-trips), `directives`
(every transform + `interpret` NL routing + the octave-shift chord-safety
regression), `lanes`, `theme/tokens`, `rich` rendering, `llm/providers`
(per-provider request/parse/error), and the **store** with both boundaries mocked
(transport, mute/solo→effective score, directive staging/accept/reject/stacking,
hunk toggling, cps, hush/panic, scenes, variation lanes, the LLM edit path,
provider/role wiring).

## Tier 2 — Browser unit tests

- Runner: Vitest `browser` project, **real Chromium** via Playwright (`headless`).
- Files: `src/**/*.browser.test.tsx`. Setup: `tests/setup.browser.ts` (injects the
  themed CSS custom properties + `data-theme`, plus `cleanup()`).
- Run: `npm run test:browser` (requires `npx playwright install chromium`, already done).

Covered: `ScoreEditor` (CodeMirror actually renders the doc + `.cm-voiceSigil`
decorations, external store→editor sync), `cssVar` reading real themed properties,
`DiffView` (hunk rows, accept/reject/toggle wired to the store), `Maestro` (message
rendering, textarea submit → `sendMaestro`, `/` opens the directive palette).
Component tests keep `playing` **false** so no store action reaches the engine — no
engine mock needed at this tier.

## Tier 3 — Agent manual rubric

`tests/manual/RUBRIC.md` is a 15-scenario acceptance pass an AI agent runs against
the **live** app (`http://localhost:5174/`) with the **Chrome DevTools MCP** tools.
It exercises the real engine, real samples, and the full UI — cold boot, audio gate,
transport, directives (palette + NL), variation lanes, mute/solo, tempo, PANIC,
providers, partial-accept, performance mode, scenes, theme, and graceful failure —
plus optional a11y and performance spot-checks. Audio is verified by proxy
(engine-ready log, scheduler state, sample network calls, absence of errors), which
the rubric calls out honestly. The agent emits a machine-readable results block; the
release gate requires the core-loop + safety scenarios to pass.

To run it: start the dev server, then ask an agent to "execute tests/manual/RUBRIC.md
against localhost:5174 using the Chrome DevTools MCP and report the results block."

## File layout

```
CLAUDE.md                         # compact project + testing quick reference
TESTING.md                        # this file
vitest.config.ts                  # root: coverage + thresholds
vitest.workspace.ts               # the two projects (unit, browser)
.claude/skills/write-tests/       # the /write-tests skill
tests/
  setup.unit.ts                   # happy-dom setup
  setup.browser.ts                # browser setup (theme vars)
  mocks/engine.ts                 # fake Strudel engine (boundary)
  helpers/llm.ts                  # fetch stub + canned provider replies (boundary)
  helpers/store.ts                # Zustand reset + state() accessor
  manual/RUBRIC.md                # Tier 3 agent rubric
src/**/*.test.ts(x)               # Tier 1 (colocated)
src/**/*.browser.test.tsx         # Tier 2 (colocated)
```

## Non-determinism — the traps

- **IDs**: `id()` (store) and `lid()` (lanes) use `Date.now()` + module counters.
  Assert on shape/content/presence, never exact id strings.
- **Tick debounce**: `setScore`/`scheduleTicks` use `setTimeout(…, 220)`. Use
  `vi.useFakeTimers()` when a test depends on ticks; otherwise harmless (the engine
  early-returns when not ready).
- **Lane reroll** varies on a module counter — assert lane count/shape, not codes.

## Commands

| Command | What |
|---------|------|
| `npm test` | Tier 1 unit suite (happy-dom) |
| `npm run test:watch` | Tier 1 in watch mode |
| `npm run test:browser` | Tier 2 browser suite (Chromium) |
| `npm run test:all` | Both Vitest projects |
| `npm run coverage` | Tier 1 + coverage report (`src/music/**` threshold-enforced) |
| `npm run typecheck` | `tsc --noEmit` (tests excluded from the production build) |

Suggested CI: `npm run typecheck && npm test && npm run test:browser`, then publish
the coverage report. Tier 3 runs on demand (or nightly) against a deployed/preview URL.

## How this suite was built (and kept honest)

The suite was authored by a **team of agents in parallel** — one per module — each
following the `/write-tests` skill and self-verifying its file to green. Every
authored file was then handed to an independent **adversarial reviewer** agent
tasked to break it: find tautologies, assertions that pin wrong behavior, missing
regression cases (e.g. octave-shift must not corrupt `Abmaj7`; diff round-trips;
`interpret` longest-alias-first), and flaky reliance on non-determinism. Findings
were folded back in before the suite was accepted. Re-run that loop when adding
modules: author against the skill, then adversarially review.

## Current status

As of the initial build (all green):

- **Tier 1 (unit):** 196 tests across 8 files — `parseScore` (25), `directives` (62),
  `diff` (18), `lanes` (18), `store` (28), `providers` (29), `tokens` (11),
  `rich` (5). `npm test`.
- **Tier 2 (browser):** 14 tests across 3 files — `ScoreEditor` (4), `DiffView` (6),
  `Maestro` (4). `npm run test:browser`.
- **Typecheck:** clean (`npm run typecheck`).
- **Coverage** (`npm run coverage`): `src/music` 99.8% stmts / 97.97% branches
  (threshold 90/85 ✓), `src/llm` 97%, `src/state` 84%, `src/theme` 100%.
  `src/components` is intentionally low in this report — components are covered by
  the browser + manual tiers, not the happy-dom coverage run.
- **Tier 3 (agent rubric):** validated live against `:5174` — core-loop + safety
  scenarios (M01–M04, M09) all `pass`, **zero console errors**; see
  `tests/manual/last-run.md`. Run the full 15-scenario pass with the rubric.

Two minor hygiene findings surfaced by the live run (both now **fixed**):
- The Maestro `<textarea>` had no `id`/`name` (a11y) — added `id`/`name`/`aria-label`.
- `@strudel/core was loaded more than once` (dev warning). Not a version conflict
  (`npm ls @strudel/core` shows a single deduped `1.2.6`): `@strudel/web` is a
  self-contained bundle with its own `core` baked in, and the engine *also* uses
  `@strudel/transpiler` (a tiny, pure `core.evaluate`) for read-only clock-tick
  queries — that pulls a *second* `core` instance, which logs the warning.
  We must keep the standalone transpiler: web's exported `evaluate` is bound to
  the live playback repl (autoplay on), so using it for queries hijacked the
  scheduler and silenced playback. The second core is only used for one-shot
  read-only `queryArc` (its objects never re-enter web's repl), so it's harmless;
  the engine clears `globalThis._strudelLoaded` around the transpiler import to
  suppress the benign warning (`src/audio/strudelEngine.ts`; `vite.config.ts`).

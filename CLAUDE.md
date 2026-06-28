# Refrain — CLAUDE.md

AI-native **Strudel live-coding music IDE**. Vite + React 18 + Zustand + TypeScript SPA.
The code *is* the score: named voices `$drums: s("bd*2")`. The Maestro turns intent
(directives / natural language) into reversible, auditioned diffs.

Dev server: `npm run dev` (vite.config → :5173; commonly run on **:5174**).

## Architecture (inner → outer)

- `src/music/*` — **pure deterministic logic**, the prime unit targets:
  `parseScore` (voice blocks, cps, event estimate), `diff` (LCS hunks, `applyEnabled`),
  `directives` (`applyDirective` Strudel transforms + `interpret` NL→intent), `lanes`.
- `src/llm/providers.ts` — **system boundary**: `fetch` to LLM APIs + `localStorage`.
- `src/audio/strudelEngine.ts` — **system boundary**: dynamic `import('@strudel/web')` +
  Web Audio/AudioWorklet. Exports singleton `engine`. Audio is fully optional — the
  app is 100% functional with no keys and (for logic) no audio.
- `src/state/store.ts` — Zustand store wiring it together; side-effects go through
  `engine.*` and `chat()`.
- `src/components/*` + `src/theme/tokens.ts` (`cssVar` → `getComputedStyle`) — need real DOM.

## Testing — read this before writing tests

Full guide: **`.claude/skills/write-tests/SKILL.md`** (invoke `/write-tests`).
Protocol + agent rubric: **`TESTING.md`**.

**Three tiers.** Pick the lowest that honestly exercises the behavior:
1. **Unit** (`*.test.ts`, happy-dom) — `npm test`. Boundaries mocked.
2. **Browser** (`*.browser.test.tsx`, real Chromium) — `npm run test:browser`. For
   CodeMirror, theme CSS vars, real layout.
3. **Agent manual** (Chrome DevTools MCP vs live app) — `TESTING.md` rubric.
`npm run test:all` · `npm run coverage` · `npm run typecheck`.

**After any code change, run the affected tests before reporting done** — and update
tests whose assertions the change invalidates (e.g. editing a constant pinned by a test).

**Always mock the two boundaries (tiers 1–2):**
- Engine: `vi.mock('../audio/strudelEngine', async () => ({ engine: (await import('../../tests/mocks/engine')).createFakeEngine() }))`; `(engine as any).__reset()` in `beforeEach`.
- LLM in `providers.ts`: stub `fetch` via `tests/helpers/llm.ts`. LLM in the store: partial-mock `../llm/providers`, replace only `chat`.
- Never mock `src/music/*` — that's the code under test.

**Store tests:** `resetStore()` from `tests/helpers/store.ts` in `beforeEach`; drive via `state()`.

**Non-determinism — never assert on it:** `id()`/`lid()` use `Date.now()`+counters
(assert shape, not ids); ticks debounce on `setTimeout(220)` (fake timers if needed);
lane reroll uses a module counter.

**Exemplars to copy:** `src/music/parseScore.test.ts`, `src/llm/providers.test.ts`,
`src/state/store.test.ts`, `src/components/ScoreEditor.browser.test.tsx`.

**Coverage intent:** `src/music/**` near-total (threshold-enforced); store decision
logic high; components/boundaries covered by tiers 2–3.

## Conventions

Match the surrounding code: 2-space indent, single quotes, no semicolon-free style
(semicolons used), comment density like the existing modules (a short *why* header per
file). Strudel method names must be real — don't invent functions.

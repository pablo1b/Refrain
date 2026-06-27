---
name: write-tests
description: Write robust tests for Refrain (Vite/React/Zustand Strudel IDE). Use when adding or fixing unit tests, browser-tier component tests, or the agent-driven manual rubric. Covers the three test tiers, the two system boundaries to mock (Strudel engine + LLM/fetch), store reset, and the non-determinism traps.
---

# Writing robust tests for Refrain

Refrain is a Vite + React 18 + Zustand + TypeScript SPA: an AI-native Strudel
live-coding IDE. Tests live in **three tiers**. Pick the lowest tier that can
honestly exercise the behavior.

| Tier | Runner | Env | Mocks | File suffix | When |
|------|--------|-----|-------|-------------|------|
| **1 Unit** | Vitest `unit` project | happy-dom | boundaries mocked | `*.test.ts(x)` | pure logic, store, anything not needing real layout |
| **2 Browser** | Vitest `browser` project | real Chromium (Playwright) | engine mocked if `play()` is reached | `*.browser.test.tsx` | CodeMirror, `getComputedStyle`/theme vars, real layout |
| **3 Agent manual** | Chrome DevTools MCP | live app `:5174` | none (real engine + real audio) | `TESTING.md` rubric | end-to-end flows, audio, visual/UX acceptance |

Commands: `npm test` (unit), `npm run test:browser`, `npm run test:all`,
`npm run coverage`, `npm run typecheck`.

## The two system boundaries — always mock these in tiers 1–2

1. **Strudel audio engine** — `src/audio/strudelEngine.ts` exports a singleton
   `engine`. It dynamically imports `@strudel/web`, spins an AudioWorklet, and
   talks to Web Audio. Never let it run in a unit test.
2. **LLM / network** — `src/llm/providers.ts` `chat()` calls `fetch()` to
   Anthropic/OpenAI/Google/Ollama; load/save use `localStorage`.

Everything between them (`src/music/*`, the store's decision logic) is the
*real code under test* — do **not** mock it.

### Mock the engine (store / component tests)

The async-factory form dodges `vi.mock` hoisting/TDZ:

```ts
vi.mock('../audio/strudelEngine', async () => {
  const { createFakeEngine } = await import('../../tests/mocks/engine');
  return { engine: createFakeEngine() };
});
import { engine } from '../audio/strudelEngine'; // the fake
// beforeEach: (engine as any).__reset();
// assert: expect(engine.evaluate).toHaveBeenCalledWith(expect.stringContaining('silence'));
// configure failure: (engine.evaluate as any).mockResolvedValueOnce({ ok: false, error: 'boom' });
```

`createFakeEngine()` (`tests/mocks/engine.ts`) faithfully models the contract the
store reads: `init()` flips `ready`/`status` and fires `onStatus`; `evaluate()`
returns `{ ok: true }`; `queryTicks()` returns `[]`; every method is a spy.

### Mock the LLM

- **Testing `providers.ts` itself** → stub `fetch`: `tests/helpers/llm.ts` gives
  `stubFetch()`, `fakeResponse(body, {ok,status,text})`, and `replyBody.{anthropic,
  openai,google,ollama}(text)`. Assert URL/headers/body AND the parsed return.
  Always cover the `!res.ok` throw path. `afterEach(() => vi.unstubAllGlobals())`.
- **Testing the store's LLM path** → partial-mock so real `extractCode`/`loadProviders`
  survive and only `chat` is fake:
  ```ts
  vi.mock('../llm/providers', async (orig) => {
    const actual = await orig<typeof import('../llm/providers')>();
    return { ...actual, chat: vi.fn() };
  });
  ```

## Zustand store reset (mandatory in store/component tests)

The store is a module singleton. In `beforeEach` call `resetStore()` from
`tests/helpers/store.ts` (and `(engine as any).__reset()` if engine is mocked).
Read/drive state with `state()` (= `useStore.getState()`). `setupFiles` already
`localStorage.clear()` + `cleanup()` after each test.

## Non-determinism traps — neutralize, never assert on

- **IDs**: `id()` (store) and `lid()` (lanes) use `Date.now()` + counters. Assert
  on `.shape`, `.role`, `.text`, presence — never on exact id strings.
- **Timers**: `setScore`/`scheduleTicks` debounce ticks via `setTimeout(…,220)`.
  If a test depends on ticks, use `vi.useFakeTimers()` + `vi.advanceTimersByTime`.
  Otherwise it's harmless (engine not ready → early return).
- **Variation lanes** reroll on a module counter — assert lane *count/shape*, not
  specific generated codes.

## What good Refrain tests assert (avoid tautologies)

- **`parseScore`**: exact `startLine`/`endLine` incl. indented continuations, cps
  detection, `estimateEvents` clamping to [1,64], comma-stack = max branch.
- **`diff`**: round-trip — `applyEnabled(old,new,allOn) === new`,
  `applyEnabled(old,new,allOff) === old`, and per-hunk toggles reconstruct the
  exact mixed code. `computeHunks` count == `countHunks`.
- **`directives`**: each id appends/edits the *expected* Strudel (`.lpf(600)`,
  `.swingBy(1/3,8)`…); `octdown`/`octup` shift octaves but must NOT corrupt chord
  symbols like `Abmaj7` (regression-critical regex); `accel`/`rit` need a cps line
  (else error); error paths (no voice, unknown id). `interpret()`: slash commands,
  questions, generation phrases, longest-alias-first ("down an octave" beats
  "down"), voiceHint + degree extraction.
- **store**: play boots+evaluates; mute/solo silences the right voice in the code
  sent to the engine; directive stages (not commits) then accept/reject; sendMaestro
  routes directive/lanes/answer/unknown correctly; lane solo/commit; scene
  snapshot/launch; setCps rewrites the score in place.
- **browser**: CodeMirror renders the doc + `.cm-voiceSigil` decorations; external
  store change syncs into the editor (wrap store writes in `act`); `cssVar` reads a
  real themed property.

## Workflow

1. Read the source module fully before testing it.
2. Mirror the patterns in the exemplars: `src/music/parseScore.test.ts`,
   `src/llm/providers.test.ts`, `src/state/store.test.ts`,
   `src/components/ScoreEditor.browser.test.tsx`.
3. One behavior per `it`; table-drive (`it.each`) families like directives.
4. Run `npm test` (and `npm run test:browser` for tier 2) until green; check
   `npm run coverage` for gaps in `src/music/**` (threshold-enforced).
5. Adversarially re-read: would this test still pass if the implementation were
   silently broken? If not it's a tautology — fix it to pin real behavior.

See `CLAUDE.md` for the boundary/non-determinism quick reference and `TESTING.md`
for the full protocol incl. the tier-3 agent rubric.

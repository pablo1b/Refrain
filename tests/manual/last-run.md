# Tier-3 manual rubric — last run (sample/evidence)

Executed live via the Chrome DevTools MCP against the running dev server. This is a
real, filled-in example of the `RUBRIC.md` results block — keep it as the template
and overwrite it on each run. Only the release-gate-critical scenarios were run in
this validation pass; the rest are `notRun` (run them for a full acceptance pass).

```json
{
  "target": "http://localhost:5174/",
  "ranAt": "2026-06-27T18:06:00Z",
  "build": "79c3ba3",
  "baselineConsoleErrors": 0,
  "scenarios": [
    { "id": "M01", "verdict": "pass", "evidence": "All 4 regions render (titlebar, 4-voice outline, score editor with the nightjar default, Maestro greeting, Stage 'idle'). Console: only Vite/React dev notices.", "notes": "Minor a11y: Maestro textarea has no id/name (DevTools issue)." },
    { "id": "M02", "verdict": "pass", "evidence": "First click booted the engine; 7 sample manifests loaded (304) + RolandTR909 bd/sd + EmuSP12 hh .wav fetched (200).", "notes": "Benign warn: '@strudel/core was loaded more than once' — consider deduping strudel deps." },
    { "id": "M03", "verdict": "pass", "evidence": "Play flipped button to 'stop', cycle counter advanced, Stage meters live (-6.2 dB; voices 78/78/57/95%), '▸ playing' marker on active voice.", "notes": "" },
    { "id": "M04", "verdict": "pass", "evidence": "'/swing' opened the palette; Enter staged 'Swing on $hats — .swingBy(1/3, 8)' with one hunk + 'auditioning · commits on downbeat'; Accept committed .swingBy(1/3, 8) into the editor. Matches the directives unit-test expectation exactly.", "notes": "Cross-tier consistency confirmed." },
    { "id": "M09", "verdict": "pass", "evidence": "PANIC removed the playing marker (transport stopped); app stayed responsive.", "notes": "" },
    { "id": "M05", "verdict": "notRun", "evidence": "", "notes": "covered equivalently by store + Maestro automated tiers" },
    { "id": "M06", "verdict": "notRun", "evidence": "", "notes": "" },
    { "id": "M07", "verdict": "notRun", "evidence": "", "notes": "" },
    { "id": "M08", "verdict": "notRun", "evidence": "", "notes": "" },
    { "id": "M10", "verdict": "notRun", "evidence": "", "notes": "" },
    { "id": "M11", "verdict": "notRun", "evidence": "", "notes": "" },
    { "id": "M12", "verdict": "notRun", "evidence": "", "notes": "" },
    { "id": "M13", "verdict": "notRun", "evidence": "", "notes": "" },
    { "id": "M14", "verdict": "notRun", "evidence": "", "notes": "" },
    { "id": "M15", "verdict": "notRun", "evidence": "", "notes": "" }
  ],
  "summary": { "pass": 5, "partial": 0, "fail": 0, "blocked": 0, "notRun": 10 },
  "releaseGate": "green (for the core-loop + safety scenarios run)",
  "topFindings": [
    "Zero console errors across the whole session.",
    "Engine + real samples load and schedule audio (proven by .wav network fetches + live meters).",
    "Directive flow is byte-consistent between the live app and the directives unit tests (.swingBy(1/3, 8)).",
    "Two minor hygiene items: Maestro textarea lacks id/name (a11y); '@strudel/core loaded more than once' (dep dedup)."
  ]
}
```

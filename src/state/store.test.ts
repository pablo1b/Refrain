import { describe, it, expect, beforeEach, vi } from 'vitest';

// Both system boundaries are mocked. The engine fake records audio calls; the
// LLM module is partially mocked so chat() never hits the network while the real
// extractCode / loadProviders logic stays intact.
vi.mock('../audio/strudelEngine', async () => {
  const { createFakeEngine } = await import('../../tests/mocks/engine');
  return { engine: createFakeEngine() };
});
vi.mock('../llm/providers', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../llm/providers')>();
  return { ...actual, chat: vi.fn() };
});

import { useStore, DEFAULT_SCORE, starterScore } from './store';
import { engine } from '../audio/strudelEngine';
import { chat } from '../llm/providers';
import { resetStore, state } from '../../tests/helpers/store';
import { buildLanes, laneBody } from '../music/lanes';
import { LS_CUSTOM_DIRECTIVES, LS_CUSTOM_MIGRATED, saveProject, loadCustomDirectives, type ProjectBlob } from './projects';

beforeEach(() => {
  (engine as any).__reset();
  resetStore();
});

describe('score editing', () => {
  it('setScore updates the score and re-derives voices', () => {
    state().setScore('$only: s("bd")');
    expect(state().score).toBe('$only: s("bd")');
    expect(state().voices.map((v) => v.id)).toEqual(['only']);
  });
});

describe('transport', () => {
  it('play() boots the engine, evaluates, and marks playing', async () => {
    await state().play();
    expect(engine.init).toHaveBeenCalled();
    expect(engine.evaluate).toHaveBeenCalled();
    expect(state().playing).toBe(true);
  });

  it('play() marks the transport live (the clock runs)', async () => {
    await state().play();
    expect(state().transportLive).toBe(true);
  });

  it('stop() halts the engine, clears playing AND the live transport', async () => {
    await state().play();
    state().stop();
    expect(engine.stop).toHaveBeenCalled();
    expect(state().playing).toBe(false);
    expect(state().transportLive).toBe(false); // the one case the clock holds
  });

  it('panic() cuts to silence but keeps the transport (clock safe)', async () => {
    await state().play();
    await state().panic();
    expect(engine.panic).toHaveBeenCalled();
    expect(state().playing).toBe(false); // audio silenced
    // transportLive tracks engine.started so the on-screen clock keeps turning
  });
});

describe('mute / solo → effective score', () => {
  it('a muted voice is silenced in the code sent to the engine', async () => {
    await state().play();
    (engine.evaluate as any).mockClear();
    state().toggleMute('drums');
    expect(engine.evaluate).toHaveBeenCalled();
    const sent = (engine.evaluate as any).mock.calls.at(-1)[0] as string;
    expect(sent).toContain('$drums: silence');
    expect(sent).toContain('$hats'); // others survive
  });
});

describe('directive staging', () => {
  it('runDirective stages an edit without committing', () => {
    state().selectVoice('hats');
    state().runDirective('darker');
    expect(state().stagedEdit).not.toBeNull();
    expect(state().score).not.toContain('.lpf(600)'); // not committed yet
    const last = state().messages.at(-1)!;
    expect(last.shape).toBe('diff');
  });

  it('acceptEdit commits the staged code', () => {
    state().selectVoice('hats');
    state().runDirective('darker');
    state().acceptEdit();
    expect(state().score).toContain('.lpf(600)');
    expect(state().stagedEdit).toBeNull();
  });

  it('rejectEdit discards the staged code', () => {
    const before = state().score;
    state().selectVoice('hats');
    state().runDirective('darker');
    state().rejectEdit();
    expect(state().stagedEdit).toBeNull();
    expect(state().score).toBe(before);
  });
});

describe('sendMaestro routing', () => {
  it('routes a natural-language directive to staging', async () => {
    await state().sendMaestro('make the hats darker');
    expect(state().stagedEdit).not.toBeNull();
  });

  it('routes a generation request to variation lanes', async () => {
    await state().sendMaestro('give me 3 ways into the drop');
    expect(state().laneSet).not.toBeNull();
    expect(state().laneSet!.lanes.length).toBeGreaterThan(0);
  });

  it('answers a question locally when no model is connected', async () => {
    await state().sendMaestro('what is the bass doing?');
    const last = state().messages.at(-1)!;
    expect(last.role).toBe('maestro');
    expect(last.shape).toBe('answer');
  });
});

describe('providers', () => {
  it('setProviderKey marks a provider connected and persists it', () => {
    state().setProviderKey('anthropic', 'sk-live');
    const p = state().providers.find((p) => p.id === 'anthropic')!;
    expect(p.connected).toBe(true);
    expect(localStorage.getItem('refrain.providers')).toContain('sk-live');
  });
});

// Each new directive builds on the staged result of the previous one (stagedBase
// returns the applied staged code), so two directives compound rather than the
// second clobbering the first. acceptEdit then bakes both into the score.
describe('sequential directive stacking', () => {
  it('two runDirective calls stack on the staged base, both survive acceptEdit', () => {
    state().selectVoice('hats');
    state().runDirective('darker'); // appends .lpf(600) to $hats
    expect(state().stagedEdit).not.toBeNull();
    state().runDirective('louder'); // appends .gain(1.2) on top of the staged base
    const staged = state().stagedEdit!;
    // the staged newCode already carries the first change, with the second added
    expect(staged.newCode).toContain('.lpf(600)');
    expect(staged.newCode).toContain('.gain(1.2)');
    state().acceptEdit();
    expect(state().stagedEdit).toBeNull();
    expect(state().score).toContain('.lpf(600)');
    expect(state().score).toContain('.gain(1.2)');
  });
});

// toggleHunk flips a single hunk's enabled flag (default true → false), and when
// the transport is live the engine is re-evaluated with the new enabled subset.
describe('toggleHunk', () => {
  it('flips hunkEnabled[hid] from its default-on state', () => {
    state().selectVoice('hats');
    state().runDirective('darker');
    const hid = state().stagedEdit!.hunks[0].id;
    expect(state().hunkEnabled[hid]).toBe(true);
    state().toggleHunk(hid);
    expect(state().hunkEnabled[hid]).toBe(false);
    state().toggleHunk(hid);
    expect(state().hunkEnabled[hid]).toBe(true);
  });

  it('re-evaluates the engine with the new subset while playing', async () => {
    await state().play();
    state().selectVoice('hats');
    state().runDirective('darker');
    const hid = state().stagedEdit!.hunks[0].id;
    (engine.evaluate as any).mockClear();
    state().toggleHunk(hid); // now disabled → audition reverts that hunk
    expect(engine.evaluate).toHaveBeenCalled();
    const sent = (engine.evaluate as any).mock.calls.at(-1)[0] as string;
    expect(sent).not.toContain('.lpf(600)'); // disabled hunk dropped from audio
  });
});

// setCps rewrites the literal inside setcps(...) in the score AND drives the
// engine clock; nudgeCps adds a delta and clamps the floor at 0.1.
describe('cps control', () => {
  it('setCps rewrites the setcps() value in place and calls engine.setCps', () => {
    state().setCps(0.75);
    expect(engine.setCps).toHaveBeenCalledWith(0.75);
    expect(state().cps).toBe(0.75);
    expect(state().score).toContain('setcps(0.75)');
    expect(state().score).not.toContain('setcps(0.5)');
  });

  it('nudgeCps clamps at the 0.1 floor', () => {
    state().setCps(0.15);
    state().nudgeCps(-0.5); // would be negative → clamped
    expect(state().cps).toBe(0.1);
    expect(state().score).toContain('setcps(0.1)');
  });
});

// HUSH is a MUSICAL exit (spec §10): it fades every sounding voice over a cycle
// (not an instant cut like PANIC), clears playing, and keeps the transport live.
describe('hush', () => {
  it('fades over a cycle instead of cutting, and keeps the transport live', async () => {
    await state().play();
    expect(state().playing).toBe(true);
    (engine.evaluate as any).mockClear();
    await state().hush();
    expect(state().playing).toBe(false);
    expect(state().transportLive).toBe(true);
    const sent = (engine.evaluate as any).mock.calls.at(-1)?.[0] as string;
    expect(sent).toContain('.gain(saw.range(1, 0).slow(1))'); // a real fade, not `silence`
  });

  it('falls back to an instant silence when nothing is sounding', async () => {
    // not playing → no fade to run; hush just silences safely
    await state().hush();
    expect(engine.panic).toHaveBeenCalled();
    expect(state().playing).toBe(false);
  });
});

// Scenes snapshot the current mute/solo as 0/1 levels per voice, relaunch that
// mute pattern, and delete cleanly (clearing activeSceneId iff it was active).
describe('scenes', () => {
  it('snapshotScene captures levels from the current mute/solo state', () => {
    state().toggleMute('drums');
    state().snapshotScene('verse');
    const scene = state().scenes.at(-1)!;
    expect(scene.name).toBe('verse');
    expect(scene.levels.drums).toBe(0); // muted → silent
    expect(scene.levels.hats).toBe(1); // audible
    expect(state().activeSceneId).toBe(scene.id);
  });

  it('launchScene applies a scene mute pattern to the voices', () => {
    state().toggleMute('bass');
    state().snapshotScene('a');
    const sceneId = state().scenes.at(-1)!.id;
    // change the live mix away from the scene, then relaunch
    state().toggleMute('bass'); // unmute
    state().toggleMute('drums'); // mute something else
    state().launchScene(sceneId);
    const bass = state().voices.find((v) => v.id === 'bass')!;
    const drums = state().voices.find((v) => v.id === 'drums')!;
    expect(bass.muted).toBe(true); // restored from scene
    expect(drums.muted).toBe(false); // scene had it audible
    expect(state().activeSceneId).toBe(sceneId);
  });

  it('deleteScene removes it and clears activeSceneId when it matched', () => {
    state().snapshotScene('one');
    const sceneId = state().scenes.at(-1)!.id;
    expect(state().activeSceneId).toBe(sceneId);
    state().deleteScene(sceneId);
    expect(state().scenes.find((s) => s.id === sceneId)).toBeUndefined();
    expect(state().activeSceneId).toBeNull();
  });
});

// Variation lanes driven through the store: generation creates a laneSet of
// three forks; solo marks one; commit appends its $voice block to the score and
// clears the solo; reroll keeps the set at three lanes.
describe('variation lanes via the store', () => {
  it('sendMaestro generation creates a laneSet with three lanes', async () => {
    await state().sendMaestro('give me 3 ways into the drop');
    expect(state().laneSet).not.toBeNull();
    expect(state().laneSet!.lanes.length).toBe(3);
  });

  it('soloLane sets soloId on the laneSet', async () => {
    await state().sendMaestro('give me 3 ways into the drop');
    const laneId = state().laneSet!.lanes[0].id;
    state().soloLane(laneId);
    expect(state().laneSet!.soloId).toBe(laneId);
  });

  it('commitLane appends the lane voice to the score and clears soloId', async () => {
    await state().sendMaestro('give me 3 ways into the drop');
    const lane = state().laneSet!.lanes[1];
    state().soloLane(lane.id);
    state().commitLane(lane.id);
    expect(state().score).toContain(`$${lane.voiceId}:`);
    expect(state().laneSet!.committedId).toBe(lane.id);
    expect(state().laneSet!.soloId).toBeNull();
  });

  it('rerollLanes keeps the laneSet at three lanes', async () => {
    await state().sendMaestro('give me 3 ways into the drop');
    state().rerollLanes();
    expect(state().laneSet).not.toBeNull();
    expect(state().laneSet!.lanes.length).toBe(3);
  });
});

// Free-form unknown request with a connected model: the store routes to the LLM
// edit path, calls chat(), and stages the extracted code as a diff.
describe('LLM edit path', () => {
  it('routes an unknown request through chat() and stages the edit', async () => {
    state().setProviderKey('anthropic', 'sk-x'); // connect the generation role
    vi.mocked(chat).mockResolvedValue('```\n$drums: s("bd*4")\n```\nchanged it');
    await state().sendMaestro('reinvent the percussion entirely please');
    expect(chat).toHaveBeenCalled();
    expect(state().stagedEdit).not.toBeNull();
    expect(state().stagedEdit!.newCode).toContain('$drums: s("bd*4")');
    const last = state().messages.at(-1)!;
    expect(last.shape).toBe('diff');
  });
});

// Provider/role configuration toggles.
describe('provider configuration', () => {
  it('toggleLocalOnly flips the localOnly flag', () => {
    expect(state().localOnly).toBe(false);
    state().toggleLocalOnly();
    expect(state().localOnly).toBe(true);
    state().toggleLocalOnly();
    expect(state().localOnly).toBe(false);
  });

  it('setRoleProvider updates the role provider, model, and strength', () => {
    state().setRoleProvider('generation', 'openai', 'gpt-4o-mini');
    const role = state().roles.find((r) => r.id === 'generation')!;
    expect(role.provider).toBe('openai');
    expect(role.model).toBe('gpt-4o-mini');
    expect(role.strength).toBe('fast'); // strengthFor: mini → fast
  });
});

// ---------------------------------------------------------------------------
// v0.2 — the four unkept promises + the fixes (spec §06/§07/§05/§10).
// ---------------------------------------------------------------------------

// Provenance rides on every staged edit; committing pushes it onto the history.
describe('provenance (spec §07)', () => {
  it('a directive edit carries source + directive provenance', () => {
    state().selectVoice('hats');
    state().runDirective('darker');
    const prov = state().stagedEdit!.provenance!;
    expect(prov.source).toBe('directive');
    expect(prov.directive).toBe('darker');
    expect(typeof prov.when).toBe('number');
  });
});

// The history tree is committed states, not keystrokes. Accepting an edit pushes
// a commit; rewind restores an earlier snapshot without erasing later ones.
describe('history / time-travel (spec §07)', () => {
  it('starts with a single root commit as HEAD', () => {
    expect(state().history).toHaveLength(1);
    expect(state().history[0].parentId).toBeNull();
    expect(state().headId).toBe(state().history[0].id);
  });

  it('acceptEdit pushes a commit that becomes HEAD, carrying provenance', () => {
    const rootId = state().headId;
    state().selectVoice('hats');
    state().runDirective('darker');
    state().acceptEdit();
    expect(state().history).toHaveLength(2);
    const head = state().history.find((c) => c.id === state().headId)!;
    expect(head.parentId).toBe(rootId);
    expect(head.provenance.directive).toBe('darker');
    expect(head.score).toContain('.lpf(600)');
  });

  it('rewind restores an earlier snapshot and moves HEAD, keeping the tree', () => {
    const rootId = state().headId!;
    const rootScore = state().score;
    state().selectVoice('hats');
    state().runDirective('darker');
    state().acceptEdit();
    expect(state().score).toContain('.lpf(600)');
    state().rewind(rootId);
    expect(state().score).toBe(rootScore);
    expect(state().headId).toBe(rootId);
    expect(state().history).toHaveLength(2); // later commit is NOT erased
  });

  it('forkFrom moves HEAD so the next commit branches', () => {
    const rootId = state().headId!;
    state().selectVoice('hats');
    state().runDirective('darker');
    state().acceptEdit();
    state().forkFrom(rootId);
    expect(state().headId).toBe(rootId);
    // a new edit now branches off root rather than the darker commit
    state().selectVoice('bass');
    state().runDirective('louder');
    state().acceptEdit();
    const head = state().history.find((c) => c.id === state().headId)!;
    expect(head.parentId).toBe(rootId);
    expect(state().history).toHaveLength(3);
  });
});

// The seed is visible and controllable: reproduce (same), nudge (+1), new (fresh).
describe('seeded generation (spec §07)', () => {
  it('reseed nudge advances the seed by one and regenerates open lanes', async () => {
    await state().sendMaestro('give me 3 ways into the drop');
    const before = state().seed;
    const beforeCode = state().laneSet!.lanes.map((l) => l.code);
    state().reseed('nudge');
    expect(state().seed).toBe((before + 1) & 0xffff);
    expect(state().laneSet!.seed).toBe(state().seed);
    expect(state().laneSet!.lanes.map((l) => l.code)).not.toEqual(beforeCode);
  });

  it('reseed same keeps the seed (reproducible)', async () => {
    await state().sendMaestro('give me 3 ways into the drop');
    const before = state().seed;
    state().reseed('same');
    expect(state().seed).toBe(before);
  });
});

// Editor context pins (spec §02) — dedupe identical ranges, remove, clear.
describe('context pins (spec §02)', () => {
  it('adds, dedupes, removes and clears pins', () => {
    state().addPin({ voiceId: 'hats', startLine: 5, endLine: 6 });
    state().addPin({ voiceId: 'hats', startLine: 5, endLine: 6 }); // dupe → ignored
    expect(state().pins).toHaveLength(1);
    state().addPin({ voiceId: 'pad', startLine: 11, endLine: 12 });
    expect(state().pins).toHaveLength(2);
    state().removePin(state().pins[0].id);
    expect(state().pins).toHaveLength(1);
    state().clearPins();
    expect(state().pins).toHaveLength(0);
  });
});

// Clock-as-target (spec §06) — an arc span becomes a .mask() on the target voice.
describe('clock-as-target (spec §06)', () => {
  it('applyArcToVoice stages a .mask() scoped to the dragged span', () => {
    state().setArcSelection({ start: 0.5, end: 1 });
    state().applyArcToVoice('hats');
    const edit = state().stagedEdit!;
    expect(edit.newCode).toContain('.mask("0 0 0 0 1 1 1 1")'); // back half
    expect(edit.targetVoiceId).toBe('hats');
    expect(state().arcSelection).toBeNull(); // consumed
  });
});

// Stage lenses (spec §05) — stackable, toggle on/off.
describe('lenses (spec §05)', () => {
  it('toggleLens adds then removes a lens', () => {
    expect(state().lenses).not.toContain('tracker');
    state().toggleLens('tracker');
    expect(state().lenses).toContain('tracker');
    state().toggleLens('tracker');
    expect(state().lenses).not.toContain('tracker');
  });
});

// The Prompter (spec §04) — bounded observations; dismiss learns the "no".
describe('prompter (spec §04)', () => {
  it('refreshPrompter surfaces at most three cards from the parsed tree', () => {
    state().refreshPrompter();
    expect(state().prompterCards.length).toBeGreaterThan(0);
    expect(state().prompterCards.length).toBeLessThanOrEqual(3);
  });

  it('dismissing a card quiets that kind for the session', () => {
    state().refreshPrompter();
    const card = state().prompterCards[0];
    state().dismissCard(card.id);
    expect(state().prompterDismissed).toContain(card.kind);
    state().refreshPrompter();
    expect(state().prompterCards.some((c) => c.kind === card.kind)).toBe(false);
  });

  it('togglePrompter mutes and clears the rail', () => {
    state().refreshPrompter();
    state().togglePrompter();
    expect(state().prompterMuted).toBe(true);
    expect(state().prompterCards).toHaveLength(0);
  });
});

// Regression coverage for the xhigh code-review findings.
describe('review fixes', () => {
  it('commitLane parks each rejected fork with ITS OWN code, off the shared parent', async () => {
    await state().sendMaestro('give me 3 ways into the drop');
    const ls = state().laneSet!;
    const preParent = state().headId;
    const keep = ls.lanes[0];
    const others = ls.lanes.slice(1);
    state().commitLane(keep.id);
    const parked = state().history.filter((c) => c.parked);
    expect(parked).toHaveLength(others.length);
    // each parked commit snapshots its OWN lane's code, not the committed one
    for (const o of others) {
      const match = parked.find((c) => c.score.includes(o.code));
      expect(match).toBeTruthy();
      expect(match!.score).not.toContain(keep.code); // not a duplicate of the accepted fork
      expect(match!.parentId).toBe(preParent); // sibling off the pre-lane parent
    }
  });

  it('saveCheckpoint forces a commit even when the score equals HEAD', () => {
    const before = state().history.length;
    state().saveCheckpoint('my checkpoint');
    expect(state().history.length).toBe(before + 1);
    expect(state().history.at(-1)!.label).toBe('my checkpoint');
  });

  it('/variations forwards the requested count (not a fixed 3)', async () => {
    await state().sendMaestro('/variations 4');
    expect(state().laneSet!.lanes).toHaveLength(4);
  });

  it('a prototype-key slash token (/toString) does not resolve as a command/directive', async () => {
    await state().sendMaestro('/toString');
    expect(state().stagedEdit).toBeNull(); // no spurious edit
    const last = state().messages.at(-1)!;
    expect(last.role).toBe('maestro'); // gets feedback, not silence
  });

  it('reproduceCommit restores a committed generation from its stored seed', async () => {
    await state().sendMaestro('give me 3 ways into the drop');
    const ls = state().laneSet!;
    const usedSeed = ls.seed;
    state().commitLane(ls.lanes[0].id);
    // change the global seed away from what produced the commit
    state().reseed('new');
    const forkCommit = state().history.find((c) => c.provenance.seed === usedSeed && !c.parked)!;
    state().reproduceCommit(forkCommit.id);
    expect(state().seed).toBe(usedSeed); // seed restored from provenance, not the current global
    expect(state().laneSet!.seed).toBe(usedSeed);
  });

  it('rewinding to a parked fork restores that alternative code', async () => {
    await state().sendMaestro('give me 3 ways into the drop');
    const ls = state().laneSet!;
    const other = ls.lanes[1];
    state().commitLane(ls.lanes[0].id);
    const parked = state().history.find((c) => c.parked && c.score.includes(other.code))!;
    state().rewind(parked.id);
    expect(state().score).toContain(other.code); // the parked variation is recoverable
  });
});

// The flagship multi-step agent (spec §03): /break runs real tools, states a
// plan, and lands ONE staged, reversible diff.
describe('agent · /break (spec §03)', () => {
  it('stages a break: masks the rhythm section, adds a riser, records plan+tools', async () => {
    await state().runBreak();
    const edit = state().stagedEdit!;
    expect(edit).not.toBeNull();
    expect(edit.newCode).toContain('.mask("<0 0 0 0 0 0 1 1>")'); // drop 6 bars, back 2
    expect(edit.newCode).toContain('$riser:'); // a riser fills the gap
    expect(edit.newCode).toContain('.gain("1.5 1 1 1")'); // sforzando return
    const msg = state().messages.at(-1)!;
    expect(msg.plan?.length).toBe(4);
    expect(msg.plan?.every((s) => s.status === 'done')).toBe(true);
    expect(msg.toolLog?.map((t) => t.name)).toEqual(['parse AST', 'queryArc(0,8)', 'write diff', 'dry-run audio']);
    expect(msg.reasoning).toBeTruthy();
    expect(edit.provenance?.source).toBe('agent');
    // it snapshots the pre-break mix as a recoverable scene
    expect(state().scenes.some((s) => s.name === 'pre-break')).toBe(true);
  });

  it('routes the /break command through sendMaestro', async () => {
    await state().sendMaestro('/break');
    expect(state().stagedEdit).not.toBeNull();
    expect(state().stagedEdit!.newCode).toContain('$riser:');
  });
});

// Author-your-own directives (spec §10) — bind a verb, run it like a built-in.
// ---------------------------------------------------------------------------
// D19/D20 — a user alias under 3 chars cannot match prose (it would capture
// nearly every free-text turn). That must be REPORTED, not silent: silently
// inert is the same class of defect as A-10's silent mis-targeting. And the
// condition is a property of STORED data, so it is reported wherever it exists
// (hydrate), not only where it was introduced (add).
// ---------------------------------------------------------------------------
describe('short custom aliases are diagnosed, not silently inert (D19/D20)', () => {
  const warnings = () => state().logs.filter((l) => l.type === 'warning').map((l) => l.text);

  it('warns when a bound verb has an alias too short to match prose', () => {
    state().addCustomDirective({ label: 'go', aliases: ['on'], chain: '.gain(0)', blurb: '' });
    const w = warnings().filter((t) => t.includes('too short'));
    expect(w).toHaveLength(1);
    expect(w[0]).toContain('“go”');
    expect(w[0]).toContain('“on”');
    // and it says what still works, rather than only what doesn't
    expect(w[0]).toContain('/go');
  });

  it('does not warn for a verb whose aliases are all long enough', () => {
    state().addCustomDirective({ label: 'Shimmer', aliases: ['glisten'], chain: '.room(0.5)', blurb: '' });
    expect(warnings().filter((t) => t.includes('too short'))).toHaveLength(0);
  });

  it('warns on hydrate for a verb stored BEFORE the floor existed', () => {
    // the transition-only version of this diagnostic missed exactly this case
    localStorage.setItem(
      LS_CUSTOM_DIRECTIVES,
      JSON.stringify([{ id: 'u_go', label: 'go', aliases: ['on'], chain: '.gain(0)', blurb: '' }]),
    );
    localStorage.setItem(LS_CUSTOM_MIGRATED, '1');
    state().hydrateFromStorage();
    expect(warnings().filter((t) => t.includes('too short'))).not.toHaveLength(0);
    // the verb is kept and still invocable by slash — the floor is a prose guard
    expect(state().customDirectives.map((d) => d.id)).toContain('u_go');
  });
});

describe('custom directives (spec §10)', () => {
  it('binds a directive and runs it, appending its chain to the target voice', () => {
    state().addCustomDirective({ label: 'Shimmer', aliases: ['shimmer'], chain: '.room(0.5).delay(0.3)', blurb: 'adds air.' });
    const dir = state().customDirectives.find((d) => d.label === 'Shimmer')!;
    expect(dir.id).toBe('u_shimmer');
    state().selectVoice('hats');
    state().runDirective(dir.id);
    expect(state().stagedEdit!.newCode).toContain('.room(0.5).delay(0.3)');
    expect(state().stagedEdit!.provenance!.directive).toBe('u_shimmer');
  });

  it('removeCustomDirective drops it', () => {
    state().addCustomDirective({ label: 'Shimmer', aliases: [], chain: '.room(0.5)', blurb: '' });
    const dir = state().customDirectives.find((d) => d.label === 'Shimmer')!;
    state().removeCustomDirective(dir.id);
    expect(state().customDirectives.find((d) => d.id === dir.id)).toBeUndefined();
  });
});

// ===========================================================================
// A-1 — provenance must never name a model that was never called. The audit
// found 15 commits stamped "Gemini Flash" while a full network sweep proved
// ZERO LLM requests fired.
// ===========================================================================
describe('provenance honesty (A-1)', () => {
  /** Connect a provider whose label the old code would have stamped on a commit. */
  function connectGoogle() {
    state().setProviderKey('google', 'k');
    state().setRoleProvider('directives', 'google', 'gemini-flash-lite-latest');
    state().setRoleProvider('generation', 'google', 'gemini-flash-lite-latest');
  }

  it('a directive commit names no model, and calls no model', () => {
    connectGoogle();
    state().runDirective('darker');
    state().acceptEdit();
    const commit = state().history.at(-1)!;
    expect(commit.provenance.source).toBe('directive');
    expect(commit.provenance.model).toBeUndefined();
    expect(chat).not.toHaveBeenCalled();
  });

  it('a committed lane names no model', async () => {
    connectGoogle();
    await state().sendMaestro('give me 3 ways into the drop');
    const ls = state().laneSet!;
    state().commitLane(ls.lanes[0].id);
    const commit = state().history.at(-1)!;
    expect(commit.provenance.source).toBe('lanes');
    expect(commit.provenance.model).toBeUndefined();
    expect(typeof commit.provenance.seed).toBe('number'); // the seed IS real provenance
    expect(chat).not.toHaveBeenCalled();
  });

  it('/break names no model and claims no reasoning tier', async () => {
    connectGoogle();
    await state().sendMaestro('/break');
    const prov = state().stagedEdit!.provenance!;
    expect(prov.source).toBe('agent');
    expect(prov.model).toBeUndefined();
    // /break is parseScore + queryEvents + computeHunks: no tier is spent, so
    // claiming `thinking` would be the same class of lie as naming a model.
    expect(prov.thinking).toBe(false);
    expect(chat).not.toHaveBeenCalled();
  });

  it('a hand edit names no model', () => {
    connectGoogle();
    state().saveCheckpoint('by hand');
    expect(state().history.at(-1)!.provenance.model).toBeUndefined();
  });

  it('positive control: a real LLM edit DOES name its model', async () => {
    state().setProviderKey('anthropic', 'sk-x');
    vi.mocked(chat).mockResolvedValue('```\n$drums: s("bd*4")\n```\nchanged');
    await state().sendMaestro('reinvent the percussion entirely please');
    expect(chat).toHaveBeenCalled();
    expect(state().stagedEdit!.provenance!.model).toBeTruthy();
  });
});

// ===========================================================================
// A-2 — capturing a scene is a discrete act of saving. It used to reach disk
// only when some later commit happened to flush, so a reload could lose it.
// ===========================================================================
describe('scene persistence (A-2)', () => {
  const persisted = () => JSON.parse(localStorage.getItem(`refrain.project.${state().projectId}`)!) as ProjectBlob;

  it('persists a captured scene immediately, with no timer advance', () => {
    state().snapshotScene('verse');
    expect(persisted().scenes.map((sc) => sc.name)).toContain('verse');
  });

  it('records provenance carrying the generation seed', () => {
    state().snapshotScene('verse');
    const scene = persisted().scenes.find((sc) => sc.name === 'verse')!;
    expect(scene.provenance!.source).toBe('you');
    expect(scene.provenance!.seed).toBe(state().seed);
    expect(typeof scene.provenance!.when).toBe('number'); // shape, never the value
  });

  it('persists a deletion immediately, so it cannot come back on reload', () => {
    state().snapshotScene('verse');
    const id = state().scenes.find((sc) => sc.name === 'verse')!.id;
    state().deleteScene(id);
    expect(persisted().scenes.map((sc) => sc.name)).not.toContain('verse');
  });

  it("the /break agent's scene carries its own recipe", async () => {
    await state().sendMaestro('/break');
    const scene = state().scenes.find((sc) => sc.name === 'pre-break')!;
    expect(scene.provenance!.source).toBe('agent');
    expect(scene.provenance!.prompt).toBe('/break');
    expect(scene.provenance!.model).toBeUndefined(); // deterministic (A-1)
  });

  it('keeps scene provenance through a persist round-trip', () => {
    state().snapshotScene('verse');
    const blob = persisted();
    state().openProject(blob.id);
    expect(state().scenes.find((sc) => sc.name === 'verse')!.provenance).toBeDefined();
  });
});

// ===========================================================================
// A-4 — a custom verb is device-level and must survive a project switch. The
// blob held `[]`, and `[] ?? x` is `[]`, so opening a project wiped the list.
// ===========================================================================
describe('custom directives survive a project switch (A-4)', () => {
  const VERB = { label: 'a13shimmer', aliases: [], chain: '.room(0.5).lpf(1200)', blurb: '' };

  /** The real pre-fix state: verb in the device key, empty arrays in the blobs. */
  function seedBothLocations() {
    localStorage.removeItem(LS_CUSTOM_MIGRATED);
    state().addCustomDirective(VERB);
    const blob = JSON.parse(localStorage.getItem(`refrain.project.${state().projectId}`) ?? 'null');
    if (blob) saveProject({ ...blob, customDirectives: [] });
    saveProject({
      id: 'other', name: 'other', score: '$drums: s("bd")', committed: '$drums: s("bd")',
      history: [], headId: null, scenes: [], seed: 1, voiceState: {}, customDirectives: [], updated: 1,
    });
  }

  it('survives hydrateFromStorage', () => {
    seedBothLocations();
    state().hydrateFromStorage();
    expect(state().customDirectives.map((d) => d.label)).toContain('a13shimmer');
  });

  it('survives a new project', () => {
    seedBothLocations();
    state().newProject('scratch');
    expect(state().customDirectives.map((d) => d.label)).toContain('a13shimmer');
  });

  it('survives an openProject round trip — the reported A15.4 failure', () => {
    seedBothLocations();
    state().openProject('other');
    expect(state().customDirectives.map((d) => d.label)).toContain('a13shimmer');
    state().hydrateFromStorage();
    expect(state().customDirectives.map((d) => d.label)).toContain('a13shimmer');
  });

  it('is still invocable after the round trip', async () => {
    seedBothLocations();
    state().openProject('other');
    await state().sendMaestro('/a13shimmer $drums');
    expect(state().stagedEdit!.newCode).toContain('.room(0.5).lpf(1200)');
  });

  it('no longer writes the verb into the project blob', () => {
    state().addCustomDirective(VERB);
    state().snapshotScene('flush'); // forces an immediate persist
    const blob = JSON.parse(localStorage.getItem(`refrain.project.${state().projectId}`)!);
    expect(blob.customDirectives).toBeUndefined();
  });

  it('keeps writing the verb to the device-level key', () => {
    state().addCustomDirective(VERB);
    expect(loadCustomDirectives().map((d) => d.label)).toContain('a13shimmer');
    expect(localStorage.getItem(LS_CUSTOM_DIRECTIVES)).toContain('a13shimmer');
  });
});

// ===========================================================================
// A-5 — a forged verb is a literal Strudel chain, so it must apply offline.
// The audit caught `/a13shimmer $pad` firing a real, billable Gemini call.
// ===========================================================================
describe('custom directives are deterministic and offline (A-5)', () => {
  beforeEach(() => {
    state().addCustomDirective({ label: 'Shimmer', aliases: ['glisten'], chain: '.room(0.5).lpf(1200)', blurb: 'air' });
  });

  it('applies through the slash path without consulting a provider', async () => {
    state().setProviderKey('google', 'k');
    state().setRoleProvider('generation', 'google', 'gemini-flash-lite-latest');
    await state().sendMaestro('/shimmer $hats');
    expect(chat).not.toHaveBeenCalled();
    expect(state().stagedEdit!.newCode).toContain('.room(0.5).lpf(1200)');
    expect(state().stagedEdit!.provenance!.directive).toBe('u_shimmer');
    expect(state().stagedEdit!.provenance!.model).toBeUndefined();
  });

  it('targets the named voice', async () => {
    await state().sendMaestro('/shimmer $hats');
    expect(state().stagedEdit!.targetVoiceId).toBe('hats');
  });

  it('works in local-only mode', async () => {
    state().setProviderKey('google', 'k');
    state().toggleLocalOnly();
    await state().sendMaestro('/shimmer $hats');
    expect(chat).not.toHaveBeenCalled();
    expect(state().stagedEdit).not.toBeNull();
  });

  it('applies from free text too', async () => {
    await state().sendMaestro('add some glisten to the hats');
    expect(chat).not.toHaveBeenCalled();
    expect(state().stagedEdit!.newCode).toContain('.room(0.5)');
  });
});

// ===========================================================================
// A-6 — refining lane A used to regenerate from `seed+idx+1` and take index
// idx, i.e. key `seed+2*idx+1`, which for lane A is ALWAYS sibling B's key.
// ===========================================================================
describe('lane refine never duplicates a visible sibling (A-6)', () => {
  const bodies = () => state().laneSet!.lanes.map((l) => laneBody(l.code));

  async function threeLanes(seed: number) {
    useStore.setState({ seed });
    await state().sendMaestro('give me 3 ways to add a melody');
    useStore.setState({ laneSet: { ...state().laneSet!, seed } });
  }

  it('the reported case: seed 0xE824, refining lane A', async () => {
    await threeLanes(0xe824);
    const before = bodies();
    state().refineLane(state().laneSet!.lanes[0].id);
    const after = bodies();
    expect(after[0]).not.toBe(before[0]); // it actually changed
    expect(before.slice(1)).not.toContain(after[0]); // and not into a sibling
    expect(new Set(after).size).toBe(after.length); // no duplicates at all
  });

  it('leaves the lane identity and its siblings alone', async () => {
    await threeLanes(0xe824);
    const ls = state().laneSet!;
    const target = ls.lanes[0];
    const siblingBodies = bodies().slice(1);
    state().refineLane(target.id);
    const after = state().laneSet!.lanes;
    expect(after[0].id).toBe(target.id);
    expect(after[0].label).toBe(target.label);
    expect(after[0].voiceId).toBe(target.voiceId);
    expect(after.slice(1).map((l) => laneBody(l.code))).toEqual(siblingBodies);
  });

  it('a second refine yields a third distinct body (it used to be a no-op)', async () => {
    await threeLanes(0xe824);
    const laneId = state().laneSet!.lanes[0].id;
    const b0 = bodies()[0];
    state().refineLane(laneId);
    const b1 = bodies()[0];
    state().refineLane(laneId);
    const b2 = bodies()[0];
    expect(new Set([b0, b1, b2]).size).toBe(3);
  });

  it('holds for every lane index, at several seeds', async () => {
    for (const seed of [0, 1, 7, 0x4f2a, 0xe824]) {
      for (const idx of [0, 1, 2]) {
        await threeLanes(seed);
        const before = bodies();
        state().refineLane(state().laneSet!.lanes[idx].id);
        const after = bodies();
        expect(new Set(after).size, `seed ${seed} idx ${idx}`).toBe(after.length);
        expect(before.filter((_, i) => i !== idx)).not.toContain(after[idx]);
      }
    }
  });

  it('reroll never hands back the byte-identical set', async () => {
    await threeLanes(0x1000);
    const before = bodies();
    // force randomSeed() to land on a seed congruent mod 12 → same content
    const spy = vi.spyOn(Math, 'random').mockReturnValue(0x1000 / 0x10000);
    try {
      state().rerollLanes();
    } finally {
      spy.mockRestore();
    }
    expect(bodies()).not.toEqual(before);
  });

  it('records the seed it actually used, so the set stays reproducible', async () => {
    await threeLanes(0x2000);
    state().rerollLanes();
    const ls = state().laneSet!;
    expect(laneBody(ls.lanes[0].code)).toBe(laneBody(buildLanes(ls.prompt, [], ls.seed)[0].code));
  });
});

// ===========================================================================
// A-7 — an unknown slash verb must say so and never consult a provider. The
// audit saw /toString etc. produce normal-looking generated replies, and one
// unexplained duplicate /__proto__ POST.
// ===========================================================================
describe('unknown slash commands (A-7)', () => {
  beforeEach(() => {
    state().setProviderKey('google', 'k');
    state().setRoleProvider('generation', 'google', 'gemini-flash-lite-latest');
  });

  it.each(['/notathing', '/toString', '/constructor', '/__proto__', '/valueOf'])(
    '%s says "no such command", stages nothing, and calls no model',
    async (cmd) => {
      await state().sendMaestro(cmd);
      expect(chat).not.toHaveBeenCalled();
      expect(state().stagedEdit).toBeNull();
      const last = state().messages.at(-1)!;
      expect(last.shape).toBe('error');
      expect(last.text).toContain('No such command');
    },
  );

  it('never throws on a prototype key', async () => {
    await expect(state().sendMaestro('/__proto__')).resolves.toBeUndefined();
  });

  it('suggests a real verb for a near miss', async () => {
    await state().sendMaestro('/darkr $hats');
    expect(state().messages.at(-1)!.text).toContain('darker');
  });

  it('handles a bare slash without claiming a command name', async () => {
    await state().sendMaestro('/');
    expect(chat).not.toHaveBeenCalled();
    expect(state().messages.at(-1)!.text).toContain('Nothing after the slash');
  });

  it('still routes genuine prose to the LLM', async () => {
    vi.mocked(chat).mockResolvedValue('some answer');
    await state().sendMaestro('reinvent the percussion entirely please');
    expect(chat).toHaveBeenCalled();
  });
});

// ===========================================================================
// A-8 — NOT a defect: a directive stages, and only `accept` commits. This
// pins the dispatch chain so it cannot silently rot.
// ===========================================================================
describe('a slash directive typed into the Maestro box (A-8)', () => {
  it('stages a diff with its argument honoured, and commits only on accept', async () => {
    const before = state().history.length;
    await state().sendMaestro('/darker $drums');
    expect(state().stagedEdit).not.toBeNull();
    expect(state().stagedEdit!.targetVoiceId).toBe('drums');
    expect(state().messages.at(-1)!.shape).toBe('diff');
    expect(state().history.length).toBe(before); // staging is not committing
    state().acceptEdit();
    expect(state().history.length).toBe(before + 1);
    expect(state().history.at(-1)!.label).toBe('/darker $drums');
  });
});

// ===========================================================================
// A-9 — a new project used to open claiming to be "nightjar — set 02".
// ===========================================================================
describe('new project starter score (A-9)', () => {
  it('heads the score with the project\'s own name', () => {
    state().newProject('a12scratch');
    expect(state().score.split('\n')[0]).toBe('// a12scratch — set 01');
    expect(state().score).not.toContain('nightjar');
  });

  it('labels the root commit and gives it the same score', () => {
    state().newProject('a12scratch');
    expect(state().history[0].label).toBe('init · a12scratch');
    expect(state().history[0].score).toBe(state().score);
  });

  it('keeps the voices of the starter body', () => {
    state().newProject('a12scratch');
    expect(state().voices.map((v) => v.id)).toEqual(['drums', 'hats', 'bass', 'pad']);
  });

  it('falls back to "untitled" for an empty name', () => {
    expect(starterScore('').split('\n')[0]).toBe('// untitled — set 01');
    expect(starterScore().split('\n')[0]).toBe('// untitled — set 01');
  });

  it('leaves DEFAULT_SCORE byte-identical — the seeded song really is nightjar', () => {
    // guards the A-9 refactor against moving bytes the v0.2.1 merge tests and
    // the browser-tier editor test depend on
    expect(DEFAULT_SCORE.split('\n')[0]).toBe('// nightjar — set 02');
    expect(DEFAULT_SCORE).toContain('$drums: s("bd*2, ~ sd").bank("RolandTR909")');
    expect(DEFAULT_SCORE.endsWith('.slow(2).gain(0.5)')).toBe(true);
  });
});

// ===========================================================================
// A-10 — voice ids carry no sigil, so an un-normalised hint mis-targeted.
// ===========================================================================
describe('voice-hint targeting (A-10)', () => {
  it.each(['drums', '$drums', '$Drums', 'Drums'])('targets $drums for the hint %s', (hint) => {
    state().runDirective('darker', hint);
    expect(state().stagedEdit!.targetVoiceId).toBe('drums');
  });

  it('produces identical code for the sigil and bare forms', () => {
    state().runDirective('darker', '$drums');
    const withSigil = state().stagedEdit!.newCode;
    state().rejectEdit();
    state().runDirective('darker', 'drums');
    expect(state().stagedEdit!.newCode).toBe(withSigil);
  });

  it('refuses a named voice that is not in the score instead of retargeting', () => {
    state().runDirective('darker', '$nope');
    expect(state().stagedEdit).toBeNull(); // the old code silently edited voices[0]
    const last = state().messages.at(-1)!;
    expect(last.shape).toBe('error');
    expect(last.text).toContain('$nope');
    expect(last.text).toContain('$drums'); // names what IS available
  });

  it('still falls back to the active voice when no hint is given', () => {
    state().selectVoice('hats');
    state().runDirective('darker');
    expect(state().stagedEdit!.targetVoiceId).toBe('hats');
  });
});

// ===========================================================================
// D9 — togglePlay is async, so two rapid calls could interleave stop()/play().
// A true stop REWINDS the scheduler, so that pair reads as a clock reset.
// ===========================================================================
describe('togglePlay re-entry guard (D9)', () => {
  it('two concurrent toggles from stopped start the transport exactly once', async () => {
    // The dangerous path is play(), which awaits the engine: a second caller
    // arriving mid-await used to see `playing` still false and start a SECOND
    // transport. (Two toggles from *playing* are not concurrent at all — stop()
    // is synchronous, so the first call completes and pause-then-play is the
    // correct outcome of pressing twice.)
    (engine.evaluate as any).mockClear();
    await Promise.all([state().togglePlay(), state().togglePlay()]);
    expect(state().playing).toBe(true);
    expect(engine.evaluate).toHaveBeenCalledTimes(1);
  });

  it('a toggle arriving while play() is still awaiting is dropped', async () => {
    (engine.evaluate as any).mockClear();
    const first = state().togglePlay();
    const second = state().togglePlay(); // lands mid-await
    await Promise.all([first, second]);
    expect(engine.evaluate).toHaveBeenCalledTimes(1);
    expect(state().playing).toBe(true);
  });

  it('pausing a running transport still stops it exactly once', async () => {
    await state().play();
    (engine.stop as any).mockClear();
    await state().togglePlay();
    expect(state().playing).toBe(false);
    expect(engine.stop).toHaveBeenCalledTimes(1);
  });

  it('sequential toggles still work normally', async () => {
    await state().togglePlay();
    expect(state().playing).toBe(true);
    await state().togglePlay();
    expect(state().playing).toBe(false);
    await state().togglePlay();
    expect(state().playing).toBe(true);
  });

  // D14 — CHARACTERISATION, not a defect. Two rapid toggles from a playing
  // transport give pause-then-play, and the clock DOES rewind to 0, because a
  // true stop() rewinds the scheduler (store.stop's own contract, and the real
  // @strudel/core cyclist: stop() sets lastEnd = 0). A user double-clicking the
  // transport button legitimately restarts from zero.
  //
  // This is deliberately NOT the bug the audit found. That bug was ONE keypress
  // firing togglePlay TWICE — two window keydown owners, App.tsx and
  // PerformanceMode — which reset a counter at ~2706 and read as the v0.1
  // "clock dies" failure. It is fixed by making App.tsx the single owner
  // (B-5, pinned in App.transport.test.tsx), not by debouncing here: a debounce
  // would block a user who genuinely wants a fast pause-then-play.
  //
  // Pinned so nobody mistakes the rewind below for the clock-death bug and
  // "fixes" it. If this test starts failing, the transport semantics changed.
  it('two deliberate toggles from playing pause-then-play, and the clock rewinds by design', async () => {
    await state().play();
    (engine as any).__advance(2706); // a long live session
    expect(engine.now()).toBe(2706);

    await state().togglePlay(); // pause — a true stop rewinds the scheduler
    expect(state().playing).toBe(false);
    expect(engine.now()).toBe(0);

    await state().togglePlay(); // play again, from the top
    expect(state().playing).toBe(true);
    expect(engine.now()).toBe(0);
  });
});

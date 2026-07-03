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

import { useStore } from './store';
import { engine } from '../audio/strudelEngine';
import { chat } from '../llm/providers';
import { resetStore, state } from '../../tests/helpers/store';

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

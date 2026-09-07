import { describe, it, expect, beforeEach } from 'vitest';
import {
  LS_CUSTOM_DIRECTIVES,
  LS_CUSTOM_MIGRATED,
  loadCustomDirectives,
  saveCustomDirectives,
  migrateCustomDirectives,
  saveProject,
  loadProject,
  type ProjectBlob,
} from './projects';
import type { CustomDirective } from '../types';

// Pure storage tier: no store, no mocks, no DOM beyond localStorage (which
// tests/setup.unit.ts clears after every case).
//
// The fixture deliberately mirrors the REAL pre-fix localStorage captured from
// the live app (temp/localstorage-pre-fix.json): the device-level key holds the
// user's one saved verb, and BOTH project blobs carry `customDirectives: []`.
// That combination is what caused the bug — `[] ?? x` is `[]`, so opening a
// project clobbered the runtime list with the blob's empty array (A-4).

const SHIMMER: CustomDirective = {
  id: 'u_a13shimmer',
  label: 'a13shimmer',
  aliases: [],
  chain: '.room(0.5).lpf(1200)',
  blurb: 'applies .room(0.5).lpf(1200)',
};

function blob(id: string, name: string, custom?: CustomDirective[]): ProjectBlob {
  return {
    id,
    name,
    score: `// ${name}\n$drums: s("bd*2")`,
    committed: `// ${name}\n$drums: s("bd*2")`,
    history: [],
    headId: null,
    scenes: [],
    seed: 44095,
    voiceState: {},
    ...(custom ? { customDirectives: custom } : {}),
    updated: 1788733022414,
  };
}

/** The live shape: verb in the global key, empty arrays in both blobs. */
function seedLiveState() {
  saveCustomDirectives([SHIMMER]);
  saveProject(blob('nightjar', 'nightjar', []));
  saveProject(blob('pmtqdk2jy', 'chunk4b', []));
  localStorage.setItem('refrain.activeProject', 'nightjar');
  localStorage.removeItem(LS_CUSTOM_MIGRATED);
}

beforeEach(() => {
  localStorage.clear();
});

describe('loadCustomDirectives / saveCustomDirectives', () => {
  it('round-trips a verb', () => {
    saveCustomDirectives([SHIMMER]);
    expect(loadCustomDirectives()).toEqual([SHIMMER]);
  });

  it('returns [] when nothing is stored', () => {
    expect(loadCustomDirectives()).toEqual([]);
  });

  it('returns [] on corrupt JSON without throwing', () => {
    localStorage.setItem(LS_CUSTOM_DIRECTIVES, '{not json');
    expect(() => loadCustomDirectives()).not.toThrow();
    expect(loadCustomDirectives()).toEqual([]);
  });

  it('returns [] when the stored value is not an array', () => {
    localStorage.setItem(LS_CUSTOM_DIRECTIVES, '{"nope":1}');
    expect(loadCustomDirectives()).toEqual([]);
  });
});

describe('migrateCustomDirectives — against the real pre-fix state (A-4)', () => {
  it('keeps the verb that only the device-level key holds', () => {
    seedLiveState();
    expect(migrateCustomDirectives()).toEqual([SHIMMER]);
  });

  it('does not rewrite a single byte of any project blob', () => {
    seedLiveState();
    const before = {
      nightjar: localStorage.getItem('refrain.project.nightjar'),
      chunk4b: localStorage.getItem('refrain.project.pmtqdk2jy'),
    };
    migrateCustomDirectives();
    expect(localStorage.getItem('refrain.project.nightjar')).toBe(before.nightjar);
    expect(localStorage.getItem('refrain.project.pmtqdk2jy')).toBe(before.chunk4b);
  });

  it('neither reads nor creates refrain.providers', () => {
    seedLiveState();
    expect(localStorage.getItem('refrain.providers')).toBeNull();
    migrateCustomDirectives();
    // env-seeded keys are stripped before persist by design — a storage
    // migration must never resurrect a providers key.
    expect(localStorage.getItem('refrain.providers')).toBeNull();
  });

  it('leaves the score and history of the active project intact', () => {
    seedLiveState();
    const before = loadProject('nightjar');
    migrateCustomDirectives();
    expect(loadProject('nightjar')).toEqual(before);
  });
});

describe('migrateCustomDirectives — draining the legacy field', () => {
  it('adopts a verb that exists only inside a project blob', () => {
    const legacy: CustomDirective = { id: 'u_legacy', label: 'legacy', aliases: [], chain: '.gain(0.5)', blurb: '' };
    saveProject(blob('nightjar', 'nightjar', [legacy]));
    localStorage.setItem('refrain.activeProject', 'nightjar');
    expect(migrateCustomDirectives()).toEqual([legacy]);
    expect(loadCustomDirectives()).toEqual([legacy]);
  });

  it('still does not rewrite the blob it drained', () => {
    const legacy: CustomDirective = { id: 'u_legacy', label: 'legacy', aliases: [], chain: '.gain(0.5)', blurb: '' };
    saveProject(blob('nightjar', 'nightjar', [legacy]));
    const before = localStorage.getItem('refrain.project.nightjar');
    migrateCustomDirectives();
    expect(localStorage.getItem('refrain.project.nightjar')).toBe(before);
  });

  it('merges verbs from several projects', () => {
    const a: CustomDirective = { id: 'u_a', label: 'a', aliases: [], chain: '.gain(1)', blurb: '' };
    const b: CustomDirective = { id: 'u_b', label: 'b', aliases: [], chain: '.gain(2)', blurb: '' };
    saveProject(blob('p1', 'one', [a]));
    saveProject(blob('p2', 'two', [b]));
    expect(migrateCustomDirectives().map((d) => d.id).sort()).toEqual(['u_a', 'u_b']);
  });

  it('adopts a verb from an active project missing from the index', () => {
    const orphan: CustomDirective = { id: 'u_orphan', label: 'orphan', aliases: [], chain: '.gain(3)', blurb: '' };
    // write the blob directly, so it never reaches refrain.projects
    localStorage.setItem('refrain.project.ghost', JSON.stringify(blob('ghost', 'ghost', [orphan])));
    localStorage.setItem('refrain.activeProject', 'ghost');
    expect(migrateCustomDirectives()).toEqual([orphan]);
  });

  it('lets the device-level entry win an id conflict', () => {
    const mine: CustomDirective = { ...SHIMMER, chain: '.room(0.9)' };
    const stale: CustomDirective = { ...SHIMMER, chain: '.room(0.1)' };
    saveCustomDirectives([mine]);
    saveProject(blob('nightjar', 'nightjar', [stale]));
    const out = migrateCustomDirectives();
    expect(out).toHaveLength(1);
    // the global entry is the one the user's own palette was reading
    expect(out[0].chain).toBe('.room(0.9)');
  });
});

describe('migrateCustomDirectives — latching', () => {
  it('is idempotent', () => {
    seedLiveState();
    expect(migrateCustomDirectives()).toEqual([SHIMMER]);
    expect(migrateCustomDirectives()).toEqual([SHIMMER]);
  });

  it('does not resurrect a verb the user deleted after migrating', () => {
    seedLiveState();
    migrateCustomDirectives();
    saveCustomDirectives([]); // user removes it in the Forge
    expect(migrateCustomDirectives()).toEqual([]);
  });

  it('sets the latch so a legacy blob is drained only once', () => {
    const legacy: CustomDirective = { id: 'u_legacy', label: 'legacy', aliases: [], chain: '.gain(0.5)', blurb: '' };
    saveProject(blob('nightjar', 'nightjar', [legacy]));
    migrateCustomDirectives();
    expect(localStorage.getItem(LS_CUSTOM_MIGRATED)).toBe('1');
    saveCustomDirectives([]);
    expect(migrateCustomDirectives()).toEqual([]);
  });

  it('returns the stored list untouched when already migrated', () => {
    saveCustomDirectives([SHIMMER]);
    localStorage.setItem(LS_CUSTOM_MIGRATED, '1');
    const legacy: CustomDirective = { id: 'u_never', label: 'never', aliases: [], chain: '.gain(9)', blurb: '' };
    saveProject(blob('nightjar', 'nightjar', [legacy]));
    expect(migrateCustomDirectives()).toEqual([SHIMMER]);
  });
});

// ---------------------------------------------------------------------------
// Projects that persist (spec §08). A project is the score, the history tree,
// the scenes, the seed and your custom verbs — written locally and autosaved as
// you work. The spec's PLATFORM DECISION is a desktop shell that writes a real
// `.refrain` folder; this browser tier keeps the SAME model + formats in the
// browser's local store ("same model, smaller reach"). API keys are never here.
// ---------------------------------------------------------------------------

import type { Commit, Scene, CustomDirective, ProjectMeta, MaestroEffort } from '../types';

export interface ProjectBlob {
  id: string;
  name: string;
  score: string;
  committed: string;
  history: Commit[];
  headId: string | null;
  scenes: Scene[];
  seed: number;
  voiceState: Record<string, { muted: boolean; solo: boolean }>;
  /**
   * @deprecated Legacy, pre-A-4. Custom verbs are device-level and live in
   * `refrain.customDirectives`; this field is READ by the migration only and
   * never written again. A project blob that still carries it is harmless — the
   * field simply goes inert and disappears the next time that project autosaves.
   */
  customDirectives?: CustomDirective[];
  effort?: MaestroEffort; // per-project effort default (spec §12.4)
  updated: number;
}

const LS_INDEX = 'refrain.projects'; // ProjectMeta[]
const LS_ACTIVE = 'refrain.activeProject';
const blobKey = (id: string) => `refrain.project.${id}`;

/**
 * The single source of truth for author-your-own verbs (A-4). Device-level, like
 * providers/roles/prefs — a verb follows the person, not the song. It used to be
 * written into each project blob too, and because `[] ?? x` is `[]`, opening a
 * project CLOBBERED the runtime list with the blob's empty array: the verb
 * vanished from the palette and the Forge while sitting untouched on disk.
 */
export const LS_CUSTOM_DIRECTIVES = 'refrain.customDirectives';
/** Latch so the one-way legacy drain runs at most once per browser. */
export const LS_CUSTOM_MIGRATED = 'refrain.customDirectives.migrated';

export function loadCustomDirectives(): CustomDirective[] {
  try {
    const raw = localStorage.getItem(LS_CUSTOM_DIRECTIVES);
    const list = raw ? (JSON.parse(raw) as CustomDirective[]) : [];
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

export function saveCustomDirectives(ds: CustomDirective[]) {
  try {
    localStorage.setItem(LS_CUSTOM_DIRECTIVES, JSON.stringify(ds));
  } catch {
    /* noop */
  }
}

/**
 * One-way, latched, NON-DESTRUCTIVE drain of the legacy per-project field into
 * the device-level key. Project blobs are read-only here: nothing is rewritten,
 * so a user's history/score can't be damaged by a storage refactor. The global
 * entry wins an id conflict, because it is the one the user's own UI was
 * reading. Never touches `refrain.providers` — that key does not exist by
 * design (env-seeded keys are stripped before persist) and must not be created.
 */
export function migrateCustomDirectives(): CustomDirective[] {
  try {
    if (localStorage.getItem(LS_CUSTOM_MIGRATED) === '1') return loadCustomDirectives();
    const merged = loadCustomDirectives();
    const ids = new Set(listProjects().map((p) => p.id));
    const active = activeProjectId();
    if (active) ids.add(active); // defensive: a blob missing from the index
    for (const pid of ids) {
      for (const d of loadProject(pid)?.customDirectives ?? []) {
        // Shape-check, don't just null-check: a legacy entry missing `aliases`
        // or `chain` would throw later inside interpret/suggestDirectives,
        // which iterate them — a bad row must be dropped here, not carried.
        if (!d || typeof d.id !== 'string' || typeof d.label !== 'string') continue;
        if (typeof d.chain !== 'string' || !Array.isArray(d.aliases)) continue;
        if (!merged.some((x) => x.id === d.id)) merged.push(d);
      }
    }
    saveCustomDirectives(merged);
    localStorage.setItem(LS_CUSTOM_MIGRATED, '1');
    return merged;
  } catch {
    return loadCustomDirectives();
  }
}

export function listProjects(): ProjectMeta[] {
  try {
    const raw = localStorage.getItem(LS_INDEX);
    const list = raw ? (JSON.parse(raw) as ProjectMeta[]) : [];
    return list.sort((a, b) => b.updated - a.updated);
  } catch {
    return [];
  }
}

function writeIndex(list: ProjectMeta[]) {
  try {
    localStorage.setItem(LS_INDEX, JSON.stringify(list));
  } catch {
    /* noop */
  }
}

export function loadProject(id: string): ProjectBlob | null {
  try {
    const raw = localStorage.getItem(blobKey(id));
    return raw ? (JSON.parse(raw) as ProjectBlob) : null;
  } catch {
    return null;
  }
}

/** Persist a project blob + refresh its index metadata (counts, timestamp). */
export function saveProject(blob: ProjectBlob) {
  try {
    localStorage.setItem(blobKey(blob.id), JSON.stringify(blob));
    const meta: ProjectMeta = {
      id: blob.id,
      name: blob.name,
      voices: countVoices(blob.score),
      scenes: blob.scenes.length,
      commits: blob.history.filter((c) => !c.parked).length,
      updated: blob.updated,
    };
    const list = listProjects().filter((p) => p.id !== blob.id);
    writeIndex([meta, ...list]);
  } catch {
    /* noop */
  }
}

export function deleteProject(id: string) {
  try {
    localStorage.removeItem(blobKey(id));
    writeIndex(listProjects().filter((p) => p.id !== id));
  } catch {
    /* noop */
  }
}

export function activeProjectId(): string | null {
  try {
    return localStorage.getItem(LS_ACTIVE);
  } catch {
    return null;
  }
}

export function setActiveProjectId(id: string) {
  try {
    localStorage.setItem(LS_ACTIVE, id);
  } catch {
    /* noop */
  }
}

function countVoices(score: string): number {
  return (score.match(/^\s*\$[A-Za-z_][\w-]*\s*:/gm) ?? []).length;
}

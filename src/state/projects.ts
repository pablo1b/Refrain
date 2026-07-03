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
  customDirectives: CustomDirective[];
  effort?: MaestroEffort; // per-project effort default (spec §12.4)
  updated: number;
}

const LS_INDEX = 'refrain.projects'; // ProjectMeta[]
const LS_ACTIVE = 'refrain.activeProject';
const blobKey = (id: string) => `refrain.project.${id}`;

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

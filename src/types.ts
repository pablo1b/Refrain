// ---------------------------------------------------------------------------
// Refrain — shared domain types
// ---------------------------------------------------------------------------

export type ThemeName = 'dark' | 'light';
export type Mode = 'studio' | 'performance';

/** A named pattern in the score: `$drums: s("bd*2")`. The voice IS the code. */
export interface Voice {
  id: string; // "drums"
  sigil: string; // "$drums"
  color: string; // resolved CSS colour
  expr: string; // expression text (everything after `$name:`)
  startLine: number; // 0-based line in the score where `$name:` lives
  endLine: number; // 0-based last line of the block (inclusive)
  muted: boolean;
  solo: boolean;
  events: number; // approx event count in one cycle (for the outline)
}

export type DiffOp = 'add' | 'del' | 'ctx';
export interface DiffRow {
  op: DiffOp;
  text: string;
}
export interface DiffHunk {
  id: string;
  /** 1-based line number in the new file where this hunk begins */
  newStart: number;
  rows: DiffRow[];
  enabled: boolean; // per-hunk accept toggle
}

/** A proposed, auditioned, reversible edit to the score. Shape 01. */
export interface StagedEdit {
  id: string;
  summary: string; // Maestro's musical description
  directive?: string;
  oldCode: string;
  newCode: string;
  hunks: DiffHunk[];
  auditioning: boolean;
  targetVoiceId?: string;
}

export type MaestroShape = 'diff' | 'lanes' | 'answer' | 'thinking' | 'error';

export interface MaestroMessage {
  id: string;
  role: 'user' | 'maestro';
  text: string;
  shape?: MaestroShape;
  editId?: string;
  laneSetId?: string;
  pending?: boolean;
}

export type LaneShape = 'sweep' | 'roll' | 'gap' | 'flat' | 'rise';
export interface Lane {
  id: string;
  label: string; // "A"
  name: string; // "filter sweep"
  desc: string; // "2 bars"
  voiceId: string; // injected as a new voice
  code: string; // full `$name: ...` to add to the score
  shape: LaneShape;
}
export interface LaneSet {
  id: string;
  prompt: string;
  lanes: Lane[];
  soloId: string | null;
  committedId: string | null;
}

/** Shape 02 generation: a scene snapshots which voices play and how loud. */
export interface Scene {
  id: string;
  name: string;
  /** voiceId -> intensity 0..1 (0 = silent in this scene) */
  levels: Record<string, number>;
}

export type ProviderId = 'anthropic' | 'openai' | 'google' | 'ollama';
export interface Provider {
  id: ProviderId;
  label: string;
  key: string;
  endpoint?: string; // ollama
  model: string;
  connected: boolean;
  local?: boolean;
}

export type RoleId = 'directives' | 'generation' | 'theory' | 'offline';
export interface RoleRoute {
  id: RoleId;
  label: string;
  provider: ProviderId;
  model: string;
  strength: 'fast' | 'strong' | 'local';
}

export type Surface =
  | 'patch'
  | 'foundry'
  | 'providers'
  | 'arrangement'
  | 'notation'
  | null;

export interface LogLine {
  id: string;
  text: string;
  type: 'info' | 'success' | 'error' | 'warning';
}

/** Result of running the Maestro brain on a turn. */
export type MaestroResult =
  | { shape: 'diff'; summary: string; newCode: string; directive?: string; targetVoiceId?: string }
  | { shape: 'lanes'; summary: string; lanes: Omit<Lane, 'id'>[]; prompt: string }
  | { shape: 'answer'; text: string }
  | { shape: 'error'; text: string };

import { create } from 'zustand';
import type {
  ThemeName,
  Mode,
  Surface,
  Voice,
  StagedEdit,
  MaestroMessage,
  LaneSet,
  Scene,
  Provider,
  RoleRoute,
  LogLine,
  Provenance,
  Commit,
  ArcSelection,
  ContextPin,
  LensId,
  MiniRollMode,
  PrompterCard,
  CustomDirective,
  MaestroEffort,
  MotionPref,
  TransportKey,
  ConflictChoice,
  MergeResult,
} from '../types';
import { engine, type EngineStatus, type EngineEvent } from '../audio/strudelEngine';
import { midi } from '../audio/midiSync';
import { parseScore } from '../music/parseScore';
import { applyDirective, interpret, DIRECTIVE_BY_ID } from '../music/directives';
import { computeHunks, applyEnabled } from '../music/diff';
import { mergeScores, applyResolutions } from '../music/merge';
import { colorForVoice, cssVar } from '../theme/tokens';
import {
  loadProviders,
  saveProviders,
  loadRoles,
  saveRoles,
  strengthFor,
  chat,
  extractCode,
  hasReasoningTier,
  resolveEffort,
  MAESTRO_SYSTEM,
} from '../llm/providers';
import { buildLanes } from '../music/lanes';
import {
  type ProjectBlob,
  listProjects,
  loadProject,
  saveProject,
  activeProjectId,
  setActiveProjectId,
} from './projects';
import type { ProjectMeta } from '../types';

export const DEFAULT_SCORE = `// nightjar — set 02
setcps(0.5)

$drums: s("bd*2, ~ sd").bank("RolandTR909")
$hats:  s("hh*8").gain("0.4 0.7")
       .pan(sine.range(0.3,0.7))
$bass:  note("c2 eb2 g2 c3")
       .s("sawtooth")
       .lpf(sine.range(300,1200).slow(4))

$pad:   note("<Cm7 Abmaj7>")
       .s("sawtooth").room(0.3)
       .slow(2).gain(0.5)`;

let uid = 0;
const id = (p = 'x') => `${p}${Date.now().toString(36)}${(uid++).toString(36)}`;

/** A visible 16-bit generation seed, rendered like `0x4F2A` (spec §07). */
export function randomSeed(): number {
  return Math.floor(Math.random() * 0x10000);
}
export function seedHex(seed: number): string {
  return '0x' + (seed & 0xffff).toString(16).toUpperCase().padStart(4, '0');
}
function nowCycle(): number {
  try {
    return engine.started ? Math.floor(engine.now()) : 0;
  } catch {
    return 0;
  }
}

// Author-your-own directives persist locally, like providers/roles (spec §10).
const LS_CUSTOM = 'refrain.customDirectives';
function loadCustomDirectives(): CustomDirective[] {
  try {
    const raw = localStorage.getItem(LS_CUSTOM);
    return raw ? (JSON.parse(raw) as CustomDirective[]) : [];
  } catch {
    return [];
  }
}
function saveCustomDirectives(ds: CustomDirective[]) {
  try {
    localStorage.setItem(LS_CUSTOM, JSON.stringify(ds));
  } catch {
    /* noop */
  }
}

// Device-level prefs (spec §12.3 transport binding, §12.8 motion) — global, not
// per-project: they follow the machine/room, not the song.
const LS_PREFS = 'refrain.prefs';
interface Prefs {
  transportKey: TransportKey;
  motion: MotionPref;
  f5NoticeSeen: boolean;
}
function loadPrefs(): Prefs {
  const def: Prefs = { transportKey: 'mod-shift-enter', motion: 'system', f5NoticeSeen: false };
  try {
    const raw = localStorage.getItem(LS_PREFS);
    return raw ? { ...def, ...(JSON.parse(raw) as Partial<Prefs>) } : def;
  } catch {
    return def;
  }
}
function savePrefs(p: Prefs) {
  try {
    localStorage.setItem(LS_PREFS, JSON.stringify(p));
  } catch {
    /* noop */
  }
}

/** Resolve whether motion should be reduced right now (spec §12.8): the manual
 *  choice overrides the OS media query in either direction. */
export function motionIsReduced(pref: MotionPref): boolean {
  if (pref === 'reduced') return true;
  if (pref === 'full') return false;
  try {
    return !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}

/** Human label for the active transport binding (spec §12.3) — the titlebar and
 *  hints read this, never a hardcoded key, so the UI can't lie about the key. */
export function transportKeyLabel(k: TransportKey): string {
  return k === 'f5' ? 'F5' : '⌘⇧⏎';
}

interface VState {
  muted: boolean;
  solo: boolean;
}

interface RefrainState {
  theme: ThemeName;
  mode: Mode;
  surface: Surface;

  score: string;
  committed: string; // what is (or would be) playing
  voices: Voice[];
  voiceState: Record<string, VState>;
  activeVoiceId: string | null;
  ticks: Record<string, number[]>;
  events: Record<string, EngineEvent[]>; // begin+dur+gain per voice (tracker/meters)

  playing: boolean; // audio is sounding
  transportLive: boolean; // the scheduler clock is running (survives PANIC/HUSH)
  cps: number;
  engineStatus: EngineStatus;
  engineError: string | null;

  messages: MaestroMessage[];
  maestroBusy: boolean;
  effort: MaestroEffort; // per-turn effort override; composes with routing (spec §12.4)

  stagedEdit: StagedEdit | null;
  hunkEnabled: Record<string, boolean>;

  laneSet: LaneSet | null;
  seed: number; // current visible generation seed (spec §07)

  scenes: Scene[];
  activeSceneId: string | null;

  // history / time-travel (spec §07)
  history: Commit[];
  headId: string | null;

  // editor context + clock-as-target (spec §02, §06)
  pins: ContextPin[];
  arcSelection: ArcSelection | null;

  // stage lenses (spec §05, §12.1, §12.5)
  lenses: LensId[];
  miniRoll: Record<string, MiniRollMode>; // per-voice inline roll mode (spec §12.5)

  // device prefs — transport binding (spec §12.3) + reduced motion (spec §12.8)
  transportKey: TransportKey;
  motion: MotionPref;
  f5NoticeSeen: boolean;

  // MIDI sync-out (spec §12.7) — the Cycle as master
  midiOn: boolean;

  // pending voice-granular merge awaiting conflict resolution (spec §12.6)
  pendingMerge: (MergeResult & { theirsId: string; theirsLabel: string }) | null;

  // the Prompter (spec §04)
  prompterCards: PrompterCard[];
  prompterMuted: boolean;
  prompterDismissed: string[]; // dismissed kinds, quieted for the session

  customDirectives: CustomDirective[]; // author-your-own verbs (spec §10)

  // projects (spec §08)
  projectId: string;
  projectName: string;
  projects: ProjectMeta[];

  providers: Provider[];
  roles: RoleRoute[];
  localOnly: boolean;

  logs: LogLine[];

  // actions
  setTheme: (t: ThemeName) => void;
  toggleTheme: () => void;
  setMode: (m: Mode) => void;
  openSurface: (s: Surface) => void;

  initAudio: () => Promise<void>;
  setScore: (code: string, opts?: { reaudition?: boolean }) => void;
  play: () => Promise<void>;
  stop: () => void;
  togglePlay: () => Promise<void>;
  panic: () => Promise<void>;
  hush: () => Promise<void>;
  setCps: (cps: number) => void;
  nudgeCps: (delta: number) => void;

  selectVoice: (vid: string | null) => void;
  toggleMute: (vid: string) => void;
  toggleSolo: (vid: string) => void;

  sendMaestro: (text: string) => Promise<void>;
  runDirective: (directiveId: string, voiceHint?: string, degree?: number) => void;
  runBreak: () => Promise<void>; // the flagship multi-step agent task (spec §03)
  stageEdit: (summary: string, newCode: string, opts?: { directive?: string; announce?: boolean }) => void;
  acceptEdit: () => void;
  rejectEdit: () => void;
  toggleHunk: (hid: string) => void;

  soloLane: (laneId: string | null) => void;
  commitLane: (laneId: string) => void;
  rerollLanes: () => void;
  refineLane: (laneId: string) => void;

  snapshotScene: (name: string) => void;
  launchScene: (sceneId: string) => void;
  deleteScene: (sceneId: string) => void;

  setProviderKey: (pid: Provider['id'], key: string) => void;
  setProviderModel: (pid: Provider['id'], model: string) => void;
  setRoleProvider: (roleId: RoleRoute['id'], provider: Provider['id'], model: string) => void;
  toggleLocalOnly: () => void;

  // maestro agent (spec §12.4)
  setEffort: (e: MaestroEffort) => void;
  /** Reconcile the effort toggle with a role's routing for a turn (spec §12.4). */
  resolveTurnEffort: (roleId: RoleRoute['id'], isTask: boolean) => { thinking: boolean; trace: boolean };

  // seeded generation (spec §07)
  reseed: (mode: 'same' | 'nudge' | 'new') => void;

  // history / time-travel (spec §07) + voice-granular merge (spec §12.6)
  rewind: (commitId: string) => void;
  forkFrom: (commitId: string) => void;
  reproduceCommit: (commitId: string) => void;
  mergeInto: (otherCommitId: string) => void;
  resolveMerge: (choices: Record<string, ConflictChoice>) => void;
  cancelMerge: () => void;

  // editor context pins (spec §02, §12.2)
  addPin: (pin: Omit<ContextPin, 'id'>) => string;
  updatePin: (id: string, patch: Partial<Omit<ContextPin, 'id'>>) => void;
  extendLastPin: (endLine: number) => void;
  removePin: (pinId: string) => void;
  clearPins: () => void;

  // clock-as-target (spec §06)
  setArcSelection: (arc: ArcSelection | null) => void;
  applyArcToVoice: (voiceId?: string) => void;

  // stage lenses (spec §05, §12.1, §12.5)
  toggleLens: (id: LensId) => void;
  cycleMiniRoll: (voiceId: string) => void;

  // device prefs (spec §12.3, §12.7, §12.8)
  setTransportKey: (k: TransportKey) => void;
  setMotion: (m: MotionPref) => void;
  applyMotion: () => void;
  toggleMidi: () => Promise<void>;

  // the Prompter (spec §04)
  refreshPrompter: () => void;
  tryCard: (cardId: string) => void;
  dismissCard: (cardId: string) => void;
  togglePrompter: () => void;

  // author-your-own directives (spec §10)
  addCustomDirective: (d: Omit<CustomDirective, 'id'>) => void;
  removeCustomDirective: (id: string) => void;

  // projects (spec §08)
  hydrateFromStorage: () => void;
  newProject: (name: string) => void;
  openProject: (id: string) => void;
  renameProject: (name: string) => void;
  saveCheckpoint: (name?: string) => void;

  log: (text: string, type?: LogLine['type']) => void;
}

// -------- helpers (module scope) --------

function buildVoices(score: string, vstate: Record<string, VState>): Voice[] {
  const { voices } = parseScore(score);
  return voices.map((v, i) => ({
    id: v.id,
    sigil: v.sigil,
    color: colorForVoice(v.id, i),
    expr: v.expr,
    startLine: v.startLine,
    endLine: v.endLine,
    muted: vstate[v.id]?.muted ?? false,
    solo: vstate[v.id]?.solo ?? false,
    events: v.events,
  }));
}

/**
 * HUSH transform: append a one-cycle gain ramp (`.gain(saw.range(1,0).slow(1))`)
 * to every sounding voice so the mix fades out over a cycle rather than cutting.
 * `saw` runs 0→1, so range(1,0) is a falling ramp — a real, honest fade (spec §10).
 */
function fadeOutScore(score: string): string {
  const { voices } = parseScore(score);
  const lines = score.split('\n');
  for (const v of [...voices].reverse()) {
    if (v.expr.trim() === 'silence') continue;
    lines.splice(v.endLine + 1, 0, `${v.indent}.gain(saw.range(1, 0).slow(1))`);
  }
  return lines.join('\n');
}

/** Apply mute/solo by silencing excluded voices — what actually reaches audio. */
function effectiveScore(score: string, vstate: Record<string, VState>): string {
  const { voices } = parseScore(score);
  const anySolo = voices.some((v) => vstate[v.id]?.solo);
  const lines = score.split('\n');
  for (const v of [...voices].reverse()) {
    const silent = vstate[v.id]?.muted || (anySolo && !vstate[v.id]?.solo);
    if (silent) {
      lines.splice(v.startLine, v.endLine - v.startLine + 1, `${v.sigil}: silence`);
    }
  }
  return lines.join('\n');
}

let tickToken = 0;
let tickTimer: ReturnType<typeof setTimeout> | null = null;

export const useStore = create<RefrainState>((set, get) => {
  // recompute per-voice events (begin+dur+gain) for the current voices; the
  // Cycle clock reads the begins, the Tracker lens reads the spans, and the
  // honest meters read onsets. Debounced + superseded-token guarded (async).
  async function recomputeEvents() {
    const token = ++tickToken;
    const voices = get().voices;
    if (!engine.ready) return;
    const events: Record<string, EngineEvent[]> = {};
    const ticks: Record<string, number[]> = {};
    for (const v of voices) {
      const evs = await engine.queryEvents(v.expr);
      if (token !== tickToken) return; // superseded
      events[v.id] = evs;
      ticks[v.id] = evs.map((e) => e.begin);
    }
    set({ events, ticks });
  }
  function scheduleTicks() {
    if (tickTimer) clearTimeout(tickTimer);
    tickTimer = setTimeout(recomputeEvents, 220);
  }

  // Hand edits become "you" commits — coalesced on a pause, not per keystroke, so
  // the history stays a musical changelog, not a transcript (spec §07/§08).
  let handTimer: ReturnType<typeof setTimeout> | null = null;
  function scheduleHandCommit() {
    if (handTimer) clearTimeout(handTimer);
    handTimer = setTimeout(() => {
      const s = get();
      if (s.stagedEdit) return; // a staged edit will commit on its own accept
      const head = s.history.find((c) => c.id === s.headId);
      if (head && head.score !== s.score) {
        pushCommit('hand edit', { source: 'you', when: Date.now(), cycle: nowCycle() });
      }
    }, 2600);
  }

  /** Evaluate whatever should currently sound (committed score or audition). */
  async function evalCurrent(scoreToPlay: string) {
    if (!engine.ready) return;
    const eff = effectiveScore(scoreToPlay, get().voiceState);
    const res = await engine.evaluate(eff, true);
    if (!res.ok && res.error) get().log(`audio: ${res.error}`, 'error');
  }

  function provForRole(roleId: RoleRoute['id']): { provider: Provider; model: string } | null {
    const { roles, providers, localOnly } = get();
    const role = roles.find((r) => r.id === roleId);
    if (!role) return null;
    const provider = providers.find((p) => p.id === role.provider);
    if (!provider || !provider.connected) return null;
    if (localOnly && !provider.local) return null;
    return { provider, model: role.model };
  }

  /** A friendly model label for provenance/badges — "Claude Sonnet", "Gemini Flash". */
  function llmModelLabel(roleId: RoleRoute['id']): string | undefined {
    const route = provForRole(roleId);
    if (!route) return undefined;
    const m = route.model;
    if (/sonnet/i.test(m)) return 'Claude Sonnet';
    if (/haiku/i.test(m)) return 'Claude Haiku';
    if (/opus/i.test(m)) return 'Claude Opus';
    if (/gpt-4o-mini/i.test(m)) return 'GPT-4o mini';
    if (/gpt/i.test(m)) return m.toUpperCase();
    if (/gemini/i.test(m)) return 'Gemini Flash';
    if (/llama/i.test(m)) return `${m} · local`;
    return m;
  }

  /** The code a new edit should build on — the current staged result if one is
   *  pending (so sequential directives stack), otherwise the committed score. */
  function stagedBase(): string {
    const e = get().stagedEdit;
    return e ? applyEnabled(e.oldCode, e.newCode, get().hunkEnabled) : get().score;
  }

  /** Pinned ranges as an explicit focus block for a Maestro turn (spec §12.2:
   *  "point the Maestro at exactly the lines you mean"). Sorted in gutter order so
   *  "swap these two" is unambiguous; empty when nothing is pinned (whole file). */
  function pinnedContext(): string {
    const pins = get().pins;
    if (!pins.length) return '';
    const lines = get().score.split('\n');
    const blocks = [...pins]
      .sort((a, b) => a.startLine - b.startLine)
      .map((p) => {
        const src = lines.slice(p.startLine - 1, p.endLine).join('\n');
        const label = `${p.voiceId ? '$' + p.voiceId + ' ' : ''}L${p.startLine}${p.endLine !== p.startLine ? '–' + p.endLine : ''}`;
        return `# ${label}\n${src}`;
      });
    return `\n\nThe user pinned these ranges as the focus — scope the edit to them, in this order:\n${blocks.join('\n')}`;
  }

  /**
   * Push a committed state onto the branchable history tree (spec §07). Parent
   * is the current HEAD, so a linear session grows a line and a rewind+edit
   * grows a branch. Coalesces trivial no-ops (same score as HEAD, non-parked).
   */
  function pushCommit(
    label: string,
    provenance: Provenance,
    opts?: { parked?: boolean; score?: string; parentId?: string | null; force?: boolean; mergeParentId?: string | null },
  ): string {
    const st = get();
    const parentId = opts?.parentId !== undefined ? opts.parentId : st.headId;
    const parent = st.history.find((c) => c.id === parentId) ?? null;
    const score = opts?.score ?? st.score;
    // Coalesce trivial no-ops (same score as parent) unless it's a parked fork
    // or an explicitly forced commit (a named ⌘S checkpoint bookmarks a moment
    // even when the code is unchanged).
    if (!opts?.parked && !opts?.force && parent && parent.score === score) {
      return parent.id;
    }
    const commit: Commit = {
      id: id('c'),
      parentId,
      label,
      score,
      voiceState: JSON.parse(JSON.stringify(st.voiceState)),
      scenes: JSON.parse(JSON.stringify(st.scenes)),
      provenance,
      parked: opts?.parked,
      mergeParentId: opts?.mergeParentId ?? undefined,
    };
    set({ history: [...st.history, commit], headId: opts?.parked ? st.headId : commit.id });
    persistProject();
    return commit.id;
  }

  /** Snapshot the whole project to local storage — the history tree IS the save
   *  file, so this runs on every commit (autosave, never a prompt · spec §08). */
  let persistTimer: ReturnType<typeof setTimeout> | null = null;
  function persistProject() {
    if (persistTimer) clearTimeout(persistTimer);
    persistTimer = setTimeout(() => {
      const s = get();
      // Bound the serialized history so autosave can't blow the ~5MB localStorage
      // quota over a long session (each commit carries a full score snapshot).
      // The in-memory tree stays complete; only the persisted tail is capped.
      const MAX_PERSISTED = 400;
      const history = s.history.length > MAX_PERSISTED ? s.history.slice(-MAX_PERSISTED) : s.history;
      // don't persist a headId that fell outside the retained window (a rewind to
      // an old node) — coerce it into range so reload can't orphan HEAD.
      const headId = history.some((c) => c.id === s.headId) ? s.headId : history.length ? history[history.length - 1].id : null;
      const blob: ProjectBlob = {
        id: s.projectId,
        name: s.projectName,
        score: s.score,
        committed: s.committed,
        history,
        headId,
        scenes: s.scenes,
        seed: s.seed,
        voiceState: s.voiceState,
        customDirectives: s.customDirectives,
        effort: s.effort,
        updated: Date.now(),
      };
      saveProject(blob);
      set({ projects: listProjects() });
    }, 400);
  }

  /** Hydrate the live store from a persisted project blob (spec §08). */
  function applyBlob(blob: ProjectBlob) {
    const parsedCps = parseScore(blob.score).cps;
    set({
      projectId: blob.id,
      projectName: blob.name,
      score: blob.score,
      committed: blob.committed ?? blob.score,
      voiceState: blob.voiceState ?? {},
      voices: buildVoices(blob.score, blob.voiceState ?? {}),
      scenes: blob.scenes ?? [],
      activeSceneId: null,
      history: blob.history?.length ? blob.history : [rootCommit],
      headId: blob.headId ?? (blob.history?.length ? blob.history[blob.history.length - 1].id : rootCommit.id),
      seed: blob.seed ?? randomSeed(),
      customDirectives: blob.customDirectives ?? get().customDirectives,
      effort: blob.effort ?? 'auto',
      stagedEdit: null,
      hunkEnabled: {},
      laneSet: null,
      // drop the previous project's editor context — pins/arc reference its
      // voices & line numbers, which don't exist in the newly-loaded song.
      pins: [],
      arcSelection: null,
      ...(parsedCps != null ? { cps: parsedCps } : {}),
    });
    scheduleTicks();
  }

  const rootCommit: Commit = {
    id: id('c'),
    parentId: null,
    label: 'init · nightjar',
    score: DEFAULT_SCORE,
    voiceState: {},
    scenes: [],
    provenance: { source: 'init', when: Date.now() },
  };

  const prefs0 = loadPrefs();

  return {
    theme: 'dark',
    mode: 'studio',
    surface: null,

    score: DEFAULT_SCORE,
    committed: DEFAULT_SCORE,
    voices: buildVoices(DEFAULT_SCORE, {}),
    voiceState: {},
    activeVoiceId: 'hats',
    ticks: {},
    events: {},

    playing: false,
    transportLive: false,
    cps: 0.5,
    engineStatus: 'idle',
    engineError: null,

    messages: [
      {
        id: id('m'),
        role: 'maestro',
        text: "I'm the Maestro — an agent, not a chatbot. Speak music (*make the hats swing*), press **/** for commands, **@** to reference a voice, or hand me a task (*build an 8-bar break*) and I'll show the plan, run the tools in the open, and stage one reversible diff. Every change carries its provenance — prompt, seed, model — and you can walk the history back.",
        shape: 'answer',
      },
    ],
    maestroBusy: false,
    effort: 'auto',

    stagedEdit: null,
    hunkEnabled: {},

    laneSet: null,
    seed: randomSeed(),

    scenes: [],
    activeSceneId: null,

    history: [rootCommit],
    headId: rootCommit.id,

    pins: [],
    arcSelection: null,

    lenses: ['cycle', 'meters'],
    miniRoll: {},

    transportKey: prefs0.transportKey,
    motion: prefs0.motion,
    f5NoticeSeen: prefs0.f5NoticeSeen,

    midiOn: false,
    pendingMerge: null,

    prompterCards: [],
    prompterMuted: false,
    prompterDismissed: [],

    customDirectives: loadCustomDirectives(),

    projectId: 'nightjar',
    projectName: 'nightjar',
    projects: [],

    providers: loadProviders(),
    roles: loadRoles(),
    localOnly: false,

    logs: [],

    // -------- theme / mode --------
    setTheme: (t) => {
      document.documentElement.setAttribute('data-theme', t);
      set({ theme: t });
    },
    toggleTheme: () => get().setTheme(get().theme === 'dark' ? 'light' : 'dark'),
    setMode: (m) => set({ mode: m }),
    openSurface: (s) => set({ surface: s }),

    // -------- audio --------
    initAudio: async () => {
      engine.onStatus = (s, err) => set({ engineStatus: s, engineError: err ?? null });
      set({ engineStatus: engine.status });
      const ok = await engine.init();
      if (ok) {
        get().log('Strudel engine ready · samples loaded', 'success');
        recomputeEvents();
      } else {
        get().log(`engine error: ${engine.error}`, 'error');
      }
    },

    setScore: (code, opts) => {
      const voices = buildVoices(code, get().voiceState);
      // A pin anchors to its voice's AST node, not the raw line number (spec
      // §12.2): remap voice-pins to the voice's new span so typing a line above
      // doesn't smear the selection; drop pins whose voice was deleted.
      const pins = get().pins;
      const remapped = pins.some((p) => p.voiceId)
        ? pins
            .map((p) => {
              if (!p.voiceId) return p;
              const v = voices.find((vv) => vv.id === p.voiceId);
              return v ? { ...p, startLine: v.startLine + 1, endLine: v.endLine + 1 } : null;
            })
            .filter((p): p is ContextPin => p !== null)
        : pins;
      set({ score: code, voices, ...(remapped !== pins ? { pins: remapped } : {}) });
      scheduleTicks();
      scheduleHandCommit();
      if (opts?.reaudition && get().playing) evalCurrent(code);
    },

    play: async () => {
      if (!engine.ready) await get().initAudio();
      const toPlay = get().stagedEdit
        ? applyEnabled(get().stagedEdit!.oldCode, get().stagedEdit!.newCode, get().hunkEnabled)
        : get().score;
      await evalCurrent(toPlay);
      set({ playing: true, transportLive: true });
      get().log('▶ transport running', 'info');
      recomputeEvents();
    },

    stop: () => {
      // A true stop rewinds the scheduler to 0 — the one case the clock holds.
      engine.stop();
      set({ playing: false, transportLive: false });
      get().log('⏹ transport stopped', 'info');
    },

    togglePlay: async () => {
      if (get().playing) get().stop();
      else await get().play();
    },

    panic: async () => {
      // PANIC — cut to silence INSTANTLY. The scheduler (and the on-screen clock)
      // keep running (engine.panic evaluates `silence`, never stop()), so the
      // safest exit looks safe (FIX §10). playing:false stops edits auto-sounding.
      await engine.panic();
      midi.allNotesOff(); // PANIC reaches the whole rig — all-notes-off, every channel (spec §12.7)
      set({ playing: false, transportLive: engine.started });
      get().log('PANIC — cut to silence; clock still turning', 'warning');
    },

    hush: async () => {
      // HUSH — a MUSICAL exit (FIX §10): fade every sounding voice to zero over
      // one cycle, then land on silence. Distinct from PANIC's instant cut; both
      // keep the transport + clock alive.
      if (!engine.ready || !get().playing) {
        await engine.panic();
        set({ playing: false, transportLive: engine.started });
        return;
      }
      const faded = fadeOutScore(effectiveScore(get().score, get().voiceState));
      await engine.evaluate(faded, true);
      set({ playing: false, transportLive: true });
      get().log('HUSH — fading to the downbeat; clock still turning', 'info');
      // `saw` is a per-cycle ramp that hits 0 exactly at the cycle boundary, then
      // resets to 1. So cut at the NEXT downbeat (not a wall-clock full cycle) to
      // land on silence with no snap-back. Extend by a cycle if we're already
      // near the boundary, so the fade isn't imperceptibly short.
      const cps = Math.max(0.05, get().cps);
      const phase = engine.started ? (((engine.now() % 1) + 1) % 1) : 0;
      let remainder = 1 - phase;
      if (remainder < 0.2) remainder += 1;
      setTimeout(() => {
        // silence at the boundary ONLY if HUSH is still in force: not replaying,
        // and the transport is still live (a full stop already silenced it — don't
        // resurrect a stopped scheduler by evaluating `silence`).
        if (!get().playing && get().transportLive) engine.panic();
      }, Math.round((remainder / cps) * 1000));
    },

    setCps: (cps) => {
      engine.setCps(cps);
      // keep the score the source of truth so re-evaluation doesn't snap back
      const rewritten = get().score.replace(/(set[Cc]ps\s*\(\s*)([\d.]+)(\s*\))/, `$1${cps}$3`);
      set({ cps, score: rewritten, voices: buildVoices(rewritten, get().voiceState) });
      if (get().playing) evalCurrent(rewritten);
    },
    nudgeCps: (delta) => {
      const next = Math.max(0.1, +(get().cps + delta).toFixed(3));
      get().setCps(next);
    },

    // -------- voices --------
    selectVoice: (vid) => set({ activeVoiceId: vid }),

    toggleMute: (vid) => {
      const vstate = { ...get().voiceState };
      vstate[vid] = { muted: !vstate[vid]?.muted, solo: vstate[vid]?.solo ?? false };
      set({ voiceState: vstate, voices: buildVoices(get().score, vstate) });
      if (get().playing) evalCurrent(get().score);
    },
    toggleSolo: (vid) => {
      const vstate = { ...get().voiceState };
      vstate[vid] = { solo: !vstate[vid]?.solo, muted: vstate[vid]?.muted ?? false };
      set({ voiceState: vstate, voices: buildVoices(get().score, vstate) });
      if (get().playing) evalCurrent(get().score);
    },

    // -------- the Maestro brain --------
    sendMaestro: async (text) => {
      const trimmed = text.trim();
      if (!trimmed) return;
      const voiceIds = get().voices.map((v) => v.id);
      set((s) => ({ messages: [...s.messages, { id: id('m'), role: 'user', text: trimmed }] }));

      const intent = interpret(trimmed, voiceIds);

      if (intent.kind === 'directive') {
        get().runDirective(intent.id, intent.voiceHint, intent.degree);
        return;
      }
      if (intent.kind === 'command') {
        if (intent.id === 'break') {
          await get().runBreak();
        } else if (intent.id === 'variations') {
          const seed = get().seed;
          // forward the real request so the count (`/variations 4`) and drop
          // keywords reach buildLanes, matching the natural-language path.
          const ls = buildLanes(intent.prompt, get().voices.map((v) => v.id), seed);
          const laneSet: LaneSet = { id: id('ls'), prompt: intent.prompt, lanes: ls, soloId: null, committedId: null, seed };
          set((s) => ({ laneSet, messages: [...s.messages, { id: id('m'), role: 'maestro', shape: 'lanes', laneSetId: laneSet.id, text: `${ls.length} ways offered — solo each against the mix, commit one. Seed \`${seedHex(seed)}\`.` }] }));
        } else if (intent.id === 'explain') {
          await answerTurn(intent.voiceHint ? `explain $${intent.voiceHint}` : 'explain this line');
        }
        return;
      }
      if (intent.kind === 'lanes') {
        const seed = get().seed;
        const ls = buildLanes(intent.prompt, get().voices.map((v) => v.id), seed);
        const laneSet: LaneSet = { id: id('ls'), prompt: intent.prompt, lanes: ls, soloId: null, committedId: null, seed };
        set((s) => ({
          laneSet,
          messages: [
            ...s.messages,
            {
              id: id('m'),
              role: 'maestro',
              shape: 'lanes',
              laneSetId: laneSet.id,
              text: `${ls.length} ways offered — solo each against the mix, refine the keeper, commit one. The rest stay parked in the tree. Seed \`${seedHex(seed)}\` — reproducible.`,
            },
          ],
        }));
        return;
      }
      if (intent.kind === 'answer') {
        await answerTurn(trimmed);
        return;
      }
      // unknown — try the LLM (generation role) if connected, else explain
      const route = provForRole('generation');
      if (route) {
        await llmEditTurn(trimmed, route);
      } else {
        const near = nearestDirectives(trimmed);
        set((s) => ({
          messages: [
            ...s.messages,
            {
              id: id('m'),
              role: 'maestro',
              shape: 'answer',
              text: `I read that as music, not a prompt — so I keep to bounded directives. Closest moves: ${near}. Press **/** for the full palette, or connect a model in Providers for free-form edits.`,
            },
          ],
        }));
      }

      async function answerTurn(q: string) {
        const route2 = provForRole('theory') ?? provForRole('generation');
        if (route2) {
          set({ maestroBusy: true });
          const placeholder = id('m');
          set((s) => ({ messages: [...s.messages, { id: placeholder, role: 'maestro', shape: 'thinking', text: '…', pending: true }] }));
          try {
            const reply = await chat({
              provider: route2.provider,
              model: route2.model,
              system: MAESTRO_SYSTEM + '\nAnswer the question about the music. Do NOT change code; explain it plainly and briefly.',
              user: `Current score:\n${get().score}\n\nQuestion: ${q}${pinnedContext()}`,
            });
            set((s) => ({ messages: s.messages.map((m) => (m.id === placeholder ? { ...m, shape: 'answer', text: reply || localExplain(q), pending: false } : m)) }));
          } catch (e: any) {
            set((s) => ({ messages: s.messages.map((m) => (m.id === placeholder ? { ...m, shape: 'answer', text: localExplain(q), pending: false } : m)) }));
            get().log(`model: ${e?.message ?? e}`, 'error');
          } finally {
            set({ maestroBusy: false });
          }
        } else {
          set((s) => ({ messages: [...s.messages, { id: id('m'), role: 'maestro', shape: 'answer', text: localExplain(q) }] }));
        }
      }

      async function llmEditTurn(req: string, route2: { provider: Provider; model: string }) {
        set({ maestroBusy: true });
        const placeholder = id('m');
        set((s) => ({ messages: [...s.messages, { id: placeholder, role: 'maestro', shape: 'thinking', text: '…', pending: true }] }));
        try {
          const reply = await chat({
            provider: route2.provider,
            model: route2.model,
            system: MAESTRO_SYSTEM,
            user: `Current score:\n\`\`\`\n${stagedBase()}\n\`\`\`\n\nRequest: ${req}${pinnedContext()}`,
          });
          const code = extractCode(reply);
          if (code && code !== get().score) {
            const { thinking } = get().resolveTurnEffort('generation', true);
            const prov: Provenance = { source: 'llm', prompt: req, model: llmModelLabel('generation'), thinking, effort: get().effort, when: Date.now(), cycle: nowCycle() };
            stageEditInternal({ summary: stripCode(reply) || 'Maestro edit.', newCode: code, provenance: prov });
            set((s) => ({ messages: s.messages.map((m) => (m.id === placeholder ? { ...m, shape: 'diff', editId: get().stagedEdit?.id, text: stripCode(reply) || 'Edit staged — auditioning on the next cycle.', pending: false } : m)) }));
          } else {
            set((s) => ({ messages: s.messages.map((m) => (m.id === placeholder ? { ...m, shape: 'answer', text: reply || 'No change.', pending: false } : m)) }));
          }
        } catch (e: any) {
          set((s) => ({ messages: s.messages.map((m) => (m.id === placeholder ? { ...m, shape: 'error', text: `Model error: ${e?.message ?? e}. Directives still work offline.`, pending: false } : m)) }));
        } finally {
          set({ maestroBusy: false });
        }
      }
    },

    runDirective: (directiveId, voiceHint, degree) => {
      // apply against the staged result (if any) so sequential directives stack
      const base = stagedBase();
      const activeVoiceId = get().activeVoiceId;
      const parsed = parseScore(base);
      const voice =
        (voiceHint && parsed.voices.find((v) => v.id === voiceHint)) ||
        parsed.voices.find((v) => v.id === activeVoiceId) ||
        parsed.voices[0];

      // A user-authored directive (spec §10) appends its saved chain fragment to
      // the target voice — deterministic and inspectable like the built-ins.
      const custom = DIRECTIVE_BY_ID[directiveId] ? null : get().customDirectives.find((d) => d.id === directiveId);
      let result: ReturnType<typeof applyDirective>;
      if (custom) {
        if (!voice) result = { error: 'No voice selected — click a voice in the outline, or name one.' };
        else {
          const lines = base.split('\n');
          lines.splice(voice.endLine + 1, 0, `${voice.indent}${custom.chain}`);
          result = { newScore: lines.join('\n'), summary: `${custom.label} on **${voice.sigil}** — \`${custom.chain}\`. ${custom.blurb}` };
        }
      } else {
        result = applyDirective(directiveId, parsed, base, voice, degree);
      }
      if ('error' in result) {
        set((s) => ({ messages: [...s.messages, { id: id('m'), role: 'maestro', shape: 'error', text: result.error }] }));
        get().log(result.error, 'warning');
        return;
      }
      const prov: Provenance = {
        source: 'directive',
        directive: directiveId,
        model: llmModelLabel('directives'),
        when: Date.now(),
        cycle: nowCycle(),
      };
      stageEditInternal({ summary: result.summary, newCode: result.newScore, directive: directiveId, targetVoiceId: voice?.id, provenance: prov });
      set((s) => ({
        messages: [
          ...s.messages,
          { id: id('m'), role: 'maestro', shape: 'diff', editId: get().stagedEdit?.id, text: result.summary },
        ],
      }));
    },

    runBreak: async () => {
      // The flagship agent task (spec §03): several ordered edits that must be
      // heard together — build an 8-bar break. It runs REAL local tools (parse /
      // queryArc / write diff / dry-run), logs each with a timing, states an
      // editable plan, and lands ONE staged, auditioned, reversible diff.
      const base = stagedBase();
      const toolLog: import('../types').ToolCall[] = [];
      const timed = async <T>(glyph: string, name: string, detail: (r: T) => string, fn: () => T | Promise<T>) => {
        const t = performance.now();
        const r = await fn();
        toolLog.push({ id: id('t'), glyph, name, detail: detail(r), ms: Math.round(performance.now() - t), ok: true });
        return r;
      };

      // 1 — parse the AST
      const parsed = await timed('⌗', 'parse AST', (p) => `→ ${p.voices.length} voices`, () => parseScore(base));
      // pick the rhythm section to drop; keep the harmony (pad) through the hole
      const drop = parsed.voices.filter((v) => /drum|bass|kick|perc/.test(v.id) || /\b(bd|sd|kick)\b/.test(v.expr));
      const dropVoices = drop.length ? drop : parsed.voices.slice(0, 2);
      const kept = parsed.voices.filter((v) => !dropVoices.includes(v));

      // 2 — resolve "bars 1–6" against the real pattern via queryArc
      await timed('◷', 'queryArc(0,8)', () => `→ resolved bars 1–6 · ${dropVoices.map((v) => '$' + v.id).join(' ')}`, () => engine.queryEvents(dropVoices[0]?.expr ?? ''));

      // 3 — write the diff: mask the rhythm section out for 6 bars, back for 2,
      // add a riser into the gap, accent the return (sforzando).
      const MASK = '.mask("<0 0 0 0 0 0 1 1>")'; // silent 6 cycles, back for 2
      const lines = base.split('\n');
      const sorted = [...dropVoices].sort((a, b) => b.endLine - a.endLine);
      sorted.forEach((v, i) => {
        // the first (top) drop voice gets a sforzando accent on the hard return
        const chain = i === sorted.length - 1 ? `${MASK}.gain("1.5 1 1 1")` : MASK;
        lines.splice(v.endLine + 1, 0, `${v.indent}${chain}`);
      });
      const riser = `\n$riser: s("white").lpf(sine.range(300, 9000).slow(8)).gain(saw.range(0.04, 0.7).slow(8)).mask("<0 0 0 0 0 0 1 1>")`;
      const newCode = lines.join('\n') + riser;
      await timed('±', 'write diff', () => `→ ${dropVoices.map((v) => '$' + v.id + '.mask').join(', ')}, +$riser`, () => computeHunks(base, newCode).length);

      // 4 — dry-run: transpile the new material so nothing reaches the speakers unvetted
      await timed('♪', 'dry-run audio', (evs: any[]) => (evs.length >= 0 ? '→ no errors' : '→ error'), () => engine.queryEvents('s("white").lpf(sine.range(300, 9000).slow(8))'));

      // snapshot the pre-break mix as a scene so the state is recoverable
      const preBreakLevels: Record<string, number> = {};
      for (const v of get().voices) preBreakLevels[v.id] = v.muted ? 0 : 1;
      set((s) => ({ scenes: [...s.scenes, { id: id('sc'), name: 'pre-break', levels: preBreakLevels, provenance: { source: 'agent', when: Date.now(), cycle: nowCycle() } }] }));

      const plan: import('../types').PlanStep[] = [
        { id: id('ps'), text: 'Snapshot the current mix as scene pre-break', status: 'done' },
        { id: id('ps'), text: `Mask ${dropVoices.map((v) => '$' + v.id).join(' + ')} across bars 1–6`, status: 'done' },
        { id: id('ps'), text: 'Write a 2-bar riser into the gap (bars 7–8)', status: 'done' },
        { id: id('ps'), text: 'Restore on bar 9 with a sforzando accent', status: 'done' },
      ];
      const reasoning =
        'A break needs space, then tension, then release. Mask the rhythm section out for six bars, fill the gap with a riser so the ear has somewhere to go, and restore with an accent so the return lands. ' +
        (kept.length ? `${kept.map((v) => '$' + v.id).join(', ')} carr${kept.length > 1 ? 'y' : 'ies'} the harmony through the hole so the key never disappears.` : '');
      // `thinking` records whether a model's reasoning tier was actually spent
      // (honest: offline/deterministic → false). The visible reasoning TRACE of
      // this deterministic agent follows the effort tier directly — shown in
      // auto/thinking, hidden in fast (spec §12.4) — so it stays useful offline.
      const { thinking } = get().resolveTurnEffort('generation', true);
      const trace = get().effort !== 'fast';
      const prov: Provenance = { source: 'agent', prompt: '/break', model: llmModelLabel('generation') ?? 'deterministic', thinking, effort: get().effort, when: Date.now(), cycle: nowCycle() };

      stageEditInternal({ summary: 'Break staged — rhythm drops for six bars, a riser fills 7–8, everything returns hard on bar 9. Auditioning now; commits on the next phrase.', newCode, directive: 'break', provenance: prov });
      set((s) => ({
        messages: [
          ...s.messages,
          {
            id: id('m'),
            role: 'maestro',
            shape: 'diff',
            editId: get().stagedEdit?.id,
            text: 'Break staged. The rhythm section drops for six bars, a riser fills 7–8, and everything returns on bar 9 with a sforzando. The pad holds the harmony through the gap. *Auditioning now — commits on the next phrase.*',
            // the reasoning TRACE only shows when the effort tier is thinking (spec §12.4:
            // fast = no trace); the plan + tool log are always visible (§03 transparency)
            reasoning: trace ? reasoning : undefined,
            plan,
            toolLog,
          },
        ],
      }));
      get().log('agent · 8-bar break staged', 'success');
    },

    stageEdit: (summary, newCode, opts) => {
      stageEditInternal({ summary, newCode, directive: opts?.directive });
      if (opts?.announce !== false) {
        set((s) => ({
          messages: [...s.messages, { id: id('m'), role: 'maestro', shape: 'diff', editId: get().stagedEdit?.id, text: summary }],
        }));
      }
    },

    acceptEdit: () => {
      const edit = get().stagedEdit;
      if (!edit) return;
      const applied = applyEnabled(edit.oldCode, edit.newCode, get().hunkEnabled);
      const voices = buildVoices(applied, get().voiceState);
      const parsedCps = parseScore(applied).cps;
      set({
        score: applied,
        committed: applied,
        voices,
        stagedEdit: null,
        hunkEnabled: {},
        ...(parsedCps != null ? { cps: parsedCps } : {}),
      });
      // The applied state joins the branchable history, carrying the edit's
      // provenance (prompt/directive/seed/model) — a musical changelog (§07).
      pushCommit(commitLabel(edit), edit.provenance ?? { source: 'you', when: Date.now(), cycle: nowCycle() });
      scheduleTicks();
      if (get().playing) evalCurrent(applied);
      get().log('✓ edit committed on downbeat', 'success');
    },

    rejectEdit: () => {
      const edit = get().stagedEdit;
      if (!edit) return;
      set({ stagedEdit: null, hunkEnabled: {} });
      if (get().playing) evalCurrent(get().score); // revert audition to current score
      get().log('edit rejected', 'info');
    },

    toggleHunk: (hid) => {
      const enabled = { ...get().hunkEnabled };
      enabled[hid] = enabled[hid] === false ? true : false;
      set({ hunkEnabled: enabled });
      // re-audition the new subset
      const edit = get().stagedEdit;
      if (edit && get().playing) {
        evalCurrent(applyEnabled(edit.oldCode, edit.newCode, enabled));
      }
    },

    // -------- variation lanes --------
    soloLane: (laneId) => {
      const ls = get().laneSet;
      if (!ls) return;
      set({ laneSet: { ...ls, soloId: laneId } });
      if (laneId) {
        const lane = ls.lanes.find((l) => l.id === laneId);
        if (lane && get().playing) {
          // audition the fork ON TOP of the running mix (spec §07.2: "solo each
          // against the mix"). Honour the user's real mute/solo; if some live
          // voice is already soloed, mark the lane voice solo too so it survives
          // the anySolo filter and is heard alongside the soloed mix.
          const merged = `${get().score}\n\n${lane.code}`;
          const anyLiveSolo = get().voices.some((v) => v.solo);
          const vstate: Record<string, VState> = { ...get().voiceState, [lane.voiceId]: { solo: anyLiveSolo, muted: false } };
          const eff = effectiveScore(merged, vstate);
          engine.evaluate(eff, true);
        }
      } else if (get().playing) {
        evalCurrent(get().score);
      }
    },

    commitLane: (laneId) => {
      const ls = get().laneSet;
      if (!ls) return;
      const lane = ls.lanes.find((l) => l.id === laneId);
      if (!lane) return;
      const base = get().score; // pre-lane score — the shared parent of every fork
      const preParent = get().headId; // parked forks branch off here, as siblings
      const newScore = `${base}\n\n${lane.code}`;
      const voices = buildVoices(newScore, get().voiceState);
      const prov: Provenance = { source: 'lanes', prompt: ls.prompt, seed: ls.seed, model: llmModelLabel('generation'), when: Date.now(), cycle: nowCycle() };
      set({
        score: newScore,
        committed: newScore,
        voices,
        laneSet: { ...ls, committedId: laneId, soloId: null },
        messages: [
          ...get().messages,
          { id: id('m'), role: 'maestro', shape: 'answer', text: `Committed lane **${lane.label} · ${lane.name}** as ${`\`${lane.voiceId}\``}. The other forks stay parked in the tree — seed \`${seedHex(ls.seed)}\`.` },
        ],
      });
      // Commit the chosen fork (score = base + this lane). The rejected forks
      // become parked stubs off the SAME pre-lane parent, each snapshotting its
      // OWN alternative code so the tree really preserves them (§07).
      pushCommit(`${lane.name} · fork ${lane.label}`, { ...prov }, { parentId: preParent });
      for (const other of ls.lanes) {
        if (other.id !== laneId) {
          pushCommit(`parked · ${other.name}`, { ...prov }, { parked: true, parentId: preParent, score: `${base}\n\n${other.code}` });
        }
      }
      scheduleTicks();
      if (get().playing) evalCurrent(newScore);
      get().log(`committed lane ${lane.label}`, 'success');
    },

    rerollLanes: () => {
      const ls = get().laneSet;
      if (!ls) return;
      // reroll draws a fresh seed by default (the "⚂ new" gesture); the seed
      // controls (reseed) can reproduce or nudge instead.
      const seed = randomSeed();
      const lanes = buildLanes(ls.prompt, get().voices.map((v) => v.id), seed);
      set({ laneSet: { ...ls, lanes, soloId: null, seed }, seed });
      // an audition may be sounding (mix muted) — restore the live mix
      if (ls.soloId && get().playing) evalCurrent(get().score);
    },

    // Refine ONE lane (spec §10: "refine the keeper") — regenerate just that fork
    // from a nudged seed, leaving its siblings untouched. Reproducible per seed.
    refineLane: (laneId) => {
      const ls = get().laneSet;
      if (!ls) return;
      const idx = ls.lanes.findIndex((l) => l.id === laneId);
      if (idx < 0) return;
      const existing = ls.lanes.filter((_, i) => i !== idx).map((l) => l.voiceId);
      const fresh = buildLanes(ls.prompt, [...get().voices.map((v) => v.id), ...existing], (ls.seed + idx + 1) & 0xffff);
      const pick = fresh[idx] ?? fresh[0];
      const lanes = ls.lanes.map((l, i) => (i === idx ? { ...l, name: pick.name, desc: pick.desc, shape: pick.shape, code: `$${l.voiceId}: ${pick.code.replace(/^\$[^:]+:\s*/, '')}` } : l));
      set({ laneSet: { ...ls, lanes } });
      if (ls.soloId === laneId && get().playing) get().soloLane(laneId);
    },

    // -------- scenes / arrangement --------
    snapshotScene: (name) => {
      const levels: Record<string, number> = {};
      const anySolo = get().voices.some((v) => v.solo);
      for (const v of get().voices) {
        const silent = v.muted || (anySolo && !v.solo);
        levels[v.id] = silent ? 0 : 1;
      }
      const scene: Scene = { id: id('sc'), name: name || `scene ${get().scenes.length + 1}`, levels, provenance: { source: 'you', when: Date.now(), cycle: nowCycle() } };
      set((s) => ({ scenes: [...s.scenes, scene], activeSceneId: scene.id }));
      get().log(`scene “${scene.name}” captured`, 'success');
    },

    launchScene: (sceneId) => {
      const scene = get().scenes.find((s) => s.id === sceneId);
      if (!scene) return;
      const vstate: Record<string, VState> = {};
      for (const v of get().voices) {
        vstate[v.id] = { muted: (scene.levels[v.id] ?? 1) === 0, solo: false };
      }
      set({ voiceState: vstate, voices: buildVoices(get().score, vstate), activeSceneId: sceneId });
      if (get().playing) evalCurrent(get().score);
      get().log(`▸ scene “${scene.name}”`, 'info');
    },

    deleteScene: (sceneId) =>
      set((s) => ({ scenes: s.scenes.filter((sc) => sc.id !== sceneId), activeSceneId: s.activeSceneId === sceneId ? null : s.activeSceneId })),

    // -------- providers --------
    setProviderKey: (pid, key) => {
      // Typing a key takes ownership of it from `.env.local` (fromEnv false →
      // it persists normally); clearing it hands the slot back to the env file.
      const providers = get().providers.map((p) =>
        p.id === pid ? { ...p, key, connected: key.trim().length > 0 || !!p.local, fromEnv: false } : p,
      );
      saveProviders(providers);
      set({ providers });
    },
    setProviderModel: (pid, model) => {
      const providers = get().providers.map((p) => (p.id === pid ? { ...p, model } : p));
      saveProviders(providers);
      set({ providers });
    },
    setRoleProvider: (roleId, provider, model) => {
      const roles = get().roles.map((r) =>
        r.id === roleId ? { ...r, provider, model, strength: strengthFor(provider, model) } : r,
      );
      saveRoles(roles);
      set({ roles });
    },
    toggleLocalOnly: () => set((s) => ({ localOnly: !s.localOnly })),

    // -------- maestro agent (spec §12.4) --------
    // The effort toggle is remembered per project (persisted with the blob), so a
    // sketch pad can stay fast while a finished piece sits in thinking.
    setEffort: (e) => {
      set({ effort: e });
      persistProject();
    },
    resolveTurnEffort: (roleId, isTask) => {
      const route = provForRole(roleId);
      const reasoning = route ? hasReasoningTier(route.provider.id, route.model) : false;
      return resolveEffort(get().effort, isTask, reasoning);
    },

    // -------- seeded generation (spec §07) --------
    reseed: (mode) => {
      const cur = get().seed;
      const next = mode === 'same' ? cur : mode === 'nudge' ? (cur + 1) & 0xffff : randomSeed();
      set({ seed: next });
      const ls = get().laneSet;
      if (ls && !ls.committedId) {
        const lanes = buildLanes(ls.prompt, get().voices.map((v) => v.id), next);
        set({ laneSet: { ...ls, lanes, soloId: null, seed: next } });
        if (ls.soloId && get().playing) evalCurrent(get().score);
      }
      get().log(`seed → ${seedHex(next)} (${mode})`, 'info');
    },

    // -------- history / time-travel (spec §07) --------
    rewind: (commitId) => {
      const commit = get().history.find((c) => c.id === commitId);
      if (!commit) return;
      const voices = buildVoices(commit.score, commit.voiceState);
      const parsedCps = parseScore(commit.score).cps;
      // Walk, don't erase: HEAD moves, the score restores, the transport
      // re-evaluates on the next boundary — the music keeps playing (§07).
      set({
        score: commit.score,
        committed: commit.score,
        voiceState: JSON.parse(JSON.stringify(commit.voiceState)),
        scenes: JSON.parse(JSON.stringify(commit.scenes)),
        voices,
        headId: commit.id,
        stagedEdit: null,
        hunkEnabled: {},
        ...(parsedCps != null ? { cps: parsedCps } : {}),
      });
      scheduleTicks();
      if (get().playing) evalCurrent(commit.score);
      get().log(`⏮ rewound to “${commit.label}”`, 'info');
    },

    forkFrom: (commitId) => {
      const commit = get().history.find((c) => c.id === commitId);
      if (!commit) return;
      // Fork = rewind HEAD to that node; the next commit branches off it.
      get().rewind(commitId);
      get().log(`⑂ forked from “${commit.label}” — the next edit branches`, 'info');
    },

    // Reproduce a commit's generation from its STORED seed (spec §07) — restore
    // the global seed and, if the commit came from a prompt, re-roll those lanes
    // identically. Randomness becomes a value you can cite.
    reproduceCommit: (commitId) => {
      const commit = get().history.find((c) => c.id === commitId);
      if (!commit || commit.provenance.seed == null) return;
      const seed = commit.provenance.seed;
      set({ seed });
      const prompt = commit.provenance.prompt;
      if (prompt) {
        const lanes = buildLanes(prompt, get().voices.map((v) => v.id), seed);
        const laneSet: LaneSet = { id: id('ls'), prompt, lanes, soloId: null, committedId: null, seed };
        set((s) => ({
          laneSet,
          surface: null,
          messages: [...s.messages, { id: id('m'), role: 'maestro', shape: 'lanes', laneSetId: laneSet.id, text: `Reproduced from seed \`${seedHex(seed)}\` — the same ${lanes.length} forks, identically.` }],
        }));
      }
      get().log(`reproduced seed ${seedHex(seed)}`, 'info');
    },

    // Merge a branch commit into HEAD, voice-granular (spec §12.6). Disjoint
    // voices union automatically; same-voice edits raise a conflict card. The
    // merged state joins the tree with the branch as a SECOND parent.
    mergeInto: (otherCommitId) => {
      const st = get();
      const ours = st.history.find((c) => c.id === st.headId);
      const theirs = st.history.find((c) => c.id === otherCommitId);
      if (!ours || !theirs || ours.id === theirs.id) return;
      const baseCommit = lca(st.history, ours.id, theirs.id);
      const result = mergeScores(baseCommit?.score ?? ours.score, ours.score, theirs.score);
      if (result.conflicts.length === 0) {
        finalizeMerge(result, theirs, {});
      } else {
        set({ pendingMerge: { ...result, theirsId: theirs.id, theirsLabel: theirs.label } });
      }
    },
    resolveMerge: (choices) => {
      const pm = get().pendingMerge;
      if (!pm) return;
      const theirs = get().history.find((c) => c.id === pm.theirsId);
      set({ pendingMerge: null });
      if (theirs) finalizeMerge(pm, theirs, choices);
    },
    cancelMerge: () => set({ pendingMerge: null }),

    // -------- editor context pins (spec §02, §12.2) --------
    addPin: (pin) => {
      // collapse an identical range; otherwise append in click order. The gutter
      // ORDER (§12.2: "swap these two" is unambiguous) is imposed at the point a
      // turn consumes the pins — see pinnedContext(), which sorts by line.
      const existing = get().pins.find((p) => p.startLine === pin.startLine && p.endLine === pin.endLine);
      if (existing) return existing.id;
      const pinId = id('pin');
      set((s) => ({ pins: [...s.pins, { ...pin, id: pinId }] }));
      return pinId;
    },
    updatePin: (pinId, patch) =>
      set((s) => ({ pins: s.pins.map((p) => (p.id === pinId ? { ...p, ...patch } : p)) })),
    // ⇧-click extends the LAST range to the clicked line (spec §12.2).
    extendLastPin: (endLine) =>
      set((s) => {
        if (!s.pins.length) return {};
        const pins = [...s.pins];
        const last = pins[pins.length - 1];
        const lo = Math.min(last.startLine, endLine);
        const hi = Math.max(last.endLine, endLine);
        pins[pins.length - 1] = { ...last, startLine: lo, endLine: hi, voiceId: undefined };
        return { pins };
      }),
    removePin: (pinId) => set((s) => ({ pins: s.pins.filter((p) => p.id !== pinId) })),
    clearPins: () => set({ pins: [] }),

    // -------- clock-as-target (spec §06) --------
    setArcSelection: (arc) => set({ arcSelection: arc }),
    applyArcToVoice: (voiceId) => {
      const arc = get().arcSelection;
      if (!arc) return;
      const base = stagedBase();
      const parsed = parseScore(base);
      const voice =
        (voiceId && parsed.voices.find((v) => v.id === voiceId)) ||
        parsed.voices.find((v) => v.id === get().activeVoiceId) ||
        parsed.voices[0];
      if (!voice) {
        set((s) => ({ messages: [...s.messages, { id: id('m'), role: 'maestro', shape: 'error', text: 'No voice to scope — pick one in the outline first.' }] }));
        return;
      }
      const { pattern, label } = arcToMask(arc);
      const lines = base.split('\n');
      lines.splice(voice.endLine + 1, 0, `${voice.indent}.mask("${pattern}")`);
      const prov: Provenance = { source: 'directive', directive: 'mask', when: Date.now(), cycle: nowCycle() };
      stageEditInternal({
        summary: `Scoped **${voice.sigil}** to ${label} — \`.mask("${pattern}")\`. Dragged on the cycle.`,
        newCode: lines.join('\n'),
        directive: 'mask',
        targetVoiceId: voice.id,
        provenance: prov,
      });
      set((s) => ({
        arcSelection: null,
        messages: [...s.messages, { id: id('m'), role: 'maestro', shape: 'diff', editId: get().stagedEdit?.id, text: `Scoped **${voice.sigil}** to ${label} — \`.mask("${pattern}")\`.` }],
      }));
    },

    // -------- stage lenses (spec §05, §12.1, §12.5) --------
    toggleLens: (id2) =>
      set((s) => ({ lenses: s.lenses.includes(id2) ? s.lenses.filter((l) => l !== id2) : [...s.lenses, id2] })),
    // The inline mini-roll cycles per voice: roll → spark → off (spec §12.5).
    cycleMiniRoll: (voiceId) =>
      set((s) => {
        const cur = s.miniRoll[voiceId] ?? 'roll';
        const next: MiniRollMode = cur === 'roll' ? 'spark' : cur === 'spark' ? 'off' : 'roll';
        return { miniRoll: { ...s.miniRoll, [voiceId]: next } };
      }),

    // -------- device prefs (spec §12.3, §12.7, §12.8) --------
    setTransportKey: (k) => {
      // one-time "this will need to override reload" notice on the first F5 opt-in
      // (spec §12.3); the flag latches so the notice never fires twice.
      const firstF5 = k === 'f5' && !get().f5NoticeSeen;
      const f5NoticeSeen = get().f5NoticeSeen || k === 'f5';
      set({ transportKey: k, f5NoticeSeen });
      savePrefs({ transportKey: k, motion: get().motion, f5NoticeSeen });
      if (firstF5) {
        get().log('F5 now plays/pauses — it overrides the browser reload key. Switch back in Settings → Keymap anytime.', 'warning');
      } else {
        get().log(k === 'f5' ? 'transport → F5' : 'transport → ⌘⇧⏎', 'info');
      }
    },
    setMotion: (m) => {
      set({ motion: m });
      savePrefs({ transportKey: get().transportKey, motion: m, f5NoticeSeen: get().f5NoticeSeen });
      get().applyMotion();
      get().log(`motion → ${m}`, 'info');
    },
    // Reflect the resolved reduced-motion state onto <html> so CSS can respond
    // (decorative keyframes stop; information-bearing motion is handled in JS).
    applyMotion: () => {
      try {
        document.documentElement.setAttribute('data-reduced-motion', motionIsReduced(get().motion) ? 'on' : 'off');
      } catch {
        /* no DOM (tests) */
      }
    },
    toggleMidi: async () => {
      if (get().midiOn) {
        midi.allNotesOff();
        midi.disable(); // stop the clock loop, not just the flag
        set({ midiOn: false });
        get().log('MIDI sync-out off', 'info');
        return;
      }
      const ok = await midi.enable();
      set({ midiOn: ok });
      get().log(ok ? 'MIDI sync-out on — the Cycle is the master' : `MIDI unavailable: ${midi.error ?? 'no access'}`, ok ? 'success' : 'warning');
    },

    // -------- the Prompter (spec §04) --------
    refreshPrompter: () => {
      if (get().prompterMuted) {
        set({ prompterCards: [] });
        return;
      }
      const cards = observePrompter(get().voices, get().events, get().prompterDismissed);
      set({ prompterCards: cards });
    },
    tryCard: (cardId) => {
      const card = get().prompterCards.find((c) => c.id === cardId);
      if (!card) return;
      if (card.voiceId) get().selectVoice(card.voiceId);
      if (card.action === 'directive') get().runDirective(card.payload, card.voiceId);
      else get().sendMaestro(card.payload);
      set((s) => ({ prompterCards: s.prompterCards.filter((c) => c.id !== cardId) }));
    },
    dismissCard: (cardId) =>
      set((s) => {
        const card = s.prompterCards.find((c) => c.id === cardId);
        // learn the "no": quiet this KIND for the rest of the session (§04)
        const dismissed = card && !s.prompterDismissed.includes(card.kind) ? [...s.prompterDismissed, card.kind] : s.prompterDismissed;
        return { prompterCards: s.prompterCards.filter((c) => c.id !== cardId), prompterDismissed: dismissed };
      }),
    togglePrompter: () => set((s) => ({ prompterMuted: !s.prompterMuted, prompterCards: !s.prompterMuted ? [] : s.prompterCards })),

    // -------- author-your-own directives (spec §10) --------
    addCustomDirective: (d) => {
      const dir: CustomDirective = { ...d, id: `u_${d.label.toLowerCase().replace(/[^a-z0-9]+/g, '') || id('u')}` };
      const next = [...get().customDirectives.filter((x) => x.id !== dir.id), dir];
      saveCustomDirectives(next);
      set({ customDirectives: next });
      get().log(`directive “${dir.label}” bound`, 'success');
    },
    removeCustomDirective: (cid) => {
      const next = get().customDirectives.filter((d) => d.id !== cid);
      saveCustomDirectives(next);
      set({ customDirectives: next });
    },

    // -------- projects (spec §08) --------
    hydrateFromStorage: () => {
      const activeId = activeProjectId();
      const blob = activeId ? loadProject(activeId) : null;
      if (blob) {
        applyBlob(blob);
        get().log(`project “${blob.name}” opened · ${blob.history.filter((c) => !c.parked).length} commits`, 'info');
      } else {
        // first run: adopt the seeded default as project "nightjar" and persist it
        setActiveProjectId('nightjar');
        persistProject();
      }
      set({ projects: listProjects() });
    },

    newProject: (name) => {
      const pid = `p${Date.now().toString(36)}`;
      const root: Commit = { id: id('c'), parentId: null, label: `init · ${name}`, score: DEFAULT_SCORE, voiceState: {}, scenes: [], provenance: { source: 'init', when: Date.now() } };
      setActiveProjectId(pid);
      set({
        projectId: pid,
        projectName: name,
        score: DEFAULT_SCORE,
        committed: DEFAULT_SCORE,
        voiceState: {},
        voices: buildVoices(DEFAULT_SCORE, {}),
        scenes: [],
        activeSceneId: null,
        history: [root],
        headId: root.id,
        stagedEdit: null,
        hunkEnabled: {},
        laneSet: null,
        seed: randomSeed(),
        pins: [],
        arcSelection: null,
      });
      scheduleTicks();
      if (get().playing) evalCurrent(DEFAULT_SCORE);
      persistProject();
      get().log(`new project “${name}”`, 'success');
    },

    openProject: (pid) => {
      const blob = loadProject(pid);
      if (!blob) return;
      setActiveProjectId(pid);
      applyBlob(blob);
      set({ projects: listProjects() });
      if (get().playing) evalCurrent(blob.score);
      get().log(`▸ project “${blob.name}”`, 'info');
    },

    renameProject: (name) => {
      set({ projectName: name });
      persistProject();
    },

    saveCheckpoint: (name) => {
      // ⌘S tags a named checkpoint (autosave already persists continuously §08).
      // force:true so it bookmarks the moment even when the code equals HEAD.
      pushCommit(name?.trim() || `checkpoint · ${new Date().toLocaleTimeString()}`, { source: 'you', when: Date.now(), cycle: nowCycle() }, { force: true });
      get().log('✓ checkpoint saved', 'success');
    },

    log: (text, type = 'info') =>
      set((s) => ({ logs: [...s.logs.slice(-80), { id: id('l'), text, type }] })),
  };

  // ---- internal: stage an edit (shared by directive + LLM paths) ----
  function stageEditInternal(args: { summary: string; newCode: string; directive?: string; targetVoiceId?: string; provenance?: Provenance }) {
    const oldCode = get().score;
    const hunks = computeHunks(oldCode, args.newCode);
    const enabled: Record<string, boolean> = {};
    hunks.forEach((h) => (enabled[h.id] = true));
    const edit: StagedEdit = {
      id: id('e'),
      summary: args.summary,
      directive: args.directive,
      oldCode,
      newCode: args.newCode,
      hunks,
      auditioning: get().playing,
      targetVoiceId: args.targetVoiceId,
      provenance: args.provenance ?? { source: args.directive ? 'directive' : 'you', directive: args.directive, when: Date.now(), cycle: nowCycle() },
    };
    set({ stagedEdit: edit, hunkEnabled: enabled });
    if (get().playing) {
      const eff = effectiveScore(applyEnabled(oldCode, args.newCode, enabled), get().voiceState);
      engine.evaluate(eff, true);
    }
  }

  /**
   * Finalize a voice-granular merge (spec §12.6): apply the resolved score,
   * commit it with the branch as a second parent, and — for voices resolved
   * "layer as lanes" / "audition both" — offer the branch's take as an alt lane.
   */
  function finalizeMerge(result: MergeResult, theirs: Commit, choices: Record<string, ConflictChoice>) {
    const merged = applyResolutions(result, choices);
    const voices = buildVoices(merged, get().voiceState);
    const parsedCps = parseScore(merged).cps;
    // global settings (scenes) merge last-writer-wins: HEAD keeps its scenes and
    // gains any the branch added; the loser survives in the branch commit (§12.6).
    const ourNames = new Set(get().scenes.map((s) => s.name));
    const mergedScenes = [...get().scenes, ...(theirs.scenes ?? []).filter((s) => !ourNames.has(s.name))];
    set({ score: merged, committed: merged, voices, scenes: mergedScenes, stagedEdit: null, hunkEnabled: {}, ...(parsedCps != null ? { cps: parsedCps } : {}) });
    pushCommit(`merge · ${theirs.label}`, { source: 'merge', prompt: `merge ${theirs.label}`, when: Date.now(), cycle: nowCycle() }, { mergeParentId: theirs.id, force: true });
    scheduleTicks();
    if (get().playing) evalCurrent(merged);

    const layer = result.conflicts.filter((c) => (choices[c.voiceId] === 'lanes' || choices[c.voiceId] === 'audition') && c.theirs);
    if (layer.length) {
      const seed = get().seed;
      const lanes = layer.map((c, i) => {
        const altId = `${c.voiceId}_alt`;
        const body = (c.theirs as string).replace(/^\s*\$[^:]+:\s*/, '');
        return { id: id('ln'), label: String.fromCharCode(65 + i), name: `${c.voiceId} · their take`, desc: 'from the merged branch', voiceId: altId, code: `$${altId}: ${body}`, shape: 'flat' as const };
      });
      const laneSet: LaneSet = { id: id('ls'), prompt: `audition merged ${layer.map((c) => '$' + c.voiceId).join(' ')}`, lanes, soloId: null, committedId: null, seed };
      set((s) => ({ laneSet, messages: [...s.messages, { id: id('m'), role: 'maestro', shape: 'lanes', laneSetId: laneSet.id, text: `Merged **${theirs.label}**. Their take on ${layer.map((c) => '`$' + c.voiceId + '`').join(', ')} is parked as a lane — solo to A/B, commit to keep.` }] }));
    } else {
      const n = result.clean.length;
      set((s) => ({ messages: [...s.messages, { id: id('m'), role: 'maestro', shape: 'answer', text: `Merged **${theirs.label}** into HEAD — ${n} voice${n === 1 ? '' : 's'} unioned cleanly${result.conflicts.length ? `, ${result.conflicts.length} conflict${result.conflicts.length === 1 ? '' : 's'} resolved by ear` : ''}. Committed on the next phrase.` }] }));
    }
    get().log(`merged “${theirs.label}”`, 'success');
  }

  /** A short, human commit label from a staged edit's summary/directive. */
  function commitLabel(edit: StagedEdit): string {
    if (edit.directive) return `/${edit.directive}${edit.targetVoiceId ? ` $${edit.targetVoiceId}` : ''}`;
    const plain = edit.summary.replace(/[*`]/g, '').split(/[.—]/)[0].trim();
    return plain.slice(0, 42) || 'edit';
  }

  function localExplain(q: string): string {
    const v = get().voices.find((vv) => new RegExp(`\\b\\$?${vv.id}\\b`).test(q.toLowerCase())) ?? get().voices.find((vv) => vv.id === get().activeVoiceId);
    if (!v) return 'Pick a voice in the outline and ask again — I’ll read that line as music.';
    return `**${v.sigil}** reads as: ${describeExpr(v.expr)}. (Connect a model in Providers for a fuller theory read-out.)`;
  }

  function nearestDirectives(_t: string): string {
    return ['swing', 'half-time', 'darker', 'crescendo', 'octave down']
      .map((s) => `*${s}*`)
      .join(', ');
  }
});

// ---- voice-granular merge: lowest common ancestor of two commits (spec §12.6) ----
function lca(history: Commit[], aId: string, bId: string): Commit | null {
  const byId = new Map(history.map((c) => [c.id, c]));
  const ancestors = new Set<string>();
  let cur: Commit | undefined = byId.get(aId);
  while (cur) {
    ancestors.add(cur.id);
    cur = cur.parentId ? byId.get(cur.parentId) : undefined;
  }
  let b: Commit | undefined = byId.get(bId);
  while (b) {
    if (ancestors.has(b.id)) return b;
    b = b.parentId ? byId.get(b.parentId) : undefined;
  }
  return null;
}

// ---- clock-as-target: an arc span → a within-cycle .mask() pattern (spec §06) ----
function arcToMask(arc: ArcSelection): { pattern: string; label: string } {
  const N = 8; // quantize handles to eighths of the cycle
  const norm = (x: number) => ((x % 1) + 1) % 1;
  const s = norm(arc.start);
  const e = norm(arc.end);
  const on: number[] = [];
  for (let i = 0; i < N; i++) {
    const c = (i + 0.5) / N;
    const inside = s < e ? c >= s && c < e : c >= s || c < e; // wrap-around span
    on.push(inside ? 1 : 0);
  }
  const approx = (a: number, b: number) => Math.abs(a - b) < 0.07;
  let label = 'the selected span';
  if (approx(s, 0) && approx(e, 0.5)) label = 'the front half';
  else if (approx(s, 0.5) && (approx(e, 1) || approx(e, 0))) label = 'the back half';
  else if (approx(s, 0) && approx(e, 0.25)) label = 'the first beat';
  else if (approx(s, 0.75) && (approx(e, 1) || approx(e, 0))) label = 'the last beat';
  return { pattern: on.join(' '), label };
}

// ---- the Prompter: bounded musical observations against the parsed tree (§04) ----
function observePrompter(
  voices: Voice[],
  _events: Record<string, EngineEvent[]>,
  dismissed: string[],
): PrompterCard[] {
  const cards: PrompterCard[] = [];
  const live = (k: string) => !dismissed.includes(k);

  // static: a pitched/pad voice with no LFO movement. We key off actual
  // modulation — a signal being scaled (`.range(`) or perlin/rand — NOT the
  // signal words themselves, which double as oscillator names (sawtooth/
  // triangle/square) and would mis-flag every synth voice as "moving".
  if (live('static')) {
    const stat = voices.find(
      (v) => /note\(|<[^>]*>/.test(v.expr) && !/\.range\(|\bperlin\b|\brand\b/.test(v.expr),
    );
    if (stat)
      cards.push({
        id: `pc-static-${stat.id}`,
        kind: 'static',
        glyph: '◷',
        text: `${stat.sigil} has been static — open the filter?`,
        code: '.lpf(sine.range(500,2400).slow(8))',
        voiceId: stat.id,
        action: 'directive',
        payload: 'brighter',
      });
  }
  // clash: two or more pitched voices sharing register → offer to voice-lead
  if (live('clash')) {
    const pitched = voices.filter((v) => /note\(|\bn\(/.test(v.expr));
    if (pitched.length >= 2) {
      const target = pitched[pitched.length - 1];
      cards.push({
        id: `pc-clash-${target.id}`,
        kind: 'clash',
        glyph: '⧉',
        text: `${target.sigil} & ${pitched[0].sigil} share register — thin one out?`,
        code: '.degradeBy(0.3)',
        voiceId: target.id,
        action: 'directive',
        payload: 'sparser',
      });
    }
  }
  // empty: a sparse percussion voice → a ghost hit adds motion
  if (live('empty')) {
    const perc = voices.find((v) => /\bs\("/.test(v.expr) && v.events <= 4);
    if (perc)
      cards.push({
        id: `pc-empty-${perc.id}`,
        kind: 'empty',
        glyph: '♪',
        text: `${perc.sigil} is sparse — add a swung ghost?`,
        code: '.swingBy(1/3, 8)',
        voiceId: perc.id,
        action: 'directive',
        payload: 'swing',
      });
  }
  return cards.slice(0, 3);
}

// ---- tiny offline "explain this line as music" ----
function describeExpr(expr: string): string {
  const bits: string[] = [];
  if (/\bnote\(|\bn\(/.test(expr)) {
    const m = expr.match(/note\("([^"]+)"\)/);
    if (m) bits.push(`the pitches \`${m[1]}\``);
  }
  const snd = expr.match(/\.s\("([^"]+)"\)|^s\("([^"]+)"\)|\bs\("([^"]+)"\)/);
  if (snd) bits.push(`sound \`${snd[1] || snd[2] || snd[3]}\``);
  if (/lpf\(/.test(expr)) bits.push('a low-pass filter (it shapes brightness)');
  if (/room\(/.test(expr)) bits.push('reverb for space');
  if (/slow\(/.test(expr)) bits.push('stretched over several cycles');
  if (/gain\(/.test(expr)) bits.push('a shaped level');
  if (/swingBy\(/.test(expr)) bits.push('a swing feel');
  return bits.length ? bits.join(', ') : 'a Strudel pattern';
}

function stripCode(text: string): string {
  return text.replace(/```[\s\S]*?```/g, '').trim();
}

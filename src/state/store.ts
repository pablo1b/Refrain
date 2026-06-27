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
} from '../types';
import { engine, type EngineStatus } from '../audio/strudelEngine';
import { parseScore } from '../music/parseScore';
import { applyDirective, interpret, DIRECTIVE_BY_ID } from '../music/directives';
import { computeHunks, applyEnabled } from '../music/diff';
import { colorForVoice, cssVar } from '../theme/tokens';
import {
  loadProviders,
  saveProviders,
  loadRoles,
  saveRoles,
  strengthFor,
  chat,
  extractCode,
  MAESTRO_SYSTEM,
} from '../llm/providers';
import { buildLanes } from '../music/lanes';

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

  playing: boolean;
  cps: number;
  engineStatus: EngineStatus;
  engineError: string | null;

  messages: MaestroMessage[];
  maestroBusy: boolean;

  stagedEdit: StagedEdit | null;
  hunkEnabled: Record<string, boolean>;

  laneSet: LaneSet | null;

  scenes: Scene[];
  activeSceneId: string | null;

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
  stageEdit: (summary: string, newCode: string, opts?: { directive?: string; announce?: boolean }) => void;
  acceptEdit: () => void;
  rejectEdit: () => void;
  toggleHunk: (hid: string) => void;

  soloLane: (laneId: string | null) => void;
  commitLane: (laneId: string) => void;
  rerollLanes: () => void;

  snapshotScene: (name: string) => void;
  launchScene: (sceneId: string) => void;
  deleteScene: (sceneId: string) => void;

  setProviderKey: (pid: Provider['id'], key: string) => void;
  setProviderModel: (pid: Provider['id'], model: string) => void;
  setRoleProvider: (roleId: RoleRoute['id'], provider: Provider['id'], model: string) => void;
  toggleLocalOnly: () => void;

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
  // recompute clock ticks for the current voices (debounced, async)
  async function recomputeTicks() {
    const token = ++tickToken;
    const voices = get().voices;
    if (!engine.ready) return;
    const out: Record<string, number[]> = {};
    for (const v of voices) {
      out[v.id] = await engine.queryTicks(v.expr);
      if (token !== tickToken) return; // superseded
    }
    set({ ticks: out });
  }
  function scheduleTicks() {
    if (tickTimer) clearTimeout(tickTimer);
    tickTimer = setTimeout(recomputeTicks, 220);
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

  /** The code a new edit should build on — the current staged result if one is
   *  pending (so sequential directives stack), otherwise the committed score. */
  function stagedBase(): string {
    const e = get().stagedEdit;
    return e ? applyEnabled(e.oldCode, e.newCode, get().hunkEnabled) : get().score;
  }

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

    playing: false,
    cps: 0.5,
    engineStatus: 'idle',
    engineError: null,

    messages: [
      {
        id: id('m'),
        role: 'maestro',
        text: "I'm the Maestro. Type a pattern, or speak music — *make the hats swing*, *bring the bass down an octave*, *three ways into the drop*. Press **/** for the directive palette. Every change is a diff you can read and undo.",
        shape: 'answer',
      },
    ],
    maestroBusy: false,

    stagedEdit: null,
    hunkEnabled: {},

    laneSet: null,

    scenes: [],
    activeSceneId: null,

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
        recomputeTicks();
      } else {
        get().log(`engine error: ${engine.error}`, 'error');
      }
    },

    setScore: (code, opts) => {
      const voices = buildVoices(code, get().voiceState);
      set({ score: code, voices });
      scheduleTicks();
      if (opts?.reaudition && get().playing) evalCurrent(code);
    },

    play: async () => {
      if (!engine.ready) await get().initAudio();
      const toPlay = get().stagedEdit
        ? applyEnabled(get().stagedEdit!.oldCode, get().stagedEdit!.newCode, get().hunkEnabled)
        : get().score;
      await evalCurrent(toPlay);
      set({ playing: true });
      get().log('▶ transport running', 'info');
      recomputeTicks();
    },

    stop: () => {
      engine.stop();
      set({ playing: false });
      get().log('⏹ transport stopped', 'info');
    },

    togglePlay: async () => {
      if (get().playing) get().stop();
      else await get().play();
    },

    panic: async () => {
      await engine.panic();
      set({ playing: false });
      get().log('PANIC — all voices hushed; clock safe', 'warning');
    },

    hush: async () => {
      // softer cousin of PANIC: silence the voices but keep the clock; routed
      // through the store so transport/meters stay honest.
      await engine.panic();
      set({ playing: false });
      get().log('HUSH — voices silenced; clock safe', 'info');
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
      if (intent.kind === 'lanes') {
        const ls = buildLanes(intent.prompt, get().voices.map((v) => v.id));
        const laneSet: LaneSet = { id: id('ls'), prompt: intent.prompt, lanes: ls, soloId: null, committedId: null };
        set((s) => ({
          laneSet,
          messages: [
            ...s.messages,
            {
              id: id('m'),
              role: 'maestro',
              shape: 'lanes',
              laneSetId: laneSet.id,
              text: `${ls.length} ways offered — solo each against the mix, refine the keeper, commit one. The rest stay parked in the tree.`,
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
              user: `Current score:\n${get().score}\n\nQuestion: ${q}`,
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
            user: `Current score:\n\`\`\`\n${stagedBase()}\n\`\`\`\n\nRequest: ${req}`,
          });
          const code = extractCode(reply);
          if (code && code !== get().score) {
            stageEditInternal({ summary: stripCode(reply) || 'Maestro edit.', newCode: code });
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

      const result = applyDirective(directiveId, parsed, base, voice, degree);
      if ('error' in result) {
        set((s) => ({ messages: [...s.messages, { id: id('m'), role: 'maestro', shape: 'error', text: result.error }] }));
        get().log(result.error, 'warning');
        return;
      }
      stageEditInternal({ summary: result.summary, newCode: result.newScore, directive: directiveId, targetVoiceId: voice?.id });
      const dir = DIRECTIVE_BY_ID[directiveId];
      set((s) => ({
        messages: [
          ...s.messages,
          { id: id('m'), role: 'maestro', shape: 'diff', editId: get().stagedEdit?.id, text: result.summary + (dir ? '' : '') },
        ],
      }));
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
      const newScore = `${get().score}\n\n${lane.code}`;
      const voices = buildVoices(newScore, get().voiceState);
      set({
        score: newScore,
        committed: newScore,
        voices,
        laneSet: { ...ls, committedId: laneId, soloId: null },
        messages: [
          ...get().messages,
          { id: id('m'), role: 'maestro', shape: 'answer', text: `Committed lane **${lane.label} · ${lane.name}** as ${`\`${lane.voiceId}\``}. The other forks stay parked in the tree.` },
        ],
      });
      scheduleTicks();
      if (get().playing) evalCurrent(newScore);
      get().log(`committed lane ${lane.label}`, 'success');
    },

    rerollLanes: () => {
      const ls = get().laneSet;
      if (!ls) return;
      const lanes = buildLanes(ls.prompt, get().voices.map((v) => v.id), true);
      set({ laneSet: { ...ls, lanes, soloId: null } });
      // an audition may be sounding (mix muted) — restore the live mix
      if (ls.soloId && get().playing) evalCurrent(get().score);
    },

    // -------- scenes / arrangement --------
    snapshotScene: (name) => {
      const levels: Record<string, number> = {};
      const anySolo = get().voices.some((v) => v.solo);
      for (const v of get().voices) {
        const silent = v.muted || (anySolo && !v.solo);
        levels[v.id] = silent ? 0 : 1;
      }
      const scene: Scene = { id: id('sc'), name: name || `scene ${get().scenes.length + 1}`, levels };
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
      const providers = get().providers.map((p) => (p.id === pid ? { ...p, key, connected: key.trim().length > 0 || !!p.local } : p));
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

    log: (text, type = 'info') =>
      set((s) => ({ logs: [...s.logs.slice(-80), { id: id('l'), text, type }] })),
  };

  // ---- internal: stage an edit (shared by directive + LLM paths) ----
  function stageEditInternal(args: { summary: string; newCode: string; directive?: string; targetVoiceId?: string }) {
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
    };
    set({ stagedEdit: edit, hunkEnabled: enabled });
    if (get().playing) {
      const eff = effectiveScore(applyEnabled(oldCode, args.newCode, enabled), get().voiceState);
      engine.evaluate(eff, true);
    }
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

// ---------------------------------------------------------------------------
// Bring-your-own-key model access (spec §07.8). Keys live in localStorage
// here (the spec's desktop build would use the OS keychain). Roles map to
// models so cheap/fast handles directives and a strong model handles
// generation & theory. `local-only` mode stops every network call.
// The Maestro is fully functional with NO keys — directives & lanes are
// deterministic; the LLM is an enhancement for free-form requests.
// ---------------------------------------------------------------------------

import type { Provider, RoleRoute, MaestroEffort } from '../types';

export function defaultProviders(): Provider[] {
  return [
    { id: 'anthropic', label: 'Anthropic', key: '', model: 'claude-sonnet-4-6', connected: false },
    { id: 'openai', label: 'OpenAI', key: '', model: 'gpt-4o', connected: false },
    { id: 'google', label: 'Google', key: '', model: 'gemini-flash-lite-latest', connected: false },
    { id: 'ollama', label: 'Ollama', key: '', model: 'llama3', endpoint: 'http://127.0.0.1:11434', connected: false, local: true },
  ];
}

export function defaultRoles(): RoleRoute[] {
  return [
    { id: 'directives', label: 'Directives & completions', provider: 'anthropic', model: 'claude-haiku-4-5', strength: 'fast' },
    { id: 'generation', label: 'Generation & lanes', provider: 'anthropic', model: 'claude-sonnet-4-6', strength: 'strong' },
    { id: 'theory', label: 'Theory & arrangement', provider: 'anthropic', model: 'claude-sonnet-4-6', strength: 'strong' },
    { id: 'offline', label: 'Offline fallback', provider: 'ollama', model: 'llama3', strength: 'local' },
  ];
}

/** Selectable models per provider (first entry is each provider's default). */
export const MODEL_OPTIONS: Record<Provider['id'], string[]> = {
  anthropic: ['claude-opus-4-8', 'claude-sonnet-4-6', 'claude-haiku-4-5'],
  openai: ['gpt-4o', 'gpt-4o-mini', 'o3', 'o3-mini'],
  // Gemini Flash family; -latest aliases track current
  google: [
    'gemini-flash-lite-latest',
    'gemini-flash-latest',
    'gemini-3.5-flash',
    'gemini-3.1-flash-lite',
    'gemini-2.5-flash',
    'gemini-2.5-flash-lite',
  ],
  ollama: ['llama3', 'llama3.1', 'mistral', 'qwen2.5', 'phi3'],
};

/** Heuristic strength tag from the chosen provider/model (drives chip colour). */
export function strengthFor(provider: Provider['id'], model: string): RoleRoute['strength'] {
  if (provider === 'ollama') return 'local';
  return /haiku|mini|flash|small|phi/i.test(model) ? 'fast' : 'strong';
}

/**
 * Cost (filled squares 0..3) + latency for a model — routing made legible
 * (spec §09). The right choice depends on how often a role fires: completions
 * run every keystroke, theory runs once in a while. Spend accordingly.
 */
export function modelBadge(model: string): { cost: number; latency: string } {
  if (/opus/i.test(model)) return { cost: 3, latency: '~900ms' };
  if (/sonnet/i.test(model)) return { cost: 3, latency: '~700ms' };
  if (/haiku/i.test(model)) return { cost: 1, latency: '~140ms' };
  if (/flash-lite/i.test(model)) return { cost: 1, latency: '~80ms' };
  if (/flash/i.test(model)) return { cost: 1, latency: '~90ms' };
  if (/mini/i.test(model)) return { cost: 2, latency: '~220ms' };
  if (/gpt-4o|o3/i.test(model)) return { cost: 3, latency: '~600ms' };
  if (/llama|mistral|qwen|phi/i.test(model)) return { cost: 0, latency: 'varies' };
  return { cost: 2, latency: '~300ms' };
}

/**
 * Which provider/model exposes a reasoning ("thinking") tier (spec §12.4). This
 * is what lets the fast/thinking toggle move the effort tier *within* the role's
 * model. A vendor with no reasoning tier greys the toggle to fast — so routing
 * and the toggle can never contradict.
 */
export function hasReasoningTier(provider: Provider['id'], model: string): boolean {
  if (provider === 'anthropic') return true; // extended thinking on opus/sonnet/haiku
  if (provider === 'openai') return /^o\d/i.test(model); // o3 / o3-mini reason; 4o does not
  return false; // gemini flash, local llama: no dedicated reasoning tier
}

/**
 * Reconcile the per-turn effort toggle with the routing table (spec §12.4).
 * Routing owns the vendor/model per role; the toggle only moves the EFFORT TIER
 * within it, never the vendor. `auto` lets the role decide — tasks think,
 * directives don't. If the role's model has no reasoning tier, effort collapses
 * to fast (the toggle is greyed in the UI).
 */
export function resolveEffort(
  effort: MaestroEffort,
  isTask: boolean,
  reasoning: boolean,
): { thinking: boolean; trace: boolean } {
  if (!reasoning || effort === 'fast') return { thinking: false, trace: false };
  if (effort === 'thinking') return { thinking: true, trace: true };
  return { thinking: isTask, trace: isTask }; // auto
}

/** Plain-language recommendation per role — because the right answer depends
 *  entirely on how often the role fires (spec §09). */
export const ROLE_RECOMMENDATION: Record<RoleRoute['id'], { note: string; spend: boolean }> = {
  directives: { note: 'fast & cheap — bounded transforms, fires on every turn', spend: false },
  generation: { note: 'strong — judgement pays off for new material', spend: true },
  theory: { note: 'strong + reasoning — rare, worth it', spend: true },
  offline: { note: 'private — the network is gone', spend: false },
};

const LS_KEY = 'refrain.providers';
const LS_ROLES = 'refrain.roles';

export function loadProviders(): Provider[] {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return defaultProviders();
    const saved = JSON.parse(raw) as Provider[];
    // merge over defaults so new fields appear
    return defaultProviders().map((d) => ({ ...d, ...saved.find((s) => s.id === d.id) }));
  } catch {
    return defaultProviders();
  }
}

export function saveProviders(ps: Provider[]) {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(ps));
  } catch {
    /* noop */
  }
}

export function loadRoles(): RoleRoute[] {
  try {
    const raw = localStorage.getItem(LS_ROLES);
    if (!raw) return defaultRoles();
    const saved = JSON.parse(raw) as RoleRoute[];
    return defaultRoles().map((d) => ({ ...d, ...saved.find((s) => s.id === d.id) }));
  } catch {
    return defaultRoles();
  }
}

export function saveRoles(rs: RoleRoute[]) {
  try {
    localStorage.setItem(LS_ROLES, JSON.stringify(rs));
  } catch {
    /* noop */
  }
}

export interface ChatOpts {
  provider: Provider;
  model: string;
  system: string;
  user: string;
  signal?: AbortSignal;
}

/** Single-shot chat completion. Throws on any failure. */
export async function chat({ provider, model, system, user, signal }: ChatOpts): Promise<string> {
  switch (provider.id) {
    case 'anthropic': {
      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-api-key': provider.key,
          'anthropic-version': '2023-06-01',
          'anthropic-dangerous-direct-browser-access': 'true',
        },
        body: JSON.stringify({
          model,
          max_tokens: 1024,
          system,
          messages: [{ role: 'user', content: user }],
        }),
        signal,
      });
      if (!res.ok) throw new Error(`Anthropic ${res.status}: ${(await res.text()).slice(0, 160)}`);
      const data = await res.json();
      return (data.content?.[0]?.text ?? '').trim();
    }
    case 'openai': {
      const res = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${provider.key}` },
        body: JSON.stringify({
          model,
          messages: [
            { role: 'system', content: system },
            { role: 'user', content: user },
          ],
        }),
        signal,
      });
      if (!res.ok) throw new Error(`OpenAI ${res.status}: ${(await res.text()).slice(0, 160)}`);
      const data = await res.json();
      return (data.choices?.[0]?.message?.content ?? '').trim();
    }
    case 'google': {
      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${provider.key}`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            systemInstruction: { parts: [{ text: system }] },
            contents: [{ role: 'user', parts: [{ text: user }] }],
          }),
          signal,
        },
      );
      if (!res.ok) throw new Error(`Google ${res.status}: ${(await res.text()).slice(0, 160)}`);
      const data = await res.json();
      return (data.candidates?.[0]?.content?.parts?.[0]?.text ?? '').trim();
    }
    case 'ollama': {
      const res = await fetch(`${provider.endpoint ?? 'http://127.0.0.1:11434'}/api/chat`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          model,
          stream: false,
          messages: [
            { role: 'system', content: system },
            { role: 'user', content: user },
          ],
        }),
        signal,
      });
      if (!res.ok) throw new Error(`Ollama ${res.status}`);
      const data = await res.json();
      return (data.message?.content ?? '').trim();
    }
  }
}

/** Pull the first fenced or `$`-prefixed code block out of a model reply. */
export function extractCode(text: string): string | null {
  const fence = text.match(/```(?:[a-z]*)\n([\s\S]*?)```/i);
  if (fence) return fence[1].trim();
  // otherwise gather lines that look like Strudel
  const lines = text.split('\n').filter((l) => /^\s*(\$\w+:|setcps|\.|s\(|note\(|sound\()/.test(l));
  return lines.length ? lines.join('\n').trim() : null;
}

export const MAESTRO_SYSTEM = `You are the Maestro inside Refrain, an AI-native live-coding music IDE built on Strudel (TidalCycles-style patterns in JavaScript).
The code is always the score. You edit a real Strudel program made of named voices like:
  $drums: s("bd*2, ~ sd").bank("RolandTR909")
  $hats: s("hh*8").gain("0.4 0.7")
  $bass: note("c2 eb2 g2 c3").s("sawtooth")
When asked to change the music, reply with the COMPLETE new score in a single \`\`\` code block — preserve every voice, change only what's needed. Keep it valid Strudel. After the block, add one short sentence describing the musical change. Never invent functions that don't exist in Strudel.`;

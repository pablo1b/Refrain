// ---------------------------------------------------------------------------
// Bring-your-own-key model access (spec §07.8). Keys live in localStorage
// here (the spec's desktop build would use the OS keychain). Roles map to
// models so cheap/fast handles directives and a strong model handles
// generation & theory. `local-only` mode stops every network call.
// The Maestro is fully functional with NO keys — directives & lanes are
// deterministic; the LLM is an enhancement for free-form requests.
// ---------------------------------------------------------------------------

import type { Provider, RoleRoute } from '../types';

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

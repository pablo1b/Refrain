import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  chat,
  extractCode,
  strengthFor,
  loadProviders,
  saveProviders,
  loadRoles,
  saveRoles,
  defaultProviders,
  MODEL_OPTIONS,
} from './providers';
import type { Provider } from '../types';
import { stubFetch, fakeResponse, replyBody } from '../../tests/helpers/llm';

// Boundary-mocked tier: providers.ts is a SYSTEM BOUNDARY (fetch + localStorage).
// We stub global fetch and exercise the real request-building / response-parsing.

const prov = (over: Partial<Provider> = {}): Provider => ({
  id: 'anthropic',
  label: 'Anthropic',
  key: 'sk-test',
  model: 'claude-sonnet-4-6',
  connected: true,
  ...over,
});

describe('strengthFor', () => {
  it('tags local, fast and strong models', () => {
    expect(strengthFor('ollama', 'llama3')).toBe('local');
    expect(strengthFor('anthropic', 'claude-haiku-4-5')).toBe('fast');
    expect(strengthFor('openai', 'gpt-4o-mini')).toBe('fast');
    expect(strengthFor('google', 'gemini-3.5-flash')).toBe('fast');
    expect(strengthFor('anthropic', 'claude-opus-4-8')).toBe('strong');
  });
});

describe('extractCode', () => {
  it('pulls a fenced code block', () => {
    expect(extractCode('Here:\n```js\n$a: s("bd")\n```\nDone')).toBe('$a: s("bd")');
  });
  it('falls back to Strudel-looking lines', () => {
    expect(extractCode('chat\n$drums: s("bd*2")\nsetcps(0.5)\nbye')).toBe(
      '$drums: s("bd*2")\nsetcps(0.5)',
    );
  });
  it('returns null when there is no code', () => {
    expect(extractCode('just prose, nothing musical')).toBeNull();
  });

  // a fence carries a language tag and an indented body; trim() drops the
  // outer blank/indent framing but preserves the inner indentation.
  it('pulls a fenced block that has a leading language tag and indented body', () => {
    const text = 'ok:\n```strudel\n$drums: s("bd*2")\n  .gain(0.8)\n```\n';
    expect(extractCode(text)).toBe('$drums: s("bd*2")\n  .gain(0.8)');
  });

  // heuristic accepts every Strudel-looking line prefix it recognises.
  it.each([
    ['$voice line', 'preamble\n$bass: note("c2")\noutro', '$bass: note("c2")'],
    ['setcps line', 'try this\nsetcps(0.6)\nthanks', 'setcps(0.6)'],
    ['chained .method line', 'sure\n.lpf(600)\ndone', '.lpf(600)'],
    ['s( line', 'here\ns("hh*8")\nbye', 's("hh*8")'],
    ['note( line', 'here\nnote("c e g")\nbye', 'note("c e g")'],
    ['sound( line', 'here\nsound("bd sd")\nbye', 'sound("bd sd")'],
  ])('heuristic picks the %s', (_label, input, expected) => {
    expect(extractCode(input)).toBe(expected);
  });

  it('returns null for pure prose with no Strudel-looking lines', () => {
    expect(extractCode('let us talk about rhythm and feel only')).toBeNull();
  });
});

describe('localStorage persistence', () => {
  beforeEach(() => localStorage.clear());

  it('returns defaults when nothing is stored', () => {
    expect(loadProviders().map((p) => p.id)).toEqual(['anthropic', 'openai', 'google', 'ollama']);
    expect(loadRoles().map((r) => r.id)).toEqual(['directives', 'generation', 'theory', 'offline']);
  });

  it('round-trips saved providers, merging over fresh defaults', () => {
    const ps = defaultProviders();
    ps[0] = { ...ps[0], key: 'sk-xyz', connected: true };
    saveProviders(ps);
    const loaded = loadProviders();
    expect(loaded[0].key).toBe('sk-xyz');
    expect(loaded[0].connected).toBe(true);
  });

  // a saved entry that predates a newly-added default field must still gain
  // that field on load (merge spreads default first, then the saved partial).
  it('merges a saved partial over fresh defaults so missing default fields reappear', () => {
    const saved = [{ id: 'anthropic', label: 'Anthropic', key: 'sk-old', connected: true }];
    localStorage.setItem('refrain.providers', JSON.stringify(saved));
    const loaded = loadProviders();
    const anthropic = loaded.find((p) => p.id === 'anthropic')!;
    expect(anthropic.key).toBe('sk-old');
    expect(anthropic.connected).toBe(true);
    // `model` was omitted from the saved entry → comes from the default.
    expect(anthropic.model).toBe('claude-sonnet-4-6');
  });

  it('round-trips saved roles', () => {
    const rs = loadRoles();
    rs[0] = { ...rs[0], provider: 'openai', model: 'gpt-4o' };
    saveRoles(rs);
    expect(loadRoles()[0].provider).toBe('openai');
  });

  it('falls back to defaults on corrupt JSON', () => {
    localStorage.setItem('refrain.providers', '{not json');
    expect(loadProviders().map((p) => p.id)).toEqual(['anthropic', 'openai', 'google', 'ollama']);
  });
});

describe('MODEL_OPTIONS', () => {
  // The constant documents "first entry is each provider's default". That holds
  // for openai/google/ollama against defaultProviders(); anthropic is the one
  // quirk — its picker leads with the strongest model (claude-opus-4-8) while
  // the default provider model is claude-sonnet-4-6. Pin both realities so a
  // silent reorder is caught.
  it.each([
    ['openai', 'gpt-4o'],
    ['google', 'gemini-3.5-flash'],
    ['ollama', 'llama3'],
  ] as const)('lists the %s default model first', (id, model) => {
    expect(MODEL_OPTIONS[id][0]).toBe(model);
    expect(defaultProviders().find((p) => p.id === id)!.model).toBe(model);
  });

  it('leads anthropic with the strongest model, not its provider default', () => {
    expect(MODEL_OPTIONS.anthropic[0]).toBe('claude-opus-4-8');
    expect(defaultProviders().find((p) => p.id === 'anthropic')!.model).toBe('claude-sonnet-4-6');
  });
});

describe('chat()', () => {
  let fetchSpy: ReturnType<typeof stubFetch>;
  beforeEach(() => {
    fetchSpy = stubFetch();
  });
  afterEach(() => vi.unstubAllGlobals());

  it('calls Anthropic and parses the reply', async () => {
    fetchSpy.mockResolvedValue(fakeResponse(replyBody.anthropic('hi from claude')));
    const out = await chat({ provider: prov(), model: 'claude-sonnet-4-6', system: 'sys', user: 'usr' });
    expect(out).toBe('hi from claude');
    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toBe('https://api.anthropic.com/v1/messages');
    expect(init.headers['x-api-key']).toBe('sk-test');
    const body = JSON.parse(init.body);
    expect(body.system).toBe('sys');
    expect(body.messages[0].content).toBe('usr');
  });

  it('calls OpenAI and parses choices', async () => {
    fetchSpy.mockResolvedValue(fakeResponse(replyBody.openai('hi from gpt')));
    const out = await chat({ provider: prov({ id: 'openai' }), model: 'gpt-4o', system: 's', user: 'u' });
    expect(out).toBe('hi from gpt');
    expect(fetchSpy.mock.calls[0][0]).toBe('https://api.openai.com/v1/chat/completions');
  });

  it('calls Google with the model in the URL', async () => {
    fetchSpy.mockResolvedValue(fakeResponse(replyBody.google('hi from gemini')));
    const out = await chat({ provider: prov({ id: 'google' }), model: 'gemini-3.5-flash', system: 's', user: 'u' });
    expect(out).toBe('hi from gemini');
    expect(fetchSpy.mock.calls[0][0]).toContain('models/gemini-3.5-flash:generateContent');
  });

  it('calls a local Ollama endpoint', async () => {
    fetchSpy.mockResolvedValue(fakeResponse(replyBody.ollama('hi from llama')));
    const out = await chat({
      provider: prov({ id: 'ollama', endpoint: 'http://127.0.0.1:11434', local: true }),
      model: 'llama3',
      system: 's',
      user: 'u',
    });
    expect(out).toBe('hi from llama');
    expect(fetchSpy.mock.calls[0][0]).toBe('http://127.0.0.1:11434/api/chat');
  });

  it('puts the Google key in the URL query string', async () => {
    fetchSpy.mockResolvedValue(fakeResponse(replyBody.google('hi')));
    await chat({ provider: prov({ id: 'google', key: 'goog-key' }), model: 'gemini-3.5-flash', system: 's', user: 'u' });
    expect(fetchSpy.mock.calls[0][0]).toContain('?key=goog-key');
  });

  it('falls back to the default Ollama endpoint when none is provided', async () => {
    fetchSpy.mockResolvedValue(fakeResponse(replyBody.ollama('hi')));
    await chat({ provider: prov({ id: 'ollama', local: true }), model: 'llama3', system: 's', user: 'u' });
    expect(fetchSpy.mock.calls[0][0]).toBe('http://127.0.0.1:11434/api/chat');
  });

  it('forwards an AbortSignal to fetch unchanged', async () => {
    fetchSpy.mockResolvedValue(fakeResponse(replyBody.anthropic('hi')));
    const controller = new AbortController();
    await chat({ provider: prov(), model: 'claude-sonnet-4-6', system: 's', user: 'u', signal: controller.signal });
    expect(fetchSpy.mock.calls[0][1].signal).toBe(controller.signal);
  });

  it('throws with status text on a non-OK response', async () => {
    fetchSpy.mockResolvedValue(fakeResponse('rate limited', { ok: false, status: 429, text: 'rate limited' }));
    await expect(
      chat({ provider: prov(), model: 'claude-sonnet-4-6', system: 's', user: 'u' }),
    ).rejects.toThrow(/429/);
  });
});

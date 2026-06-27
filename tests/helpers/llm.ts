import { vi } from 'vitest';

// ---------------------------------------------------------------------------
// fetch() boundary helpers for src/llm/providers.ts tests. The real chat()
// hits anthropic/openai/google/ollama endpoints; we stub global fetch and feed
// canned Response-shaped objects.
// ---------------------------------------------------------------------------

interface FakeResponseInit {
  ok?: boolean;
  status?: number;
  /** Raw text body (used by the error path which reads res.text()). */
  text?: string;
}

/** Build a minimal object that satisfies the bits of Response the code uses. */
export function fakeResponse(body: unknown, init: FakeResponseInit = {}): Response {
  const ok = init.ok ?? true;
  const status = init.status ?? (ok ? 200 : 500);
  return {
    ok,
    status,
    json: async () => body,
    text: async () => init.text ?? (typeof body === 'string' ? body : JSON.stringify(body)),
  } as Response;
}

/** Replace global fetch with a spy. Returns it for per-test configuration. */
export function stubFetch(): ReturnType<typeof vi.fn> {
  const fn = vi.fn();
  vi.stubGlobal('fetch', fn);
  return fn;
}

/** Provider-shaped reply bodies, so tests assert real parsing paths. */
export const replyBody = {
  anthropic: (text: string) => ({ content: [{ text }] }),
  openai: (text: string) => ({ choices: [{ message: { content: text } }] }),
  google: (text: string) => ({ candidates: [{ content: { parts: [{ text }] } }] }),
  ollama: (text: string) => ({ message: { content: text } }),
};

/// <reference types="vite/client" />

// Dev/local model keys, read from `.env.local` (see `.env.local.example`).
// Every VITE_ var is inlined into the client bundle, so `providers.ts` seeds
// these only in dev and `--mode local` — never in a production build.
interface ImportMetaEnv {
  readonly VITE_ANTHROPIC_API_KEY?: string;
  readonly VITE_OPENAI_API_KEY?: string;
  readonly VITE_GOOGLE_API_KEY?: string;
  readonly VITE_OLLAMA_ENDPOINT?: string;
}

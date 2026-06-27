import { useStore } from '../../src/state/store';

// ---------------------------------------------------------------------------
// Zustand store reset. The store is a module singleton, so tests must restore
// pristine state between cases. We snapshot the initial state (data + the stable
// action closures) once, then replace state with a fresh shallow copy each time.
// The store updates immutably throughout, so nested arrays are never mutated in
// place — a shallow copy is enough to isolate cases.
// ---------------------------------------------------------------------------

let snapshot: ReturnType<typeof useStore.getState> | null = null;

export function resetStore() {
  if (!snapshot) snapshot = { ...useStore.getState() };
  useStore.setState({ ...snapshot }, true);
}

/** Convenience accessor mirroring useStore.getState(). */
export const state = () => useStore.getState();

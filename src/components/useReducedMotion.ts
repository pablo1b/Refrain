import { useSyncExternalStore } from 'react';
import { useStore, motionIsReduced } from '../state/store';

// The reduced-motion contract (spec §12.8): a manual choice in Settings →
// Accessibility overrides the OS `prefers-reduced-motion` in either direction.
// This hook resolves the two and re-renders when either flips, so the JS-driven
// surfaces (playheads, meters) can degrade motion to discrete steps live.
export function useReducedMotion(): boolean {
  const pref = useStore((s) => s.motion);
  // subscribe to the OS media query so `system` tracks it without a reload
  useSyncExternalStore(
    (cb) => {
      const mq = window.matchMedia?.('(prefers-reduced-motion: reduce)');
      mq?.addEventListener?.('change', cb);
      return () => mq?.removeEventListener?.('change', cb);
    },
    () => (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ? 1 : 0),
    () => 0,
  );
  return motionIsReduced(pref);
}

import { useEffect, useState } from 'react';

/**
 * Per-voice level meters with a gentle random-walk while the transport runs.
 * Shared by the Stage and Performance mode so both animate identically.
 * (A truly "honest" read-out would sample real Web Audio levels per voice;
 * this is a visual stand-in seeded deterministically per voice.)
 */
export function useMeters(ids: string[], playing: boolean): Record<string, number> {
  const [levels, setLevels] = useState<Record<string, number>>({});
  useEffect(() => {
    if (!playing) {
      setLevels({});
      return;
    }
    const seed: Record<string, number> = {};
    ids.forEach((id, i) => (seed[id] = 0.4 + ((i * 0.13) % 0.4)));
    const tick = () => {
      setLevels((prev) => {
        const next: Record<string, number> = {};
        for (const id of ids) {
          const cur = prev[id] ?? seed[id];
          next[id] = Math.max(0.08, Math.min(0.95, cur + (Math.random() - 0.5) * 0.28));
        }
        return next;
      });
    };
    tick();
    const t = setInterval(tick, 130);
    return () => clearInterval(t);
  }, [ids.join(','), playing]);
  return levels;
}

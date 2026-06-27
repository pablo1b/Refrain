import { useEffect, useRef } from 'react';
import { useStore } from '../state/store';
import { engine } from '../audio/strudelEngine';
import { CLOCK_RINGS } from '../theme/tokens';

// The Cycle — a radial reading of one cycle. Each voice is a ring, each event a
// tick, a single playhead sweeps the present (spec §05). The hand is driven by
// the real scheduler clock, not a decorative animation.
export function CycleClock({ size = 118, strong = false }: { size?: number; strong?: boolean }) {
  const voices = useStore((s) => s.voices).slice(0, CLOCK_RINGS.length);
  const ticks = useStore((s) => s.ticks);
  const playing = useStore((s) => s.playing);
  const anySolo = voices.some((v) => v.solo);
  const handRef = useRef<SVGGElement>(null);
  const VB = 200;
  const C = VB / 2;

  useEffect(() => {
    let raf = 0;
    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    let lastDeg = -1;
    const loop = () => {
      const n = engine.now();
      const phase = ((n % 1) + 1) % 1;
      const deg = phase * 360;
      if (handRef.current && (!reduced || Math.abs(deg - lastDeg) > 22)) {
        handRef.current.style.transform = `rotate(${deg}deg)`;
        lastDeg = deg;
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, []);

  const handColor = playing ? 'var(--live)' : 'var(--text-dim)';

  return (
    <svg width={size} height={size} viewBox={`0 0 ${VB} ${VB}`} fill="none" role="img" aria-label="cycle clock">
      {/* rings */}
      {voices.map((v, i) => (
        <circle key={`r${v.id}`} cx={C} cy={C} r={CLOCK_RINGS[i]} stroke="var(--line-2)" strokeWidth={strong ? 1.4 : 1} />
      ))}
      {/* quarter guides */}
      {[0, 90, 180, 270].map((a) => {
        const rad = (a * Math.PI) / 180;
        const r1 = 86;
        const r2 = 78;
        return (
          <line
            key={a}
            x1={C + r1 * Math.sin(rad)}
            y1={C - r1 * Math.cos(rad)}
            x2={C + r2 * Math.sin(rad)}
            y2={C - r2 * Math.cos(rad)}
            stroke="var(--line-6)"
            strokeWidth="1"
          />
        );
      })}
      {/* ticks per voice */}
      {voices.map((v, i) => {
        const r = CLOCK_RINGS[i];
        const dimmed = v.muted || (anySolo && !v.solo);
        const list = ticks[v.id] ?? [];
        return list.map((begin, j) => {
          const ang = begin * 2 * Math.PI;
          return (
            <circle
              key={`${v.id}-${j}`}
              cx={C + r * Math.sin(ang)}
              cy={C - r * Math.cos(ang)}
              r={strong ? 3.6 : 2.7}
              fill={v.color}
              opacity={dimmed ? 0.22 : 1}
            />
          );
        });
      })}
      {/* playhead */}
      <g ref={handRef} style={{ transformOrigin: `${C}px ${C}px` }}>
        <line x1={C} y1={C} x2={C} y2={16} stroke={handColor} strokeWidth={strong ? 2.2 : 1.7} />
        <circle cx={C} cy={16} r={strong ? 5 : 3.6} fill={handColor} />
      </g>
      <circle cx={C} cy={C} r={strong ? 4 : 3.4} fill="var(--text)" />
    </svg>
  );
}

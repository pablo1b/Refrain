import { useEffect, useRef, useState } from 'react';
import { useStore } from '../state/store';
import { engine } from '../audio/strudelEngine';
import { CLOCK_RINGS } from '../theme/tokens';
import { useReducedMotion } from './useReducedMotion';

// The Cycle — a radial reading of one cycle. Each voice is a ring, each event a
// tick, a single playhead sweeps the present (spec §05). The hand is driven by
// the real scheduler clock, decoupled from the `playing` flag so PANIC/HUSH keep
// it turning (FIX §10). When `interactive`, it becomes a TARGET (spec §06):
// drag an arc to scope a span, and a dashed amber arc counts down to the
// boundary where a staged edit goes live.

const VB = 200;
const C = VB / 2;

/** Cycle fraction [0,1) from a pointer, measured clockwise from 12 o'clock. */
function pointerFraction(el: SVGSVGElement, clientX: number, clientY: number): number {
  const rect = el.getBoundingClientRect();
  const x = ((clientX - rect.left) / rect.width) * VB - C;
  const y = ((clientY - rect.top) / rect.height) * VB - C;
  const ang = Math.atan2(x, -y); // 0 at top, +clockwise
  return ((ang / (2 * Math.PI)) % 1 + 1) % 1;
}

/** SVG arc path between two cycle fractions at radius r (clockwise). */
function arcPath(from: number, to: number, r: number): string {
  const a0 = from * 2 * Math.PI;
  let span = to - from;
  if (span <= 0) span += 1;
  const a1 = a0 + span * 2 * Math.PI;
  const x0 = C + r * Math.sin(a0);
  const y0 = C - r * Math.cos(a0);
  const x1 = C + r * Math.sin(a1);
  const y1 = C - r * Math.cos(a1);
  const large = span > 0.5 ? 1 : 0;
  return `M ${x0.toFixed(2)} ${y0.toFixed(2)} A ${r} ${r} 0 ${large} 1 ${x1.toFixed(2)} ${y1.toFixed(2)}`;
}

export function CycleClock({ size = 118, strong = false, interactive = false }: { size?: number; strong?: boolean; interactive?: boolean }) {
  const voices = useStore((s) => s.voices).slice(0, CLOCK_RINGS.length);
  const ticks = useStore((s) => s.ticks);
  const playing = useStore((s) => s.playing);
  const arc = useStore((s) => s.arcSelection);
  const setArc = useStore((s) => s.setArcSelection);
  const applyArc = useStore((s) => s.applyArcToVoice);
  const stagedEdit = useStore((s) => s.stagedEdit);
  const transportLive = useStore((s) => s.transportLive);
  const reduced = useReducedMotion();
  const anySolo = voices.some((v) => v.solo);
  const handRef = useRef<SVGGElement>(null);
  const boundaryRef = useRef<SVGPathElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const [drag, setDrag] = useState<{ start: number } | null>(null);

  useEffect(() => {
    let raf = 0;
    let lastDeg = -1;
    const loop = () => {
      if (engine.started) {
        const n = engine.now();
        let phase = ((n % 1) + 1) % 1;
        // reduced motion: the playhead still tells time, but steps once per 1/16
        // rather than sweeping continuously (spec §12.8).
        if (reduced) phase = Math.floor(phase * 16) / 16;
        const deg = phase * 360;
        if (handRef.current && deg !== lastDeg) {
          handRef.current.style.transform = `rotate(${deg}deg)`;
          lastDeg = deg;
        }
        // time-until-live: a dashed amber arc from the playhead round to the top
        // boundary (edits commit on the next cycle) — the countdown made visible.
        if (boundaryRef.current) {
          boundaryRef.current.setAttribute('d', stagedEdit ? arcPath(phase, 0, 92) : '');
        }
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [stagedEdit, reduced]);

  const handColor = playing ? 'var(--live)' : transportLive ? 'var(--maestro)' : 'var(--text-dim)';

  const onDown = (e: React.PointerEvent) => {
    if (!interactive || !svgRef.current) return;
    e.preventDefault();
    (e.target as Element).setPointerCapture?.(e.pointerId);
    const f = pointerFraction(svgRef.current, e.clientX, e.clientY);
    setDrag({ start: f });
    setArc({ start: f, end: f });
  };
  const onMove = (e: React.PointerEvent) => {
    if (!interactive || !drag || !svgRef.current) return;
    const f = pointerFraction(svgRef.current, e.clientX, e.clientY);
    setArc({ start: drag.start, end: f });
  };
  const onUp = () => {
    if (!interactive || !drag) return;
    setDrag(null);
    // a zero-width tap clears the selection
    if (arc && Math.abs(arc.end - arc.start) < 0.02) setArc(null);
  };

  return (
    <div style={{ position: 'relative', width: size, height: size }}>
      <svg
        ref={svgRef}
        width={size}
        height={size}
        viewBox={`0 0 ${VB} ${VB}`}
        fill="none"
        role="img"
        aria-label="cycle clock"
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        style={{ cursor: interactive ? 'crosshair' : 'default', touchAction: 'none' }}
      >
        {voices.map((v, i) => (
          <circle key={`r${v.id}`} cx={C} cy={C} r={CLOCK_RINGS[i]} stroke="var(--line-2)" strokeWidth={strong ? 1.4 : 1} />
        ))}
        {[0, 90, 180, 270].map((a) => {
          const rad = (a * Math.PI) / 180;
          return (
            <line key={a} x1={C + 86 * Math.sin(rad)} y1={C - 86 * Math.cos(rad)} x2={C + 78 * Math.sin(rad)} y2={C - 78 * Math.cos(rad)} stroke="var(--line-6)" strokeWidth="1" />
          );
        })}

        {/* arc selection (lime) — the dragged span (spec §06) */}
        {interactive && arc && Math.abs(arc.end - arc.start) >= 0.02 && (
          <>
            <path d={arcPath(arc.start, arc.end, 90)} stroke="var(--live)" strokeWidth={6} strokeLinecap="round" opacity={0.5} />
            <circle cx={C + 90 * Math.sin(arc.start * 2 * Math.PI)} cy={C - 90 * Math.cos(arc.start * 2 * Math.PI)} r={5} fill="var(--bg)" stroke="var(--live)" strokeWidth={2.4} />
            <circle cx={C + 90 * Math.sin(arc.end * 2 * Math.PI)} cy={C - 90 * Math.cos(arc.end * 2 * Math.PI)} r={5} fill="var(--bg)" stroke="var(--live)" strokeWidth={2.4} />
          </>
        )}

        {/* time-until-live boundary (amber, dashed) + notch at top */}
        {stagedEdit && (
          <>
            <path ref={boundaryRef} d="" stroke="var(--maestro)" strokeWidth={2.4} strokeLinecap="round" strokeDasharray="2 5" opacity={0.85} />
            <line x1={C} y1={2} x2={C} y2={14} stroke="var(--maestro)" strokeWidth={2.4} />
            <circle cx={C} cy={4} r={3} fill="var(--maestro)" />
          </>
        )}

        {/* ticks per voice */}
        {voices.map((v, i) => {
          const r = CLOCK_RINGS[i];
          const dimmed = v.muted || (anySolo && !v.solo);
          const list = ticks[v.id] ?? [];
          return list.map((begin, j) => {
            const ang = begin * 2 * Math.PI;
            return <circle key={`${v.id}-${j}`} cx={C + r * Math.sin(ang)} cy={C - r * Math.cos(ang)} r={strong ? 3.6 : 2.7} fill={v.color} opacity={dimmed ? 0.22 : 1} />;
          });
        })}

        {/* playhead */}
        <g ref={handRef} style={{ transformOrigin: `${C}px ${C}px` }}>
          <line x1={C} y1={C} x2={C} y2={16} stroke={handColor} strokeWidth={strong ? 2.2 : 1.7} />
          <circle cx={C} cy={16} r={strong ? 5 : 3.6} fill={handColor} />
        </g>
        <circle cx={C} cy={C} r={strong ? 4 : 3.4} fill="var(--text)" />
      </svg>

      {/* arc action chip — the selection rides into a command (spec §06) */}
      {interactive && arc && Math.abs(arc.end - arc.start) >= 0.02 && (
        <button
          onClick={() => applyArc()}
          title="scope the active voice to this span"
          style={{
            position: 'absolute',
            bottom: -6,
            left: '50%',
            transform: 'translateX(-50%)',
            whiteSpace: 'nowrap',
            fontFamily: 'var(--font-mono)',
            fontSize: 9.5,
            fontWeight: 700,
            color: 'var(--live-ink)',
            background: 'var(--live)',
            borderRadius: 6,
            padding: '4px 9px',
            boxShadow: 'var(--shadow)',
          }}
        >
          ⤵ mask here
        </button>
      )}
      {stagedEdit && transportLive && (
        <span style={{ position: 'absolute', top: -4, left: '50%', transform: 'translateX(-50%)', whiteSpace: 'nowrap', fontFamily: 'var(--font-mono)', fontSize: 9, color: 'var(--maestro)' }}>
          live next cycle
        </span>
      )}
    </div>
  );
}

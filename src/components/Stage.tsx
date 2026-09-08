import { useRef } from 'react';
import { useStore } from '../state/store';
import { CycleClock } from './CycleClock';
import { useMeters } from './useMeters';
import { TrackerLens, SpectrumLens, WheelLens, BloomLens, ScoreLens } from './Lenses';
import type { LensId } from '../types';

const mono: React.CSSProperties = { fontFamily: 'var(--font-mono)' };

const LENS_CHIPS: { id: LensId; label: string }[] = [
  { id: 'cycle', label: '◷ Cycle' },
  { id: 'tracker', label: '▤ Tracker' },
  { id: 'score', label: '♩ Score' },
  { id: 'spectrum', label: '≋ Spectrum' },
  { id: 'wheel', label: '⊚ Wheel' },
  { id: 'bloom', label: '✺ Bloom' },
  { id: 'sparklines', label: '∿ Sparklines' },
  { id: 'miniroll', label: '⊞ Roll' },
  { id: 'meters', label: '▥ Meters' },
];

function dbLabel(db: number): string {
  if (!isFinite(db)) return '−∞';
  return `${db > 0 ? '+' : '−'}${Math.abs(db).toFixed(1)}`;
}

export function Stage() {
  const voices = useStore((s) => s.voices);
  const cps = useStore((s) => s.cps);
  const lenses = useStore((s) => s.lenses);
  const toggleLens = useStore((s) => s.toggleLens);
  const toggleSolo = useStore((s) => s.toggleSolo);
  const toggleMute = useStore((s) => s.toggleMute);
  const anySolo = voices.some((v) => v.solo);
  const { levels, measured, cpu, headroomDb } = useMeters();

  const on = (id: LensId) => lenses.includes(id);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', borderTop: '1px solid var(--line)', background: 'var(--bg-deep)', flex: 'none' }}>
      {/* lens picker + master readout */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '7px 14px', borderBottom: '1px solid var(--line-3)', flexWrap: 'wrap' }}>
        <span style={{ ...mono, fontSize: 10, letterSpacing: '.16em', color: 'var(--text-dim)', marginRight: 4 }}>LENSES</span>
        {LENS_CHIPS.map((c) => {
          const active = on(c.id);
          return (
            <button
              key={c.id}
              onClick={() => toggleLens(c.id)}
              style={{
                ...mono,
                fontSize: 10.5,
                color: active ? 'var(--live-ink)' : 'var(--text-2)',
                background: active ? 'var(--live)' : 'transparent',
                border: `1px solid ${active ? 'var(--live)' : 'var(--line-5)'}`,
                borderRadius: 6,
                padding: '4px 9px',
                fontWeight: active ? 700 : 400,
              }}
            >
              {c.label}
            </button>
          );
        })}
        <span style={{ marginLeft: 'auto', ...mono, fontSize: 10, color: 'var(--text-dim)' }}>
          {cps} cps · cpu {cpu}% · {dbLabel(headroomDb)} dB
        </span>
      </div>

      {/* body */}
      <div style={{ display: 'flex', minHeight: 150, maxHeight: 210 }}>
        {on('cycle') && (
          <div style={{ flex: 'none', width: 150, padding: 12, display: 'flex', alignItems: 'center', justifyContent: 'center', borderRight: '1px solid var(--line-3)' }}>
            <CycleClock size={126} interactive />
          </div>
        )}

        {/* mixer: compact real meters + solo/mute (spec §05 FIX) */}
        <div style={{ flex: on('tracker') || on('spectrum') || on('wheel') || on('bloom') || on('score') ? '0 0 300px' : 1, minWidth: 0, padding: '10px 14px', overflowY: 'auto', borderRight: '1px solid var(--line-3)' }}>
          <div style={{ ...mono, fontSize: 10, letterSpacing: '.14em', color: 'var(--text-dim)', marginBottom: 8 }}>THE STAGE — {voices.length} VOICES</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {voices.map((v, i) => {
              const dimmed = v.muted || (anySolo && !v.solo);
              const level = dimmed ? 0 : (levels[v.id] ?? 0);
              return (
                <VoiceRow
                  key={`mix:${i}:${v.id}`}
                  sigil={v.sigil}
                  color={v.color}
                  level={level}
                  measured={!!measured[v.id]}
                  showMeter={on('meters')}
                  showSpark={on('sparklines')}
                  solo={v.solo}
                  muted={v.muted}
                  onSolo={() => toggleSolo(v.id)}
                  onMute={() => toggleMute(v.id)}
                />
              );
            })}
          </div>
        </div>

        {/* lens strip */}
        {(on('tracker') || on('spectrum') || on('wheel') || on('bloom') || on('score')) && (
          <div style={{ flex: 1, minWidth: 0, display: 'flex', gap: 10, padding: 10, overflowX: 'auto', alignItems: 'stretch' }}>
            {on('score') && <ScoreLens />}
            {on('tracker') && <TrackerLens />}
            {on('spectrum') && <SpectrumLens />}
            {on('wheel') && <WheelLens />}
            {on('bloom') && <BloomLens />}
          </div>
        )}
      </div>
    </div>
  );
}

function VoiceRow({ sigil, color, level, measured, showMeter, showSpark, solo, muted, onSolo, onMute }: {
  sigil: string; color: string; level: number; measured: boolean; showMeter: boolean; showSpark: boolean; solo: boolean; muted: boolean; onSolo: () => void; onMute: () => void;
}) {
  const hist = useRef<number[]>([]);
  hist.current = [...hist.current.slice(-31), level];
  const pct = Math.round(level * 100);
  const db = level > 0.0005 ? 20 * Math.log10(level) : -Infinity;
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 9, ...mono, fontSize: 11 }}>
      <span style={{ width: 52, color: 'var(--text-1)', overflow: 'hidden', textOverflow: 'ellipsis', flex: 'none' }}>{sigil}</span>
      {showMeter && (
        <div role="meter" aria-label={`${sigil} ${measured ? 'level' : 'activity'}`} aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} style={{ flex: showSpark ? '0 0 60px' : 1, height: 5, borderRadius: 3, background: 'var(--elev)', overflow: 'hidden' }}>
          <div style={{ width: `${pct}%`, height: '100%', background: color, transition: 'width .06s linear' }} />
        </div>
      )}
      {showSpark && (
        <svg width="100%" height="14" viewBox="0 0 120 14" preserveAspectRatio="none" style={{ flex: 1, minWidth: 0 }}>
          <polyline
            points={hist.current.map((l, i) => `${(i / 31) * 120},${14 - l * 13}`).join(' ')}
            stroke={color}
            strokeWidth="1.2"
            fill="none"
          />
        </svg>
      )}
      {!showMeter && !showSpark && <span style={{ flex: 1 }} />}
      <span style={{ width: 34, textAlign: 'right', color: 'var(--text-dim)', flex: 'none' }}>{isFinite(db) ? db.toFixed(0) : '−∞'}</span>
      <span style={{ display: 'flex', gap: 4, flex: 'none' }}>
        <button onClick={onSolo} style={metaBtn(solo, 'var(--live)')}>S</button>
        <button onClick={onMute} style={metaBtn(muted, 'var(--panic)')}>M</button>
      </span>
    </div>
  );
}

function metaBtn(active: boolean, color: string): React.CSSProperties {
  return {
    fontFamily: 'var(--font-mono)',
    fontSize: 9.5,
    width: 16,
    height: 15,
    lineHeight: 1,
    borderRadius: 3,
    fontWeight: 700,
    color: active ? 'var(--live-ink)' : 'var(--text-dim)',
    background: active ? color : 'transparent',
    border: `1px solid ${active ? color : 'var(--line-5)'}`,
  };
}

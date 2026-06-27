import { useState } from 'react';
import { useStore } from '../state/store';

const mono: React.CSSProperties = { fontFamily: 'var(--font-mono)' };
type Tab = 'OUTLINE' | 'FILES' | 'PACKS';

export function Shelf() {
  const [tab, setTab] = useState<Tab>('OUTLINE');
  return (
    <div style={{ borderRight: '1px solid var(--line-3)', background: 'var(--panel)', display: 'flex', flexDirection: 'column', minWidth: 0, overflow: 'hidden' }}>
      <div style={{ display: 'flex', borderBottom: '1px solid var(--line-3)', ...mono, fontSize: 10 }}>
        {(['OUTLINE', 'FILES', 'PACKS'] as Tab[]).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            style={{
              flex: 1,
              textAlign: 'center',
              padding: '9px 0',
              color: tab === t ? 'var(--text)' : 'var(--text-3)',
              borderBottom: tab === t ? '2px solid var(--live)' : '2px solid transparent',
              letterSpacing: '.04em',
            }}
          >
            {t}
          </button>
        ))}
      </div>
      <div style={{ flex: 1, overflowY: 'auto', padding: '14px 12px' }}>
        {tab === 'OUTLINE' && <Outline />}
        {tab === 'FILES' && <Files />}
        {tab === 'PACKS' && <Packs />}
      </div>
      <SurfaceRail />
    </div>
  );
}

function SurfaceRail() {
  const open = useStore((s) => s.openSurface);
  const chips: { label: string; s: Parameters<typeof open>[0] }[] = [
    { label: '⧉ arrange', s: 'arrangement' },
    { label: '♪ staff', s: 'notation' },
    { label: '↗ providers', s: 'providers' },
  ];
  return (
    <div style={{ display: 'flex', gap: 6, padding: '10px 12px', borderTop: '1px solid var(--line-3)', flexWrap: 'wrap' }}>
      {chips.map((c) => (
        <button key={c.label} onClick={() => open(c.s)} style={{ ...mono, fontSize: 10, color: 'var(--text-2)', border: '1px solid var(--line-5)', borderRadius: 6, padding: '5px 8px' }}>
          {c.label}
        </button>
      ))}
    </div>
  );
}

function Heading({ children }: { children: React.ReactNode }) {
  return <div style={{ ...mono, fontSize: 9.5, letterSpacing: '.16em', color: 'var(--text-dim)', margin: '0 0 10px' }}>{children}</div>;
}

function Outline() {
  const voices = useStore((s) => s.voices);
  const active = useStore((s) => s.activeVoiceId);
  const select = useStore((s) => s.selectVoice);
  const toggleMute = useStore((s) => s.toggleMute);
  const toggleSolo = useStore((s) => s.toggleSolo);
  const openSurface = useStore((s) => s.openSurface);
  const anySolo = voices.some((v) => v.solo);

  return (
    <>
      <Heading>VOICES — {voices.length}</Heading>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 3, ...mono, fontSize: 12 }}>
        {voices.map((v) => {
          const isActive = v.id === active;
          const dimmed = v.muted || (anySolo && !v.solo);
          return (
            <div
              key={v.id}
              onClick={() => select(v.id)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                padding: '6px 8px',
                borderRadius: 5,
                cursor: 'pointer',
                background: isActive ? 'var(--active-line)' : 'transparent',
                border: isActive ? '1px solid var(--lane-sel-line)' : '1px solid transparent',
                opacity: dimmed ? 0.5 : 1,
              }}
            >
              <span style={{ width: 7, height: 7, borderRadius: 2, background: v.color, flex: 'none' }} />
              <span style={{ color: isActive ? 'var(--text)' : 'var(--text-1)' }}>{v.sigil}</span>
              <span style={{ marginLeft: 'auto', display: 'flex', gap: 4 }}>
                <Mini label="S" on={v.solo} color="var(--live)" onClick={(e) => { e.stopPropagation(); toggleSolo(v.id); }} />
                <Mini label="M" on={v.muted} color="var(--panic)" onClick={(e) => { e.stopPropagation(); toggleMute(v.id); }} />
              </span>
            </div>
          );
        })}
      </div>

      <div style={{ margin: '18px 0 10px' }}>
        <Heading>PATCHES</Heading>
      </div>
      <ShelfRow icon="~" onClick={() => openSurface('patch')}>warm·pad</ShelfRow>
      <ShelfRow icon="~" onClick={() => openSurface('patch')}>acid·303</ShelfRow>

      <div style={{ margin: '18px 0 10px' }}>
        <Heading>SAMPLES</Heading>
      </div>
      <ShelfRow icon="▦" onClick={() => openSurface('foundry')}>rhodes·Fm</ShelfRow>
      <ShelfRow icon="▦" onClick={() => openSurface('foundry')}>TR909</ShelfRow>
      <button
        onClick={() => openSurface('foundry')}
        style={{ ...mono, fontSize: 11, color: 'var(--maestro)', padding: '8px 8px 0', textAlign: 'left' }}
      >
        + foundry
      </button>
    </>
  );
}

function Mini({ label, on, color, onClick }: { label: string; on: boolean; color: string; onClick: (e: React.MouseEvent) => void }) {
  return (
    <button
      onClick={onClick}
      title={label === 'S' ? 'solo' : 'mute'}
      style={{
        ...mono,
        fontSize: 9.5,
        width: 16,
        height: 16,
        borderRadius: 3,
        color: on ? 'var(--live-ink)' : 'var(--text-dim)',
        background: on ? color : 'transparent',
        border: `1px solid ${on ? color : 'var(--line-5)'}`,
        lineHeight: 1,
        fontWeight: 700,
      }}
    >
      {label}
    </button>
  );
}

function ShelfRow({ icon, children, onClick }: { icon: string; children: React.ReactNode; onClick?: () => void }) {
  return (
    <div onClick={onClick} style={{ ...mono, fontSize: 11.5, color: 'var(--text-2)', padding: '5px 8px', cursor: 'pointer', borderRadius: 4 }}>
      {icon} {children}
    </div>
  );
}

function Files() {
  const files = ['set—02.refrain', 'intro.refrain', 'stems/', 'samples/', 'patches/'];
  return (
    <>
      <Heading>PROJECT · nightjar</Heading>
      {files.map((f) => (
        <ShelfRow key={f} icon={f.endsWith('/') ? '▸' : '◦'}>
          {f}
        </ShelfRow>
      ))}
    </>
  );
}

function Packs() {
  const packs = ['Dirt-Samples', 'RolandTR909', 'RolandTR808', 'EmuSP12', 'VCSL', 'mridangam'];
  return (
    <>
      <Heading>SAMPLE PACKS</Heading>
      {packs.map((p) => (
        <ShelfRow key={p} icon="▦">
          {p}
        </ShelfRow>
      ))}
    </>
  );
}

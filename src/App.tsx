import { useEffect } from 'react';
import { useStore } from './state/store';
import { Titlebar } from './components/Titlebar';
import { Shelf } from './components/Shelf';
import { ScoreEditor } from './components/ScoreEditor';
import { DiffView } from './components/DiffView';
import { Maestro } from './components/Maestro';
import { Stage } from './components/Stage';
import { PerformanceMode } from './components/PerformanceMode';
import { ProvidersModal } from './components/ProvidersModal';
import { Arrangement } from './components/Arrangement';
import { PatchDesigner } from './components/PatchDesigner';
import { SampleFoundry } from './components/SampleFoundry';
import { NotationBridge } from './components/NotationBridge';
import { AudioGate } from './components/AudioGate';

function isEditable(el: EventTarget | null): boolean {
  const node = el as HTMLElement | null;
  if (!node) return false;
  const tag = node.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || node.isContentEditable || node.classList?.contains('cm-content');
}

export default function App() {
  const theme = useStore((s) => s.theme);
  const setTheme = useStore((s) => s.setTheme);
  const mode = useStore((s) => s.mode);
  const surface = useStore((s) => s.surface);
  const openSurface = useStore((s) => s.openSurface);
  const stagedEdit = useStore((s) => s.stagedEdit);
  const initAudio = useStore((s) => s.initAudio);

  // keep the <html data-theme> attribute in sync with the store
  useEffect(() => {
    setTheme(theme);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // load the engine + samples on the first user gesture (audio policy)
  useEffect(() => {
    let done = false;
    const kick = () => {
      if (done) return;
      done = true;
      initAudio();
      window.removeEventListener('pointerdown', kick);
      window.removeEventListener('keydown', kick);
    };
    window.addEventListener('pointerdown', kick);
    window.addEventListener('keydown', kick);
    return () => {
      window.removeEventListener('pointerdown', kick);
      window.removeEventListener('keydown', kick);
    };
  }, [initAudio]);

  // global keyboard — keyboard-first (spec §10)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const s = useStore.getState();
      const editable = isEditable(e.target);

      // panic always available
      if ((e.metaKey || e.ctrlKey) && e.key === '.') {
        e.preventDefault();
        s.panic();
        return;
      }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        window.dispatchEvent(new CustomEvent('refrain:focus-maestro'));
        return;
      }
      if (editable) return;

      if (e.key === ' ') {
        e.preventDefault();
        s.togglePlay();
      } else if (s.stagedEdit && (e.key === 'Enter')) {
        e.preventDefault();
        s.acceptEdit();
      } else if (s.stagedEdit && (e.key === 'Backspace' || e.key === 'Escape')) {
        e.preventDefault();
        s.rejectEdit();
      } else if (e.key === 'Escape' && s.surface) {
        openSurface(null);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [openSurface]);

  if (mode === 'performance') {
    return <PerformanceMode />;
  }

  return (
    <div style={{ height: '100vh', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      <Titlebar />
      <div style={{ flex: 1, display: 'grid', gridTemplateColumns: '188px minmax(0,1fr) 312px', gridTemplateRows: 'minmax(0, 1fr)', minHeight: 0, overflow: 'hidden' }}>
        <Shelf />
        <div style={{ position: 'relative', minWidth: 0, overflow: 'hidden' }}>
          <ScoreEditor />
          {stagedEdit && <DiffView />}
        </div>
        <Maestro />
      </div>
      <Stage />

      <AudioGate />
      {surface === 'providers' && <ProvidersModal />}
      {surface === 'arrangement' && <Arrangement />}
      {surface === 'patch' && <PatchDesigner />}
      {surface === 'foundry' && <SampleFoundry />}
      {surface === 'notation' && <NotationBridge />}
    </div>
  );
}

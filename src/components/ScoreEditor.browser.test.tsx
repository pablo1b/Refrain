import { describe, it, expect, beforeEach, onTestFinished } from 'vitest';
import { render, waitFor, act } from '@testing-library/react';
import { ScoreEditor } from './ScoreEditor';
import { cssVar } from '../theme/tokens';
import { useStore } from '../state/store';
import { resetStore } from '../../tests/helpers/store';

// ---------------------------------------------------------------------------
// Browser tier (real Chromium via Playwright). CodeMirror needs a real DOM —
// layout measurement, contenteditable, decoration rendering — so it cannot be
// trusted in happy-dom. Mounting ScoreEditor here proves the editor actually
// renders the document and its voice decorations. The engine is never touched
// because nothing here triggers play()/setScore-while-playing.
// ---------------------------------------------------------------------------

beforeEach(() => resetStore());

describe('ScoreEditor (CodeMirror, real browser)', () => {
  it('renders the live score text into the editor', async () => {
    const { container } = render(<ScoreEditor />);
    await waitFor(() => {
      expect(container.querySelector('.cm-content')?.textContent).toContain('$drums');
    });
    expect(container.querySelector('.cm-content')?.textContent).toContain('nightjar');
  });

  it('decorates every voice sigil with the .cm-voiceSigil class', async () => {
    const { container } = render(<ScoreEditor />);
    await waitFor(() => {
      const sigils = [...container.querySelectorAll('.cm-voiceSigil')].map((n) => n.textContent);
      expect(sigils).toContain('$drums');
      expect(sigils.length).toBeGreaterThanOrEqual(4);
    });
  });

  it('syncs an external store score change into the editor doc', async () => {
    const { container } = render(<ScoreEditor />);
    await waitFor(() => expect(container.querySelector('.cm-content')?.textContent).toContain('$drums'));
    await act(async () => {
      useStore.getState().setScore('$only: s("bd")');
    });
    await waitFor(() => {
      const text = container.querySelector('.cm-content')?.textContent ?? '';
      expect(text).toContain('$only');
      expect(text).not.toContain('$drums');
    });
  });
});

// The mini-roll gutter needs the browser tier unconditionally: GutterMarker.toDOM
// is only called once CodeMirror has laid out and measured the gutter, so these
// markers do not exist at all in happy-dom.
describe('mini-roll gutter (spec §12.5)', () => {
  /** Re-query every time — markers are rebuilt on each setMini effect. */
  const marker = (container: HTMLElement, id: string) =>
    container.querySelector<HTMLElement>(`.cm-minirollMarker[data-voice="${id}"], .cm-minirollOff[data-voice="${id}"]`);

  it('renders a mini-roll marker per voice when the lens is on', async () => {
    const { container } = render(<ScoreEditor />);
    await act(async () => {
      useStore.getState().toggleLens('miniroll');
    });
    await waitFor(() => {
      expect(container.querySelectorAll('.cm-minirollMarker').length).toBeGreaterThanOrEqual(4);
    });
    expect(marker(container, 'drums')).toBeTruthy();
  });

  it('closes the roll → spark → off → roll cycle by clicking the gutter marker', async () => {
    const { container } = render(<ScoreEditor />);
    await act(async () => {
      useStore.getState().toggleLens('miniroll');
    });
    await waitFor(() => expect(marker(container, 'drums')).toBeTruthy());
    expect(marker(container, 'drums')!.dataset.mode).toBe('roll');

    marker(container, 'drums')!.click();
    await waitFor(() => expect(useStore.getState().miniRoll.drums).toBe('spark'));
    expect(marker(container, 'drums')!.dataset.mode).toBe('spark');

    marker(container, 'drums')!.click();
    await waitFor(() => expect(useStore.getState().miniRoll.drums).toBe('off'));
    // the node that did not exist before B-1: `off` had no DOM target at all,
    // so the third click was unreachable and the cycle could never close
    expect(container.querySelector('.cm-minirollOff[data-voice="drums"]')).toBeTruthy();

    marker(container, 'drums')!.click();
    await waitFor(() => expect(useStore.getState().miniRoll.drums).toBe('roll'));
  });

  it('keeps the gutter width stable across modes', async () => {
    const { container } = render(<ScoreEditor />);
    await act(async () => {
      useStore.getState().toggleLens('miniroll');
    });
    await waitFor(() => expect(marker(container, 'drums')).toBeTruthy());
    const rollWidth = container.querySelector('.cm-miniroll')!.getBoundingClientRect().width;

    await act(async () => {
      useStore.getState().cycleMiniRoll('drums');
      useStore.getState().cycleMiniRoll('drums');
    });
    await waitFor(() => expect(container.querySelector('.cm-minirollOff[data-voice="drums"]')).toBeTruthy());
    const offWidth = container.querySelector('.cm-miniroll')!.getBoundingClientRect().width;

    expect(Math.abs(offWidth - rollWidth)).toBeLessThanOrEqual(1);
  });

  // One voice off is not the failing case: the gutter is as wide as its WIDEST
  // marker, so a single narrow `off` hides behind its roll siblings. Only with
  // every voice off does an undersized affordance shrink the gutter and shift the
  // code left — which is what an operator pass measured (100px → 92px).
  it('keeps the gutter width stable with EVERY voice off', async () => {
    // `index.css` applies `* { box-sizing: border-box }` app-wide but is not
    // loaded here, and without it an explicit width silently behaves as
    // content-box — so this test only reproduces the real geometry with the
    // reset in place. Without this line it passes against the broken code.
    const reset = document.createElement('style');
    reset.textContent = '* { box-sizing: border-box; }';
    document.head.appendChild(reset);
    onTestFinished(() => reset.remove());

    const { container } = render(<ScoreEditor />);
    await act(async () => {
      useStore.getState().toggleLens('miniroll');
    });
    await waitFor(() => expect(marker(container, 'drums')).toBeTruthy());
    const gutter = () => container.querySelector('.cm-miniroll')!.getBoundingClientRect().width;
    const contentLeft = () => container.querySelector('.cm-content')!.getBoundingClientRect().left;
    const rollWidth = gutter();
    const rollLeft = contentLeft();

    const ids = useStore.getState().voices.map((v) => v.id);
    expect(ids.length).toBeGreaterThan(1);
    await act(async () => {
      // roll → spark → off, for all of them
      for (const vid of ids) {
        useStore.getState().cycleMiniRoll(vid);
        useStore.getState().cycleMiniRoll(vid);
      }
    });
    await waitFor(() => expect(container.querySelectorAll('.cm-minirollOff')).toHaveLength(ids.length));
    expect(container.querySelectorAll('.cm-minirollMarker')).toHaveLength(0);

    expect(Math.abs(gutter() - rollWidth)).toBeLessThanOrEqual(1);
    expect(Math.abs(contentLeft() - rollLeft)).toBeLessThanOrEqual(1);
  });

  it('renders no mini-roll gutter markers when the lens is off', async () => {
    const { container } = render(<ScoreEditor />);
    await waitFor(() => expect(container.querySelector('.cm-content')).toBeTruthy());
    expect(container.querySelectorAll('.cm-minirollMarker, .cm-minirollOff')).toHaveLength(0);
  });
});

describe('cssVar (getComputedStyle, real browser)', () => {
  it('resolves a themed custom property off <html data-theme>', () => {
    // setup.browser.ts injects the dark theme palette.
    expect(cssVar('--live').toUpperCase()).toBe('#C7F24A');
  });
});

import { describe, it, expect, beforeEach } from 'vitest';
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

describe('cssVar (getComputedStyle, real browser)', () => {
  it('resolves a themed custom property off <html data-theme>', () => {
    // setup.browser.ts injects the dark theme palette.
    expect(cssVar('--live').toUpperCase()).toBe('#C7F24A');
  });
});

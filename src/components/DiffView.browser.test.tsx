import { describe, it, expect, beforeEach } from 'vitest';
import { render, fireEvent, act } from '@testing-library/react';
import { DiffView } from './DiffView';
import { useStore } from '../state/store';
import { resetStore, state } from '../../tests/helpers/store';

// ---------------------------------------------------------------------------
// Browser tier (real Chromium via Playwright). DiffView renders a staged edit
// as a reviewable diff with accept / reject / per-hunk toggle controls. We stage
// a real edit through the store's own pipeline — selectVoice('hats') +
// runDirective('darker') appends `.lpf(600)` to the hats voice and produces one
// hunk. Because `playing` stays false the whole flow NEVER touches the audio
// engine, so no engine mock is needed. We assert on rendered DOM and the
// resulting store state, never on non-deterministic edit/hunk ids.
// ---------------------------------------------------------------------------

beforeEach(() => {
  resetStore();
  state().selectVoice('hats');
  state().runDirective('darker'); // stages one hunk; playing is false → no engine
});

describe('DiffView (staged diff review, real browser)', () => {
  it('renders the appended code on an added (+) diff row', () => {
    const { container } = render(<DiffView />);
    // find the row whose text contains the appended Strudel; it must be marked +
    const rows = [...container.querySelectorAll('div')].filter((d) =>
      (d.textContent ?? '').includes('.lpf(600)'),
    );
    expect(rows.length).toBeGreaterThan(0);
    // the rendered diff somewhere shows a '+' add marker for the new line
    const addRow = rows.find((d) => (d.textContent ?? '').includes('+'));
    expect(addRow).toBeTruthy();
    expect(addRow!.textContent).toContain('.lpf(600)');
  });

  it('shows the hunk count in the footer', () => {
    const { getByText } = render(<DiffView />);
    const count = state().stagedEdit!.hunks.length;
    expect(count).toBe(1);
    // singular form for exactly one hunk
    expect(getByText(`${count} hunk`)).toBeTruthy();
  });

  it('shows the plain (markdown-stripped) summary in the request bar', () => {
    const { container } = render(<DiffView />);
    const text = container.textContent ?? '';
    // summary is "Darker **$hats** — `.lpf(600)` closes the filter." → stripped
    expect(text).toContain('Darker $hats');
    expect(text).toContain('closes the filter');
    // markdown markers must be gone from the rendered request bar summary
    expect(text).not.toContain('**$hats**');
    expect(text).not.toContain('`.lpf(600)`');
  });

  it('Accept all commits the edit: stagedEdit cleared and score gains .lpf(600)', () => {
    const { getByText } = render(<DiffView />);
    expect(state().score).not.toContain('.lpf(600)');
    act(() => {
      fireEvent.click(getByText(/Accept all/));
    });
    expect(state().stagedEdit).toBeNull();
    expect(state().score).toContain('.lpf(600)');
  });

  it('Reject all discards the edit: stagedEdit cleared and score unchanged', () => {
    const before = state().score;
    expect(before).not.toContain('.lpf(600)');
    const { getByText } = render(<DiffView />);
    act(() => {
      fireEvent.click(getByText(/Reject all/));
    });
    expect(state().stagedEdit).toBeNull();
    expect(state().score).toBe(before);
    expect(state().score).not.toContain('.lpf(600)');
  });

  it("toggling a hunk's on/off button disables that hunk in store state", () => {
    const hunkId = state().stagedEdit!.hunks[0].id;
    // staged edits start with every hunk enabled
    expect(state().hunkEnabled[hunkId]).toBe(true);
    const { getByText } = render(<DiffView />);
    act(() => {
      fireEvent.click(getByText('✓ on'));
    });
    expect(state().hunkEnabled[hunkId]).toBe(false);
  });
});

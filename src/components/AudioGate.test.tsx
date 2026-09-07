import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

vi.mock('../audio/strudelEngine', async () => {
  const { createFakeEngine } = await import('../../tests/mocks/engine');
  return { engine: createFakeEngine() };
});

import { AudioGate } from './AudioGate';
import { useStore } from '../state/store';
import { engine } from '../audio/strudelEngine';
import { resetStore } from '../../tests/helpers/store';

beforeEach(() => {
  (engine as any).__reset();
  resetStore();
});

describe('AudioGate transport hint (B-3)', () => {
  it.each([
    ['mod-shift-enter' as const, '⌘⇧⏎'],
    ['f5' as const, 'F5'],
  ])('labels the play button with the configured transport key (%s)', (key, label) => {
    useStore.setState({ engineStatus: 'ready', playing: false, transportKey: key });
    render(<AudioGate />);
    expect(screen.getByRole('button').textContent).toContain(label);
  });

  it('does not show F5 when the configured key is ⌘⇧⏎', () => {
    useStore.setState({ engineStatus: 'ready', playing: false, transportKey: 'mod-shift-enter' });
    render(<AudioGate />);
    expect(screen.getByRole('button').textContent).not.toContain('F5');
  });

  it('renders nothing once playing', () => {
    useStore.setState({ engineStatus: 'ready', playing: true });
    const { container } = render(<AudioGate />);
    expect(container.firstChild).toBeNull();
  });

  it('shows loading and error states without a key hint', () => {
    useStore.setState({ engineStatus: 'loading' });
    const { container, unmount } = render(<AudioGate />);
    expect(container.textContent).toContain('warming up');
    unmount();

    useStore.setState({ engineStatus: 'error', engineError: 'boom' });
    render(<AudioGate />);
    expect(screen.getByText(/audio error: boom/)).toBeTruthy();
  });
});

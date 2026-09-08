import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, act } from '@testing-library/react';

// LiveCycle runs a rAF loop against engine.now()
vi.mock('../audio/strudelEngine', async () => {
  const { createFakeEngine } = await import('../../tests/mocks/engine');
  return { engine: createFakeEngine() };
});

import { Titlebar } from './Titlebar';
import { useStore } from '../state/store';
import { engine } from '../audio/strudelEngine';
import { resetStore, state } from '../../tests/helpers/store';

beforeEach(() => {
  (engine as any).__reset();
  resetStore();
});

describe('Titlebar project identity (B-4)', () => {
  it('renders the live project name, not a hardcoded one', () => {
    useStore.setState({ projectName: 'chunk4b' });
    const { container } = render(<Titlebar />);
    expect(screen.getByText(/chunk4b/)).toBeTruthy();
    expect(container.textContent).not.toContain('nightjar');
  });

  it('follows a project rename', () => {
    const { container } = render(<Titlebar />);
    act(() => state().renameProject('a12scratch'));
    expect(container.textContent).toContain('a12scratch');
    expect(container.textContent).not.toContain('nightjar');
  });

  it.each([
    ['mod-shift-enter' as const, '⌘⇧⏎'],
    ['f5' as const, 'F5'],
  ])('shows the configured transport key in the transport tooltip (%s)', (key, label) => {
    useStore.setState({ transportKey: key });
    render(<Titlebar />);
    expect(screen.getByLabelText('play/stop').getAttribute('title')).toContain(label);
  });
});

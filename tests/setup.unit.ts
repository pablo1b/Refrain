import '@testing-library/jest-dom/vitest';
import { afterEach, vi } from 'vitest';
import { cleanup } from '@testing-library/react';

// Unmount React trees and clear localStorage between tests so component and
// store tests never leak state into each other.
afterEach(() => {
  cleanup();
  localStorage.clear();
  vi.clearAllMocks();
});

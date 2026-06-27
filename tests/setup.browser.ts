import '@testing-library/jest-dom/vitest';
import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';

afterEach(() => {
  cleanup();
  localStorage.clear();
});

// Inject the app's theme custom properties onto <html data-theme="dark"> so
// browser-tier tests can assert real getComputedStyle() values (theme/tokens.ts
// cssVar()) without booting the whole app. Keep in sync with src/index.css.
const THEME_VARS = `
:root[data-theme="dark"]{
  --live:#C7F24A; --maestro:#C7F24A; --panic:#F2545B;
  --text:#E8E8EA; --text-1:#D8D8DC; --text-dim:#8A8A92;
  --panel:#16161A; --line-3:#2A2A30; --line-4:#33333A; --line-5:#3D3D45;
}
:root[data-theme="light"]{
  --live:#5A8F00; --maestro:#5A8F00; --panic:#C0392B;
  --text:#16161A; --panel:#FFFFFF;
}`;

const style = document.createElement('style');
style.textContent = THEME_VARS;
document.head.appendChild(style);
document.documentElement.setAttribute('data-theme', 'dark');

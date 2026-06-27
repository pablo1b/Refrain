// Strudel ships untyped ESM. We use a narrow `any` surface via the engine
// wrapper; these ambient declarations keep the type-checker happy.
declare module '@strudel/web';
declare module '@strudel/transpiler';
declare module '@strudel/core';
declare module '@strudel/webaudio';

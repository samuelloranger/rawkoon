// Service Worker type definitions
/// <reference lib="webworker" />

// Service workers do not expose `window`; make accidental usage a type error.
declare const window: never;

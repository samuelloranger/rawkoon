// Service Worker type definitions
/// <reference lib="webworker" />

// Service workers do not expose `window`; make accidental usage a type error.
declare const window: never;

/** Injected by vite `define`; see vite.config.ts and vite-plugin-service-worker. */
declare const __BUILD_ID__: string;

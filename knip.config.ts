import type { KnipConfig } from "knip";

const config: KnipConfig = {
  workspaces: {
    ".": {
      entry: [],
      project: [],
      // eslint-config-prettier is referenced via a string `extends: "prettier"`
      // in eslint.config.mjs (FlatCompat), not a JS import — knip can't see it.
      ignoreDependencies: ["eslint-config-prettier"],
    },
    "apps/api": {
      project: ["src/**/*.ts"],
      // @react-email/*: JSX imports in emailService — knip misses JSX-only deps
      ignoreDependencies: ["@react-email/components", "@react-email/tailwind"],
    },
    "apps/web": {
      // index.html -> main.tsx is auto-detected by knip's Vite plugin. The
      // generated route tree is gitignored (so knip skips it by default) yet
      // it's what consumes every page's `Route` export — list it explicitly so
      // those route definitions aren't mis-flagged as unused. The service
      // worker is a separate entry.
      entry: ["src/sw/index.ts", "src/routeTree.gen.ts"],
      project: ["src/**/*.{ts,tsx}"],
      // @tailwindcss/typography: CSS @plugin directive — not a JS import, knip can't see it
      ignoreDependencies: ["@tailwindcss/typography"],
    },
    "apps/shared": {
      project: ["src/**/*.ts"],
      // includeEntryExports: report unused exports from src/index.ts so dead
      // shared code is surfaced even though it's an "entry" file.
      includeEntryExports: true,
    },
  },
  // elysia at root is a workspace-hoisted dep; the real consumer is apps/api
  ignoreDependencies: ["elysia"],
};

export default config;

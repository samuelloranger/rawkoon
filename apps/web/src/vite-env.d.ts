/// <reference types="vite/client" />

import type { User } from "@rawkoon/shared/types";

interface ImportMetaEnv {
  readonly PROD: boolean;
  readonly DEV: boolean;
  readonly MODE: string;
  // Add other env variables here as needed
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

declare global {
  interface Window {
    __RAWKOON_BOOTSTRAP__?: {
      user: User | null;
    };
  }
}

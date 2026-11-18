import { auth } from "@rawkoon/api/lib/auth";
import type { McpScope } from "@rawkoon/shared/types";

// The `Auth` cast in lib/auth.ts (required because `composite` needs a nameable
// type) erases the apiKey plugin's endpoint types. Re-expose the few we call
// with a precise local shape so consumers stay type-safe without `any`.
//
// Kept in its own module (not lib/auth.ts) so tests can mock `apiKeyApi` at a
// narrow seam without colliding with the many tests that mock `lib/auth`.
export const apiKeyApi = auth.api as unknown as {
  verifyApiKey: (args: { body: { key: string } }) => Promise<{
    valid: boolean;
    key: {
      id: string;
      name: string | null;
      referenceId: string;
      /** Parsed from the stored JSON string by the plugin; null when unset. */
      permissions: Record<string, string[]> | null;
    } | null;
  }>;
  createApiKey: (args: {
    body: {
      name?: string;
      expiresIn?: number | null;
      // The plugin stores permissions as a JSON string column; we only ever
      // write the "mcp" resource, preserving any other resources is done on
      // update, not create.
      permissions?: Record<string, string[]>;
    };
    headers: Headers;
  }) => Promise<{ id: string; key: string }>;
  // Server-only call (no headers): the plugin rejects `permissions` updates
  // through an HTTP context, and `userId` is the passthrough it authorizes by.
  updateApiKey: (args: {
    body: {
      keyId: string;
      userId: string;
      permissions?: Record<string, string[]>;
    };
  }) => Promise<unknown>;
};

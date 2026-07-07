import { auth } from "@rawkoon/api/lib/auth";

// The `Auth` cast in lib/auth.ts (required because `composite` needs a nameable
// type) erases the apiKey plugin's endpoint types. Re-expose the few we call
// with a precise local shape so consumers stay type-safe without `any`.
//
// Kept in its own module (not lib/auth.ts) so tests can mock `apiKeyApi` at a
// narrow seam without colliding with the many tests that mock `lib/auth`.
export const apiKeyApi = auth.api as unknown as {
  verifyApiKey: (args: {
    body: { key: string };
  }) => Promise<{ valid: boolean }>;
  createApiKey: (args: {
    body: { name?: string; expiresIn?: number | null };
    headers: Headers;
  }) => Promise<{ id: string; key: string }>;
};

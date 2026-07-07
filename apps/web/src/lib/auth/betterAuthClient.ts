import { createAuthClient } from "better-auth/client";
import { passkeyClient } from "@better-auth/passkey/client";
import { genericOAuthClient } from "better-auth/client/plugins";

export const authClient = createAuthClient({
  baseURL: import.meta.env.VITE_API_URL || window.location.origin,
  plugins: [passkeyClient(), genericOAuthClient()],
});

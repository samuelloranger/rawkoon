import { createHash } from "node:crypto";

export const generateOpaqueToken = (): string => {
  const tokenBytes = new Uint8Array(32);
  crypto.getRandomValues(tokenBytes);
  return btoa(String.fromCharCode(...tokenBytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=/g, "");
};

export const hashOpaqueToken = (token: string): string =>
  createHash("sha256").update(token).digest("hex");

export const opaqueTokenCandidates = (token: string): string[] => {
  const hashed = hashOpaqueToken(token);
  return hashed === token ? [token] : [token, hashed];
};

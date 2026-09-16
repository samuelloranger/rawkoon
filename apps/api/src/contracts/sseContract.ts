import contractArtifact from "../../../shared/contracts/sse-contract.v1.json" with {
  type: "json",
};

export const SSE_CONTRACT_IDS = [
  "library.media-update",
  "library.book-update",
  "library.handshake",
  "notifications.notification",
  "notifications.handshake",
  "library.migrate-status",
  "admin.jobs-status",
] as const;

export type SSEContractID = (typeof SSE_CONTRACT_IDS)[number];

export type SSEContractEntry = {
  id: SSEContractID;
  path: string;
  kind: string;
  payload: Record<string, string>;
  ios_policy: "patch" | "invalidate" | "progress";
};

export const sseContract =
  contractArtifact as unknown as readonly SSEContractEntry[];

export function contractIDs(): SSEContractID[] {
  return [...SSE_CONTRACT_IDS];
}

export function registeredSseRouteIDs(): SSEContractID[] {
  return [...SSE_CONTRACT_IDS];
}

export function validateSseContract(): string[] {
  const ids = new Set<string>();
  const artifactIDs = new Set(sseContract.map((entry) => entry.id));
  for (const entry of sseContract) {
    if (!entry.id || ids.has(entry.id)) return [entry.id || "missing-id"];
    if (!entry.path.startsWith("/api/") || !entry.kind) return [entry.id];
    if (!entry.payload || Object.keys(entry.payload).length === 0)
      return [entry.id];
    if (!["patch", "invalidate", "progress"].includes(entry.ios_policy))
      return [entry.id];
    ids.add(entry.id);
  }
  return artifactIDs.size === SSE_CONTRACT_IDS.length &&
    SSE_CONTRACT_IDS.every((id) => artifactIDs.has(id))
    ? []
    : ["artifact-ids"];
}

export function assertSseContractIDs(ids: readonly SSEContractID[]): void {
  const known = new Set(SSE_CONTRACT_IDS);
  for (const id of ids) {
    if (!known.has(id)) throw new Error(`Unknown SSE contract ID: ${id}`);
  }
}

import contractArtifact from "../../../shared/contracts/sse-contract.v1.json" with {
  type: "json",
};

/** Route declarations are consumed directly by each SSE route handler. */
export const SSE_ROUTE_DECLARATIONS = {
  libraryEvents: {
    path: "/api/library/events",
    ids: ["library.media-update", "library.book-update", "library.handshake"],
  },
  notificationsStream: {
    path: "/api/notifications/stream",
    ids: ["notifications.notification", "notifications.handshake"],
  },
  libraryMigrateStatus: {
    path: "/api/library/migrate/status",
    ids: ["library.migrate-status"],
  },
  adminJobsEvents: {
    path: "/api/admin/jobs/events",
    ids: ["admin.jobs-status"],
  },
} as const;

type SseRouteDeclaration =
  (typeof SSE_ROUTE_DECLARATIONS)[keyof typeof SSE_ROUTE_DECLARATIONS];

export type SSEContractID = SseRouteDeclaration["ids"][number];

export type SSEEventRouting =
  | { type: "payload-field"; field: string; value: string }
  | { type: "required-fields"; fields: readonly string[] }
  | { type: "endpoint" };

export type SSEContractEntry = {
  id: SSEContractID;
  path: string;
  routing: SSEEventRouting;
  payload: Record<string, string>;
  ios_policy: "patch" | "invalidate" | "progress";
};

export const sseContract =
  contractArtifact as unknown as readonly SSEContractEntry[];

export function contractIDs(): SSEContractID[] {
  return sseContract.map((entry) => entry.id);
}

export function registeredSseRouteIDs(): SSEContractID[] {
  return Object.values(SSE_ROUTE_DECLARATIONS).flatMap(({ ids }) => [...ids]);
}

export function validateSseContract(): string[] {
  const ids = new Set<string>();
  const declarationsByID = new Map(
    Object.values(SSE_ROUTE_DECLARATIONS).flatMap(({ ids, path }) =>
      ids.map((id) => [id, path] as const),
    ),
  );
  for (const entry of sseContract) {
    if (!entry.id || ids.has(entry.id)) return [entry.id || "missing-id"];
    if (
      !entry.path.startsWith("/api/") ||
      declarationsByID.get(entry.id) !== entry.path
    )
      return [entry.id];
    if (!entry.payload || Object.keys(entry.payload).length === 0)
      return [entry.id];
    if (
      entry.routing?.type === "payload-field" &&
      (!entry.routing.field || !entry.routing.value)
    )
      return [entry.id];
    if (
      entry.routing?.type === "required-fields" &&
      (!entry.routing.fields.length ||
        !entry.routing.fields.every((field) => field in entry.payload))
    )
      return [entry.id];
    if (
      entry.routing?.type !== "payload-field" &&
      entry.routing?.type !== "required-fields" &&
      entry.routing?.type !== "endpoint"
    )
      return [entry.id];
    if (!["patch", "invalidate", "progress"].includes(entry.ios_policy))
      return [entry.id];
    ids.add(entry.id);
  }
  const routeIDs = registeredSseRouteIDs();
  return ids.size === routeIDs.length && routeIDs.every((id) => ids.has(id))
    ? []
    : ["artifact-ids"];
}

export function assertSseContractIDs(ids: readonly SSEContractID[]): void {
  const known = new Set(registeredSseRouteIDs());
  for (const id of ids) {
    if (!known.has(id)) throw new Error(`Unknown SSE contract ID: ${id}`);
  }
}

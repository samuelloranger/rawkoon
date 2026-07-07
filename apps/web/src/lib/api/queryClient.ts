import type { QueryClient } from "@tanstack/react-query";
import { queryKeys } from "@/lib/queryKeys";

let queryClientInstance: QueryClient | null = null;

export function setQueryClient(client: QueryClient): void {
  queryClientInstance = client;
}

export function getQueryClient(): QueryClient | null {
  return queryClientInstance;
}

export function invalidateAuthCache(): void {
  if (queryClientInstance) {
    queryClientInstance.invalidateQueries({ queryKey: queryKeys.auth.all });
    queryClientInstance.setQueryData(queryKeys.auth.me, null);
  }
}

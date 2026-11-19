import { useMutation } from "@tanstack/react-query";
import { useFetcher } from "@/lib/api/context";
import type { ConnectionTestResult } from "@rawkoon/shared/types";

/** Probes the typed values (or the stored ones when a field is blank) without saving. */
export function useTestIntegration(endpoint: string) {
  const fetcher = useFetcher();
  return useMutation({
    mutationFn: (body: { website_url?: string; api_key?: string }) =>
      fetcher<ConnectionTestResult>(endpoint, { method: "POST", body }),
  });
}

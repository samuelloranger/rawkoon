import { useMutation } from "@tanstack/react-query";
import { useFetcher } from "@/lib/api/context";
import { LIBRARY_ENDPOINTS } from "@/lib/endpoints";
import type {
  MigrateLibraryRequest,
  MigrateLibraryEnqueueResponse,
} from "@rawkoon/shared/types";

export function useStartMigration() {
  const fetcher = useFetcher();

  return useMutation({
    mutationFn: (body: MigrateLibraryRequest) =>
      fetcher<MigrateLibraryEnqueueResponse>(LIBRARY_ENDPOINTS.MIGRATE, {
        method: "POST",
        body,
      }),
  });
}

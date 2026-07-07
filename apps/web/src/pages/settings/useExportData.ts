import { useMutation } from "@tanstack/react-query";
import { useFetcher } from "@/lib/api/context";
import { ADMIN_ENDPOINTS } from "@/lib/endpoints";
import type { ExportDataResponse } from "@rawkoon/shared/types";

export function useExportData() {
  const fetcher = useFetcher();

  return useMutation({
    mutationFn: () => fetcher<ExportDataResponse>(ADMIN_ENDPOINTS.EXPORT),
  });
}

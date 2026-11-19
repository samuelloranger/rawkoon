import { useQuery } from "@tanstack/react-query";
import { useFetcher } from "@/lib/api/context";
import { queryKeys } from "@/lib/queryKeys";
import { ADMIN_ENDPOINTS } from "@/lib/endpoints";
import type { DoctorReport } from "@rawkoon/shared/types";

/** Probes external services, so it only runs on refetch(), never on mount. */
export function useDoctor() {
  const fetcher = useFetcher();

  return useQuery({
    queryKey: queryKeys.admin.doctor(),
    queryFn: () => fetcher<DoctorReport>(ADMIN_ENDPOINTS.DOCTOR),
    enabled: false,
    staleTime: Infinity,
  });
}

import { useQuery } from "@tanstack/react-query";
import { useFetcher } from "@/lib/api/context";
import { queryKeys } from "@/lib/queryKeys";
import { LIBRARY_ENDPOINTS } from "@/lib/endpoints";
import type { LibraryFilesResponse } from "@rawkoon/shared/types";

export function useLibraryFiles(id: number | null) {
  const fetcher = useFetcher();

  return useQuery({
    queryKey: queryKeys.library.files(id),
    queryFn: () => fetcher<LibraryFilesResponse>(LIBRARY_ENDPOINTS.FILES(id!)),
    enabled: id !== null,
    staleTime: 0,
    gcTime: 0,
  });
}

import { useQuery } from "@tanstack/react-query";
import { useFetcher } from "@/lib/api/context";
import { queryKeys } from "@/lib/queryKeys";
import { LIBRARY_ENDPOINTS } from "@/lib/endpoints";

export function useLibraryLanguageTags() {
  const fetcher = useFetcher();
  return useQuery({
    queryKey: queryKeys.library.languageTags(),
    queryFn: () => fetcher<{ tags: string[] }>(LIBRARY_ENDPOINTS.LANGUAGE_TAGS),
    staleTime: 5 * 60_000,
  });
}

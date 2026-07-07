import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useFetcher } from "@/lib/api/context";
import { queryKeys } from "@/lib/queryKeys";
import { LIBRARY_ENDPOINTS } from "@/lib/endpoints";
import type { GlobalDownloadHistoryResponse } from "@rawkoon/shared/types";

export function useGlobalDownloadHistory(params?: {
  page?: number;
  status?: string;
  days?: number;
}) {
  const fetcher = useFetcher();

  // Normalize params down to exactly what the request URL encodes so the query
  // key can't fragment across inputs that resolve to the same request (e.g.
  // page:1, status:"all", and days:0 are all omitted from the URL).
  const normalized: { page?: number; status?: string; days?: number } = {};
  if (params?.page && params.page > 1) normalized.page = params.page;
  if (params?.status && params.status !== "all")
    normalized.status = params.status;
  if (params?.days && params.days > 0) normalized.days = params.days;

  const search = new URLSearchParams();
  if (normalized.page) search.set("page", String(normalized.page));
  if (normalized.status) search.set("status", normalized.status);
  if (normalized.days) search.set("days", String(normalized.days));
  const qs = search.toString();
  const url = qs
    ? `${LIBRARY_ENDPOINTS.DOWNLOAD_HISTORY}?${qs}`
    : LIBRARY_ENDPOINTS.DOWNLOAD_HISTORY;

  return useQuery({
    queryKey: queryKeys.library.downloadHistory(normalized),
    queryFn: () => fetcher<GlobalDownloadHistoryResponse>(url),
    placeholderData: keepPreviousData,
  });
}

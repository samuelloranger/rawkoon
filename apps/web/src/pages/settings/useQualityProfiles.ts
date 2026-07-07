import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useFetcher } from "@/lib/api/context";
import { queryKeys } from "@/lib/queryKeys";
import { QUALITY_PROFILES_ENDPOINTS, MEDIAS_ENDPOINTS } from "@/lib/endpoints";
import type {
  QualityProfile,
  QualityProfileMutationResponse,
  QualityProfilesListResponse,
  ProwlarrIndexersResponse,
} from "@rawkoon/shared/types";

export function useQualityProfilesList(options?: {
  staleTime?: number;
  gcTime?: number;
}) {
  const fetcher = useFetcher();
  return useQuery({
    queryKey: queryKeys.qualityProfiles.list(),
    queryFn: () =>
      fetcher<QualityProfilesListResponse>(QUALITY_PROFILES_ENDPOINTS.LIST),
    ...options,
  });
}

export type QualityProfileFormPayload = {
  name: string;
  min_resolution: number;
  preferred_sources: string[];
  preferred_codecs: string[];
  preferred_languages: string[];
  prioritized_trackers: string[];
  prefer_tracker_over_quality: boolean;
  max_size_gb: number | null;
  require_hdr: boolean;
  prefer_hdr: boolean;
  cutoff_resolution: number | null;
  min_seeders: number;
  custom_formats: {
    custom_format_id: number;
    score: number;
    required: boolean;
    forbidden: boolean;
  }[];
};

export function useCreateQualityProfile() {
  const fetcher = useFetcher();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: QualityProfileFormPayload) =>
      fetcher<QualityProfileMutationResponse>(
        QUALITY_PROFILES_ENDPOINTS.CREATE,
        { method: "POST", body },
      ),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: queryKeys.qualityProfiles.all,
      });
    },
  });
}

export function useUpdateQualityProfile() {
  const fetcher = useFetcher();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      body,
    }: {
      id: number;
      body: QualityProfileFormPayload;
    }) =>
      fetcher<QualityProfileMutationResponse>(
        QUALITY_PROFILES_ENDPOINTS.UPDATE(id),
        { method: "PUT", body },
      ),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: queryKeys.qualityProfiles.all,
      });
      queryClient.invalidateQueries({ queryKey: queryKeys.library.all });
    },
  });
}

export function useDeleteQualityProfile() {
  const fetcher = useFetcher();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: number) =>
      fetcher<{ success: boolean }>(QUALITY_PROFILES_ENDPOINTS.DELETE(id), {
        method: "DELETE",
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: queryKeys.qualityProfiles.all,
      });
      queryClient.invalidateQueries({ queryKey: queryKeys.library.all });
    },
  });
}

export function profileToForm(p: QualityProfile): QualityProfileFormPayload {
  return {
    name: p.name,
    min_resolution: p.min_resolution,
    preferred_sources: [...p.preferred_sources],
    preferred_codecs: [...p.preferred_codecs],
    preferred_languages: [...(p.preferred_languages ?? [])],
    prioritized_trackers: [...(p.prioritized_trackers ?? [])],
    prefer_tracker_over_quality: p.prefer_tracker_over_quality ?? false,
    max_size_gb: p.max_size_gb,
    require_hdr: p.require_hdr,
    prefer_hdr: p.prefer_hdr,
    cutoff_resolution: p.cutoff_resolution,
    min_seeders: p.min_seeders ?? 0,
    custom_formats: (p.custom_formats ?? []).map(
      ({ custom_format_id, score, required, forbidden }) => ({
        custom_format_id,
        score,
        required,
        forbidden,
      }),
    ),
  };
}

export function useIndexers(enabled: boolean) {
  const fetcher = useFetcher();
  return useQuery({
    queryKey: queryKeys.indexerManager.indexers(),
    queryFn: () => fetcher<ProwlarrIndexersResponse>(MEDIAS_ENDPOINTS.INDEXERS),
    enabled,
    staleTime: 60_000,
  });
}

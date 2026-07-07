import type { QualityProfileCustomFormatAssignment } from "./customFormats";

export interface QualityProfile {
  id: number;
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
  custom_formats: QualityProfileCustomFormatAssignment[];
  created_at: string;
  updated_at: string;
}

interface ProwlarrIndexer {
  id: number;
  name: string;
  protocol: string;
  enable: boolean;
  privacy: "private" | "public" | string;
}

export interface ProwlarrIndexersResponse {
  indexers: ProwlarrIndexer[];
}

export interface QualityProfilesListResponse {
  profiles: QualityProfile[];
}

export interface QualityProfileMutationResponse {
  profile: QualityProfile;
}

export interface UpdateLibraryQualityProfileRequest {
  quality_profile_id: number | null;
}

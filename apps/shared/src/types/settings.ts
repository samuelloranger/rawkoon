interface AppSettings {
  country_code: string;
  upcoming_window_months: number;
  upcoming_languages: string;
  /** Gates the whole book library: navigation, workers, and RSS categories. */
  books_enabled: boolean;
  updated_at: string;
}

export interface AppSettingsResponse {
  settings: AppSettings;
}

export interface UpdateAppSettingsRequest {
  country_code?: string;
  upcoming_window_months?: number;
  upcoming_languages?: string;
  books_enabled?: boolean;
}

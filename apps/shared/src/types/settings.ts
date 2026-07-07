interface AppSettings {
  country_code: string;
  upcoming_window_months: number;
  upcoming_languages: string;
  updated_at: string;
}

export interface AppSettingsResponse {
  settings: AppSettings;
}

export interface UpdateAppSettingsRequest {
  country_code?: string;
  upcoming_window_months?: number;
  upcoming_languages?: string;
}

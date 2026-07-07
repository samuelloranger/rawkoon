export type NavPosition = "left" | "right" | "top" | "bottom";

export interface User {
  id: string;
  email: string;
  first_name: string | null;
  last_name: string | null;
  is_admin: boolean;
  locale?: string | null;
  last_login: string | null;
  created_at: string;
  last_activity: string | null;
  avatar_url?: string | null;
  has_passkey?: boolean;
  nav_position?: NavPosition | null;
}

export interface UserResponse {
  user: User | null;
}

export interface UpdateProfileRequest {
  first_name?: string | null;
  last_name?: string | null;
  locale?: string | null;
  nav_position?: NavPosition | null;
}

export interface ChangePasswordRequest {
  current_password: string;
  new_password: string;
}

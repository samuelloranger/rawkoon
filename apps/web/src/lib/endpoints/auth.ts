export const AUTH_ENDPOINTS = {
  ME: "/api/auth/me",
  LOGIN: "/api/auth/sign-in/email",
  LOGOUT: "/api/auth/sign-out",
  FORGOT_PASSWORD: "/api/auth/forget-password",
  RESET_PASSWORD: "/api/auth/reset-password",
  ACCEPT_INVITATION: "/api/auth/accept-invitation",
  SSO_PROVIDERS: "/api/auth/sso-providers",
} as const;

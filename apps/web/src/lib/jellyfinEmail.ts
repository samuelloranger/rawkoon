const PLACEHOLDER_SUFFIX = "@jellyfin.invalid";

/** Accounts created from Jellyfin carry a placeholder address that can never receive mail. */
export function isJellyfinPlaceholderEmail(email: string): boolean {
  return email.toLowerCase().endsWith(PLACEHOLDER_SUFFIX);
}

export function displayEmail(email: string): string {
  return isJellyfinPlaceholderEmail(email) ? "—" : email;
}

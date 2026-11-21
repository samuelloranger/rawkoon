import { PASSWORD_RULES } from "@rawkoon/shared/utils/validation";

/**
 * The server's password complexity rules (shared/utils/validation.ts), with
 * translated messages: `true` when the password passes, else the first problem.
 */
export function validatePasswordComplexity(
  value: string,
  t: (key: string) => string,
): string | true {
  if (PASSWORD_RULES.requireUppercase && !/[A-Z]/.test(value))
    return t("login.passwordNeedsUppercase");
  if (PASSWORD_RULES.requireLowercase && !/[a-z]/.test(value))
    return t("login.passwordNeedsLowercase");
  if (PASSWORD_RULES.requireNumber && !/[0-9]/.test(value))
    return t("login.passwordNeedsNumber");
  if (
    PASSWORD_RULES.requireSpecialChar &&
    !/[!@#$%^&*(),.?":{}|<>]/.test(value)
  )
    return t("login.passwordNeedsSpecialChar");
  return true;
}

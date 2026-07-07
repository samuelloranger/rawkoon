const EMAIL_REGEX =
  /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9-]+(?:\.[a-zA-Z0-9-]+)*\.[a-zA-Z]{2,}$/;

export function validateEmail(email: string): boolean {
  if (!email) return false;
  return EMAIL_REGEX.test(email);
}

const PASSWORD_RULES = {
  minLength: 8,
  requireUppercase: true,
  requireLowercase: true,
  requireNumber: true,
  requireSpecialChar: true,
} as const;

export function validatePassword(password: string): [boolean, string | null] {
  if (!password) {
    return [false, "Password is required"];
  }
  if (password.length < PASSWORD_RULES.minLength) {
    return [false, "Password must be at least 8 characters long"];
  }
  if (PASSWORD_RULES.requireUppercase && !/[A-Z]/.test(password)) {
    return [false, "Password must contain at least one uppercase letter"];
  }
  if (PASSWORD_RULES.requireLowercase && !/[a-z]/.test(password)) {
    return [false, "Password must contain at least one lowercase letter"];
  }
  if (PASSWORD_RULES.requireNumber && !/[0-9]/.test(password)) {
    return [false, "Password must contain at least one number"];
  }
  if (
    PASSWORD_RULES.requireSpecialChar &&
    !/[!@#$%^&*(),.?":{}|<>]/.test(password)
  ) {
    return [false, "Password must contain at least one special character"];
  }
  return [true, null];
}

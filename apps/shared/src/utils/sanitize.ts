export const sanitizeInput = (input: string): string => {
  return input.replace(/</g, "&lt;").replace(/>/g, "&gt;");
};

export const isValidColor = (color: string): boolean => {
  return /^#[0-9A-Fa-f]{6}$/.test(color) || /^[a-zA-Z]+$/.test(color);
};

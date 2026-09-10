export const hasUpdates = (data: Record<string, unknown>): boolean => {
  return Object.keys(data).length > 0;
};

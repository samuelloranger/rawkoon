/**
 * Returns true if the update data object has at least one field to update.
 */
export const hasUpdates = (data: Record<string, unknown>): boolean => {
  return Object.keys(data).length > 0;
};

/** Tracker-supplied links are rendered as hrefs; only http(s) is safe. */
export const httpUrlOrNull = (value: string | null | undefined) => {
  if (!value) return null;
  try {
    const { protocol } = new URL(value);
    return protocol === "http:" || protocol === "https:" ? value : null;
  } catch {
    return null;
  }
};

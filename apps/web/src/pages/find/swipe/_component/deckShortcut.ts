const TEXT_FIELD = "input, textarea, select, [contenteditable], [role=dialog]";

/** False while typing, in a dialog, or when Enter is meant to press a focused button or link. */
export function isDeckShortcut(e: KeyboardEvent): boolean {
  if (e.metaKey || e.ctrlKey || e.altKey) return false;
  const el = e.target instanceof Element ? e.target : null;
  if (el?.closest(TEXT_FIELD)) return false;
  return !(e.key === "Enter" && el?.closest("button, a"));
}

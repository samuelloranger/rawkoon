export function resolveReadingPosition(
  position: {
    spine_index: number;
    spine_path: string;
    scroll_fraction: number;
  },
  spine: string[],
): { index: number; scrollFraction: number } {
  if (spine.length === 0) return { index: 0, scrollFraction: 0 };
  if (
    position.spine_index >= 0 &&
    position.spine_index < spine.length &&
    spine[position.spine_index] === position.spine_path
  ) {
    return {
      index: position.spine_index,
      scrollFraction: position.scroll_fraction,
    };
  }
  const moved = spine.indexOf(position.spine_path);
  if (moved !== -1) {
    return { index: moved, scrollFraction: position.scroll_fraction };
  }
  return {
    index: Math.min(Math.max(position.spine_index, 0), spine.length - 1),
    scrollFraction: 0,
  };
}

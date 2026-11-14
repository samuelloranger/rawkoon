import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type DragEvent,
} from "react";

/**
 * Drag to reorder with the list moving under the pointer: the dragged item
 * takes each slot it passes, the others slide out of its way, and the new order
 * is committed once, when it's let go anywhere on the page. Escape puts it back.
 * Native drag events only (no library), so mouse and trackpad; touch uses the
 * move buttons.
 */
export function useLiveReorder<T>({
  items,
  idOf,
  move,
  onCommit,
  enabled,
}: {
  items: readonly T[];
  idOf: (item: T) => number;
  /** The list with the item at `from` moved to `to`. */
  move: (list: readonly T[], from: number, to: number) => T[];
  onCommit: (next: T[], movedId: number) => void;
  enabled: boolean;
}) {
  const [drag, setDrag] = useState<{ id: number; to: number } | null>(null);
  const from = drag ? items.findIndex((item) => idOf(item) === drag.id) : -1;
  const display =
    drag && from >= 0 && drag.to !== from ? move(items, from, drag.to) : items;

  // While dragging, the whole page accepts the drop: letting go just past the
  // list's edge keeps the new order instead of snapping back
  const commit = useRef<() => void>(() => {});
  commit.current = () => {
    if (drag && from >= 0 && drag.to !== from) {
      onCommit(move(items, from, drag.to), drag.id);
    }
    setDrag(null);
  };
  const dragging = drag !== null;
  useEffect(() => {
    if (!dragging) return;
    const over = (event: globalThis.DragEvent) => {
      event.preventDefault();
      if (event.dataTransfer) event.dataTransfer.dropEffect = "move";
    };
    const drop = (event: globalThis.DragEvent) => {
      event.preventDefault();
      commit.current();
    };
    document.addEventListener("dragover", over);
    document.addEventListener("drop", drop);
    return () => {
      document.removeEventListener("dragover", over);
      document.removeEventListener("drop", drop);
    };
  }, [dragging]);

  // FLIP: rows that changed place start where they were and glide to the new slot.
  // Offsets, not screen positions, so scrolling mid-drag doesn't read as movement.
  const nodes = useRef(new Map<number, HTMLElement>());
  const spots = useRef(new Map<number, { x: number; y: number }>());
  useLayoutEffect(() => {
    const next = new Map<number, { x: number; y: number }>();
    for (const [id, node] of nodes.current) {
      const spot = { x: node.offsetLeft, y: node.offsetTop };
      next.set(id, spot);
      const before = spots.current.get(id);
      if (!before || (before.x === spot.x && before.y === spot.y)) continue;
      node.style.transition = "none";
      node.style.transform = `translate(${before.x - spot.x}px, ${before.y - spot.y}px)`;
      requestAnimationFrame(() => {
        node.style.transition = "transform 160ms ease-out";
        node.style.transform = "";
      });
    }
    spots.current = next;
  });

  const rowProps = (item: T, index: number) => {
    const id = idOf(item);
    return {
      ref: (node: HTMLElement | null) => {
        if (node) nodes.current.set(id, node);
        else nodes.current.delete(id);
      },
      draggable: enabled,
      "data-dragging": drag?.id === id || undefined,
      onDragStart: (event: DragEvent) => {
        if (!enabled) return;
        // Firefox starts a drag only once something is set on the transfer
        event.dataTransfer.setData("text/plain", String(id));
        event.dataTransfer.effectAllowed = "move";
        setDrag({ id, to: index });
      },
      onDragOver: (event: DragEvent) => {
        if (!drag || drag.id === id || drag.to === index) return;
        const box = event.currentTarget.getBoundingClientRect();
        const pointer = { x: event.clientX ?? 0, y: event.clientY ?? 0 };
        if (takesSlot(index, drag.to, pointer, box, isGrid(event))) {
          setDrag({ id: drag.id, to: index });
        }
      },
      onDragEnd: () => setDrag(null),
    };
  };

  return { display, dragging: drag?.id ?? null, rowProps };
}

/**
 * Whether the pointer has gone past the middle of the row at `index`, coming from
 * slot `to`, so a row doesn't flicker between two places. In a grid, items sit
 * side by side, so passing a neighbour's middle sideways counts too.
 */
export function takesSlot(
  index: number,
  to: number,
  pointer: { x: number; y: number },
  box: { top: number; left: number; width: number; height: number },
  grid: boolean,
): boolean {
  const down = index > to;
  const midY = box.top + box.height / 2;
  const midX = box.left + box.width / 2;
  if (down ? pointer.y > midY : pointer.y < midY) return true;
  return grid && (down ? pointer.x > midX : pointer.x < midX);
}

function isGrid(event: DragEvent): boolean {
  const parent = (event.currentTarget as HTMLElement).parentElement;
  return !!parent && getComputedStyle(parent).display === "grid";
}

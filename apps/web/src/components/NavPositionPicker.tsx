import { cn } from "@/lib/utils";
import type { NavPosition } from "@rawkoon/shared/types";

const POSITIONS: { value: NavPosition; label: string }[] = [
  { value: "left", label: "Left" },
  { value: "right", label: "Right" },
  { value: "top", label: "Top" },
  { value: "bottom", label: "Bottom" },
];

function LayoutPreview({ value }: { value: NavPosition }) {
  const isHorizontal = value === "top" || value === "bottom";

  const shell = cn(
    "flex gap-0.5 w-10 h-7 rounded overflow-hidden border border-neutral-600",
    {
      "flex-row": value === "left",
      "flex-row-reverse": value === "right",
      "flex-col": value === "top",
      "flex-col-reverse": value === "bottom",
    },
  );

  const rail = cn("bg-neutral-500 rounded-sm", {
    "w-2 h-full": !isHorizontal,
    "h-1.5 w-full": isHorizontal,
  });

  return (
    <div className={shell}>
      <div className={rail} />
      <div className="flex-1 bg-neutral-700 rounded-sm" />
    </div>
  );
}

interface NavPositionPickerProps {
  value: NavPosition;
  onChange: (position: NavPosition) => void;
}

export function NavPositionPicker({ value, onChange }: NavPositionPickerProps) {
  return (
    <div className="flex gap-2">
      {POSITIONS.map((p) => (
        <button
          key={p.value}
          type="button"
          onClick={() => onChange(p.value)}
          className={cn(
            "flex flex-col items-center gap-1.5 rounded-lg border p-2 transition-colors text-xs font-medium",
            value === p.value
              ? "border-primary-500 bg-primary-900/30 text-primary-300"
              : "border-neutral-700 text-neutral-500 hover:border-neutral-600",
          )}
        >
          <LayoutPreview value={p.value} />
          <span>{p.label}</span>
        </button>
      ))}
    </div>
  );
}

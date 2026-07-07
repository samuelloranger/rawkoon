import { useState } from "react";
import { ChevronDown, X } from "lucide-react";
import type { FilterOption } from "@/features/medias/hooks/useInteractiveSearchState";

export type { FilterOption };

export function Toggle({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className="inline-flex items-center gap-2 rounded-full px-1 py-1 transition-colors hover:bg-neutral-800"
      style={{ touchAction: "manipulation" }}
    >
      <span
        className={`relative inline-flex h-5 w-9 shrink-0 rounded-full border-2 border-transparent transition-colors duration-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 ${
          checked ? "bg-primary-600" : "bg-neutral-700"
        }`}
      >
        <span
          className={`pointer-events-none inline-block h-4 w-4 rounded-full bg-white shadow-sm ring-0 transition-transform duration-200 ${
            checked ? "translate-x-4" : "translate-x-0"
          }`}
        />
      </span>
      <span className="text-xs text-neutral-300">{label}</span>
    </button>
  );
}

export function ChipMultiSelect({
  options,
  selected,
  onChange,
  emptyText,
}: {
  options: FilterOption[];
  selected: string[];
  onChange: (values: string[]) => void;
  emptyText: string;
}) {
  const toggle = (key: string) => {
    onChange(
      selected.includes(key)
        ? selected.filter((k) => k !== key)
        : [...selected, key],
    );
  };

  if (options.length === 0) {
    return (
      <span className="text-[11px] italic text-neutral-500">{emptyText}</span>
    );
  }

  return (
    <div className="flex max-h-28 flex-wrap gap-1.5 overflow-y-auto pr-1 pb-2">
      {options.map((option) => {
        const active = selected.includes(option.key);
        return (
          <button
            key={option.key}
            type="button"
            onClick={() => toggle(option.key)}
            style={{ touchAction: "manipulation" }}
            className={`inline-flex appearance-none items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-medium transition-all duration-150 ${
              active
                ? "bg-primary-600 text-white shadow-sm"
                : "bg-neutral-800 text-neutral-400 hover:bg-neutral-700"
            }`}
          >
            {option.label}
            {active && <X size={9} strokeWidth={2.5} />}
          </button>
        );
      })}
    </div>
  );
}

export function FilterSection({
  title,
  children,
  badge,
}: {
  title: string;
  children: React.ReactNode;
  badge?: number;
}) {
  const [open, setOpen] = useState(true);

  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="group flex w-full items-center justify-between py-1"
        style={{ touchAction: "manipulation" }}
      >
        <span className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-neutral-400">
          {title}
          {badge != null && badge > 0 && (
            <span className="inline-flex h-4 w-4 items-center justify-center rounded-full bg-primary-600 text-[9px] font-bold text-white">
              {badge}
            </span>
          )}
        </span>
        <ChevronDown
          size={12}
          className={`text-neutral-400 transition-transform duration-200 ${open ? "rotate-180" : ""}`}
        />
      </button>
      {open && <div className="mt-1.5">{children}</div>}
    </div>
  );
}

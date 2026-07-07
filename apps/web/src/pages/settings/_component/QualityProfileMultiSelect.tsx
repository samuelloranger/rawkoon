import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Check, ChevronDown, X } from "lucide-react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";

// ─── MultiSelect (Popover + checkboxes) ──────────────────────────────────────

export function MultiSelect({
  label,
  placeholder,
  options,
  selected,
  onChange,
}: {
  label: string;
  placeholder: string;
  options: { value: string; label: string }[];
  selected: string[];
  onChange: (next: string[]) => void;
}) {
  const { t } = useTranslation("common");
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [popoverWidth, setPopoverWidth] = useState<number | undefined>();

  const toggle = (value: string) => {
    onChange(
      selected.includes(value)
        ? selected.filter((v) => v !== value)
        : [...selected, value],
    );
  };

  const remove = (e: React.MouseEvent, value: string) => {
    e.stopPropagation();
    onChange(selected.filter((v) => v !== value));
  };

  const handleOpenChange = (next: boolean) => {
    if (next && triggerRef.current) {
      setPopoverWidth(triggerRef.current.offsetWidth);
    }
    setOpen(next);
  };

  return (
    <div className="flex flex-col gap-1.5">
      <label className="text-sm font-medium text-neutral-300">{label}</label>
      <Popover open={open} onOpenChange={handleOpenChange}>
        <PopoverTrigger asChild>
          <button
            ref={triggerRef}
            type="button"
            className={cn(
              "flex min-h-10 w-full flex-wrap items-center gap-1.5 rounded-lg border bg-white px-3 py-2 text-left text-sm transition-colors",
              "border-neutral-200 hover:border-neutral-300 focus:outline-none focus:ring-2 focus:ring-primary-500/30",
              "border-neutral-700 bg-neutral-900 hover:border-neutral-600",
              open && "ring-2 ring-primary-500/30 border-primary-600",
            )}
          >
            {selected.length === 0 ? (
              <span className="flex-1 text-neutral-500">{placeholder}</span>
            ) : (
              <span className="flex flex-1 flex-wrap gap-1">
                {selected.map((v) => {
                  const opt = options.find((o) => o.value === v);
                  return (
                    <span
                      key={v}
                      className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-xs font-medium bg-primary-500/15 text-primary-300"
                    >
                      {opt?.label ?? v}
                      <button
                        type="button"
                        onClick={(e) => remove(e, v)}
                        className="rounded hover:text-primary-100"
                      >
                        <X size={10} strokeWidth={2.5} />
                      </button>
                    </span>
                  );
                })}
              </span>
            )}
            <ChevronDown
              size={14}
              className={cn(
                "ml-auto shrink-0 text-neutral-400 transition-transform duration-150",
                open && "rotate-180",
              )}
            />
          </button>
        </PopoverTrigger>
        <PopoverContent
          align="start"
          sideOffset={6}
          className="p-1"
          style={{ width: popoverWidth }}
        >
          {options.map((opt) => {
            const isSelected = selected.includes(opt.value);
            return (
              <button
                key={opt.value}
                type="button"
                onClick={() => toggle(opt.value)}
                className={cn(
                  "flex w-full items-center gap-2.5 rounded-md px-3 py-2 text-sm transition-colors",
                  isSelected
                    ? "bg-primary-500/15 text-primary-300"
                    : "text-neutral-300 hover:bg-neutral-700/50",
                )}
              >
                <span
                  className={cn(
                    "flex h-4 w-4 shrink-0 items-center justify-center rounded border transition-colors",
                    isSelected
                      ? "text-white border-primary-400 bg-primary-400"
                      : "border-neutral-600",
                  )}
                >
                  {isSelected && <Check size={10} strokeWidth={3} />}
                </span>
                {opt.label}
              </button>
            );
          })}
          {selected.length > 0 && (
            <>
              <div className="my-1 border-t border-neutral-700" />
              <button
                type="button"
                onClick={() => onChange([])}
                className="flex w-full items-center gap-2 rounded-md px-3 py-1.5 text-xs text-neutral-400 hover:bg-neutral-700/50 hover:text-neutral-300 transition-colors"
              >
                <X size={10} />
                {t("settings.qualityProfiles.deselectAll")}
              </button>
            </>
          )}
        </PopoverContent>
      </Popover>
    </div>
  );
}

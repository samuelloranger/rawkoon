import { useState } from "react";
import { ChevronDown, X } from "lucide-react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";

/**
 * Compact pill with icon + label, optional value, chevron, clear (X) when active.
 */
export function DiscoverFilterChip({
  icon: Icon,
  label,
  value,
  onClear,
  popoverContent,
}: {
  icon: React.ComponentType<{ className?: string; size?: number }>;
  label: string;
  value: React.ReactNode | null;
  onClear?: () => void;
  popoverContent: (close: () => void) => React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const active = value !== null && value !== undefined;
  return (
    <div
      className={[
        "flex min-w-0 w-full max-w-full items-center rounded-full border text-xs font-medium transition-colors",
        active
          ? "border-primary-500/50 bg-primary-500/10 text-primary-200"
          : "border-neutral-700 bg-neutral-900 text-neutral-300 hover:border-neutral-600",
      ].join(" ")}
    >
      <div className="min-w-0 flex-1">
        <Popover modal={false} open={open} onOpenChange={setOpen}>
          <PopoverTrigger asChild>
            <button
              type="button"
              className="flex min-w-0 w-full max-w-full items-center gap-1.5 rounded-full px-2.5 py-1.5 text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500/40"
            >
              <Icon
                className={cn(
                  "shrink-0",
                  active ? "text-primary-500" : "text-neutral-400",
                )}
                size={13}
              />
              <span
                className={cn(
                  "shrink-0 truncate",
                  active
                    ? "text-[11px] uppercase tracking-wide opacity-70"
                    : "",
                )}
              >
                {label}
              </span>
              {active && (
                <>
                  <span className="shrink-0 opacity-40">·</span>
                  <div className="min-w-0 flex-1 overflow-hidden font-semibold">
                    {value}
                  </div>
                </>
              )}
              <ChevronDown size={12} className="shrink-0 opacity-50" />
            </button>
          </PopoverTrigger>
          <PopoverContent
            align="start"
            sideOffset={6}
            className="w-80 p-0 overflow-hidden"
            onOpenAutoFocus={(e) => e.preventDefault()}
          >
            {popoverContent(() => setOpen(false))}
          </PopoverContent>
        </Popover>
      </div>

      {active && onClear && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onClear();
          }}
          aria-label="Clear filter"
          className="mr-1 flex h-5 w-5 items-center justify-center rounded-full text-neutral-400 hover:bg-neutral-800 hover:text-neutral-200"
        >
          <X size={12} />
        </button>
      )}
    </div>
  );
}

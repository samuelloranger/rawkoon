import { cn } from "@/lib/utils";

export function Segmented<T extends string | number>({
  value,
  onChange,
  options,
  ariaLabel,
}: {
  value: T;
  onChange: (v: T) => void;
  options: {
    value: T;
    label: string;
    hint?: string;
    disabled?: boolean;
    title?: string;
  }[];
  ariaLabel: string;
}) {
  return (
    <div
      role="radiogroup"
      aria-label={ariaLabel}
      className="inline-flex flex-wrap gap-0.5 rounded-lg border border-neutral-800 bg-neutral-950 p-[3px]"
    >
      {options.map((o) => {
        const on = o.value === value;
        return (
          <button
            key={String(o.value)}
            type="button"
            role="radio"
            aria-checked={on}
            aria-label={o.label}
            disabled={o.disabled}
            title={o.title}
            onClick={() => onChange(o.value)}
            className={cn(
              "rounded-md px-3 py-1.5 text-left text-[13px] font-medium transition-colors",
              on
                ? "bg-neutral-800 text-neutral-50 ring-1 ring-inset ring-neutral-700"
                : "text-neutral-400 hover:text-neutral-200",
              "disabled:cursor-not-allowed disabled:opacity-35",
            )}
          >
            {o.label}
            {o.hint && (
              <span
                className={cn(
                  "block text-[11px] font-normal",
                  on ? "text-primary-400" : "text-neutral-500",
                )}
              >
                {o.hint}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

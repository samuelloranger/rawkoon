import { AlertCircle, CheckCircle2, ChevronDown, Circle } from "lucide-react";
import { useState } from "react";
import { cn } from "@/lib/utils";

export function Row({
  label,
  value,
  mono,
}: {
  label: string;
  value: string | number | null | undefined;
  mono?: boolean;
}) {
  if (value == null || value === "") return null;
  return (
    <div className="flex gap-2 text-xs">
      <span className="w-[34%] shrink-0 text-neutral-400">{label}</span>
      <span
        className={cn(
          "min-w-0 flex-1 break-all text-neutral-200",
          mono && "font-mono text-[11px] leading-snug",
        )}
      >
        {String(value)}
      </span>
    </div>
  );
}

export function Badge({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded px-1.5 py-px text-[10px] font-medium tracking-tight",
        className,
      )}
    >
      {children}
    </span>
  );
}

export function SectionTitle({
  icon: Icon,
  label,
}: {
  icon: React.ElementType;
  label: string;
}) {
  return (
    <div className="flex items-center gap-1 text-[10px] font-semibold text-neutral-500 uppercase tracking-widest mt-3 mb-1.5">
      <Icon size={10} />
      {label}
    </div>
  );
}

export function Card({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "rounded-xl border border-neutral-800 bg-neutral-900/60 overflow-hidden",
        className,
      )}
    >
      {children}
    </div>
  );
}

export function StatusDot({ status }: { status: string }) {
  if (status === "downloaded") {
    return <CheckCircle2 size={11} className="text-emerald-500 shrink-0" />;
  }
  if (status === "downloading") {
    return (
      <Circle size={11} className="text-sky-400 shrink-0 fill-sky-400/20" />
    );
  }
  if (status === "skipped") {
    return <AlertCircle size={11} className="text-neutral-400 shrink-0" />;
  }
  // wanted
  return <Circle size={11} className="text-neutral-600 shrink-0" />;
}

export function Eyebrow({
  icon: Icon,
  className,
  children,
}: {
  icon?: React.ElementType;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <p
      className={cn(
        "flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-neutral-400",
        className,
      )}
    >
      {Icon ? <Icon size={11} className="shrink-0" /> : null}
      {children}
    </p>
  );
}

// NOTE: When `collapsible` is true, the `right` slot is rendered INSIDE the
// toggle <button>, so consumers must NOT pass interactive elements (e.g.
// buttons) there — nesting a button inside a button is invalid. Put any
// interactive controls in the body (children) instead.
export function ManagementSection({
  icon: Icon,
  title,
  count,
  right,
  collapsible = false,
  defaultOpen = true,
  children,
}: {
  icon?: React.ElementType;
  title: string;
  count?: number;
  right?: React.ReactNode;
  collapsible?: boolean;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const header = (
    <div className="flex items-center gap-2 min-w-0">
      {Icon ? <Icon size={13} className="shrink-0 text-neutral-400" /> : null}
      <span className="text-xs font-semibold text-neutral-200 truncate">
        {title}
      </span>
      {count != null && count > 0 ? (
        <span className="inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-neutral-700 px-1 text-[9px] font-bold text-neutral-300 tabular-nums">
          {count}
        </span>
      ) : null}
    </div>
  );
  return (
    <Card>
      {collapsible ? (
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          className="flex w-full items-center justify-between gap-2 px-4 py-3 text-left transition-colors hover:bg-neutral-800/40"
        >
          {header}
          <div className="flex items-center gap-2 shrink-0">
            {right}
            <ChevronDown
              size={13}
              className={cn(
                "text-neutral-400 transition-transform duration-200",
                open && "rotate-180",
              )}
            />
          </div>
        </button>
      ) : (
        <div className="flex items-center justify-between gap-2 px-4 py-3 border-b border-border">
          {header}
          {right ? <div className="shrink-0">{right}</div> : null}
        </div>
      )}
      {!collapsible || open ? (
        <div
          className={
            collapsible ? "border-t border-border px-4 pb-4 pt-3" : "px-4 py-3"
          }
        >
          {children}
        </div>
      ) : null}
    </Card>
  );
}

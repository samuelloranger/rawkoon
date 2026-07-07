import type { ComponentPropsWithoutRef, ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Shared Cozy Dusk dashboard-widget primitives.
 *
 * Centralizes the panel shell, header, and label typography that every
 * dashboard widget repeats. The accent bar is unified to `primary`
 * (apricot/terracotta) — semantic status colors stay inside each widget.
 */

export function WidgetShell({
  className,
  children,
  ...rest
}: ComponentPropsWithoutRef<"section">) {
  return (
    <section
      className={cn(
        "rounded-xl border border-neutral-800 bg-neutral-900 overflow-hidden",
        className,
      )}
      {...rest}
    >
      {children}
    </section>
  );
}

export function Kicker({ children }: { children: ReactNode }) {
  return (
    <span className="text-[10px] font-bold uppercase tracking-[0.15em] text-neutral-400">
      {children}
    </span>
  );
}

function SectionTitle({ children }: { children: ReactNode }) {
  return <h3 className="text-sm font-semibold text-neutral-100">{children}</h3>;
}

/**
 * Canonical widget header: primary accent bar + icon + title, with an
 * optional right-aligned slot (refresh button, count badge, status pill…).
 * Pass `icon` for a lucide component, or `iconNode` for a custom node (img).
 */
export function WidgetHeader({
  icon: Icon,
  iconNode,
  title,
  right,
}: {
  icon?: LucideIcon;
  iconNode?: ReactNode;
  title: ReactNode;
  right?: ReactNode;
}) {
  return (
    <div
      className={cn(
        "flex items-center gap-2.5 px-4 py-3 border-b border-neutral-800",
        right != null && "justify-between",
      )}
    >
      <div className="flex items-center gap-2.5 min-w-0">
        <span className="w-1 h-4 rounded-full bg-primary-500 shrink-0" />
        {Icon ? (
          <Icon
            className="w-4 h-4 shrink-0 text-neutral-400"
            strokeWidth={2}
            aria-hidden
          />
        ) : (
          iconNode
        )}
        {typeof title === "string" ? (
          <SectionTitle>{title}</SectionTitle>
        ) : (
          title
        )}
      </div>
      {right}
    </div>
  );
}

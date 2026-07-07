import type { ElementType, ReactElement, ReactNode } from "react";
import { isValidElement, useEffect, useRef } from "react";
import { cn } from "@/lib/utils";

export interface SegmentedTabItem<T extends string> {
  id: T;
  label: string;
  icon?: ElementType<{ size?: number; className?: string }> | ReactElement;
  badge?: ReactNode;
}

interface SegmentedTabsProps<T extends string> {
  items: SegmentedTabItem<T>[];
  value: T;
  onChange: (value: T) => void;
  /**
   * "underline" — navigation tabs with a bottom-border indicator (default).
   * "chips"     — filter toggle chips; no shared background track.
   */
  variant?: "underline" | "chips";
  containerClassName?: string;
  trackClassName?: string;
  itemClassName?: string;
  activeItemClassName?: string;
  inactiveItemClassName?: string;
  iconClassName?: string;
  activeIconClassName?: string;
  badgeClassName?: string;
  activeBadgeClassName?: string;
  inactiveBadgeClassName?: string;
  ariaLabel?: string;
  fullWidth?: boolean;
}

function TabIcon({
  icon: Icon,
  className,
}: {
  icon: ElementType<{ size?: number; className?: string }> | ReactElement;
  className?: string;
}) {
  if (isValidElement(Icon)) {
    return (
      <span
        className={cn("inline-flex shrink-0 text-current", className)}
        aria-hidden
      >
        {Icon}
      </span>
    );
  }
  const Component = Icon as ElementType<{
    size?: number;
    className?: string;
  }>;
  return (
    <Component
      size={13}
      className={cn("shrink-0 text-current", className)}
      aria-hidden
    />
  );
}

function TabBadge({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "shrink-0 px-1.5 py-px rounded-full text-[10px] font-bold tabular-nums leading-none",
        className,
      )}
    >
      {children}
    </span>
  );
}

export function SegmentedTabs<T extends string>({
  items,
  value,
  onChange,
  variant = "underline",
  containerClassName,
  trackClassName,
  itemClassName,
  activeItemClassName,
  inactiveItemClassName,
  iconClassName,
  activeIconClassName,
  badgeClassName,
  activeBadgeClassName,
  inactiveBadgeClassName,
  ariaLabel,
  fullWidth = false,
}: SegmentedTabsProps<T>) {
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const activeItemRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    const viewport = viewportRef.current;
    const active = activeItemRef.current;
    if (!viewport || !active) return;
    if (viewport.scrollWidth <= viewport.clientWidth) return;

    const viewportRect = viewport.getBoundingClientRect();
    const activeRect = active.getBoundingClientRect();
    const offsetLeft =
      activeRect.left - viewportRect.left + viewport.scrollLeft;
    const target = offsetLeft - (viewport.clientWidth - active.offsetWidth) / 2;

    viewport.scrollTo({ left: Math.max(0, target), behavior: "smooth" });
  }, [value]);

  if (variant === "chips") {
    return (
      <div
        ref={viewportRef}
        className={cn(
          "w-full overflow-x-auto [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden",
          containerClassName,
        )}
      >
        <div
          role="tablist"
          aria-label={ariaLabel}
          className={cn(
            "flex gap-1.5",
            fullWidth ? "w-full" : "min-w-max",
            trackClassName,
          )}
        >
          {items.map((item) => {
            const isActive = value === item.id;
            return (
              <button
                key={item.id}
                type="button"
                role="tab"
                aria-selected={isActive}
                onClick={() => onChange(item.id)}
                ref={isActive ? activeItemRef : undefined}
                className={cn(
                  "flex items-center gap-1.5 whitespace-nowrap rounded-full border px-3 py-1.5 text-sm font-medium transition-all duration-150",
                  fullWidth && "flex-1 justify-center",
                  isActive
                    ? "border-primary-500/30 bg-primary-500/15 text-primary-400"
                    : "bg-transparent border-neutral-700 text-neutral-400 hover:border-neutral-600 hover:text-neutral-200",
                  isActive && activeItemClassName,
                  !isActive && inactiveItemClassName,
                  itemClassName,
                )}
              >
                {item.icon && (
                  <TabIcon
                    icon={item.icon}
                    className={cn(
                      iconClassName,
                      isActive && activeIconClassName,
                    )}
                  />
                )}
                <span>{item.label}</span>
                {item.badge != null && (
                  <TabBadge
                    className={cn(
                      isActive
                        ? "bg-primary-500/20 text-primary-300"
                        : "bg-neutral-800 text-neutral-400",
                      badgeClassName,
                      isActive && activeBadgeClassName,
                      !isActive && inactiveBadgeClassName,
                    )}
                  >
                    {item.badge}
                  </TabBadge>
                )}
              </button>
            );
          })}
        </div>
      </div>
    );
  }

  // underline variant (default)
  return (
    <div
      ref={viewportRef}
      className={cn(
        "w-full overflow-x-auto border-b border-neutral-800 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden",
        containerClassName,
      )}
    >
      <div
        role="tablist"
        aria-label={ariaLabel}
        className={cn("flex min-w-max", trackClassName)}
      >
        {items.map((item) => {
          const isActive = value === item.id;
          return (
            <button
              key={item.id}
              type="button"
              role="tab"
              aria-selected={isActive}
              onClick={() => onChange(item.id)}
              ref={isActive ? activeItemRef : undefined}
              className={cn(
                "relative flex items-center gap-1.5 whitespace-nowrap px-4 py-2.5 text-sm font-medium transition-colors duration-150",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500/50 focus-visible:ring-offset-1 rounded-t-sm",
                isActive
                  ? "text-neutral-100"
                  : "text-neutral-400 hover:text-neutral-300",
                isActive && activeItemClassName,
                !isActive && inactiveItemClassName,
                itemClassName,
              )}
            >
              {item.icon && (
                <TabIcon
                  icon={item.icon}
                  className={cn(iconClassName, isActive && activeIconClassName)}
                />
              )}
              <span>{item.label}</span>
              {item.badge != null && (
                <TabBadge
                  className={cn(
                    isActive
                      ? "bg-primary-500/20 text-primary-300"
                      : "bg-neutral-700 text-neutral-400",
                    badgeClassName,
                    isActive && activeBadgeClassName,
                    !isActive && inactiveBadgeClassName,
                  )}
                >
                  {item.badge}
                </TabBadge>
              )}
              {isActive && (
                <span
                  aria-hidden
                  className="absolute bottom-0 inset-x-0 h-0.5 bg-primary-500 rounded-t-full"
                />
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

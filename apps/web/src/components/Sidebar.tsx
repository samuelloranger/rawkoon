import { Link, useRouterState } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { motion } from "motion/react";
import { Search } from "lucide-react";
import { AccountMenu } from "@/components/AccountMenu";
import { NavBadge } from "@/components/NavBadge";
import { usePrefetchRoute } from "@/lib/routing/usePrefetchRoute";
import { useTheme } from "@/lib/app/useTheme";
import { cn } from "@/lib/utils";
import {
  isNavRouteActive,
  navItems,
  resolveNavPath,
} from "@/lib/routing/navigation";
import { useActivityBadge } from "@/lib/notifications/useActivityBadge";
import type { NavPosition } from "@rawkoon/shared/types";

interface SidebarProps {
  onOpenQuickActions?: () => void;
  position: NavPosition;
}

export function Sidebar({ onOpenQuickActions, position }: SidebarProps) {
  const { t } = useTranslation("common");
  const currentPath = useRouterState({ select: (r) => r.location.pathname });
  const prefetchRoute = usePrefetchRoute();
  const activityBadge = useActivityBadge();

  useTheme();
  const isHorizontal = position === "top" || position === "bottom";

  return (
    <>
      {/* Desktop sidebar */}
      <aside
        className={cn(
          "hidden lg:flex fixed z-50 bg-neutral-900/80 backdrop-blur-xl theme-transition",
          {
            "left-0 top-0 bottom-0 w-60 flex-col border-r border-white/[0.08]":
              position === "left",
            "right-0 top-0 bottom-0 w-60 flex-col border-l border-white/[0.08]":
              position === "right",
            "top-0 left-0 right-0 h-12 flex-row items-center border-b border-white/[0.08]":
              position === "top",
            "bottom-0 left-0 right-0 h-12 flex-row items-center border-t border-white/[0.08]":
              position === "bottom",
          },
        )}
      >
        {/* Logo */}
        <div
          className={cn(
            "flex items-center gap-2.5 shrink-0",
            isHorizontal ? "px-3 h-full" : "px-5 h-16",
          )}
        >
          <Link
            to="/"
            className="flex items-center gap-2.5 group"
            onMouseEnter={() => prefetchRoute("/")}
          >
            <img
              decoding="async"
              src="/icon-32.png"
              alt=""
              className="h-7 w-7 transition-transform duration-200 group-hover:scale-110"
            />
            {!isHorizontal && (
              <span className="text-lg font-display font-semibold tracking-tight text-neutral-50">
                Rawkoon
              </span>
            )}
          </Link>
        </div>

        {/* Nav items */}
        <nav
          className={cn(
            isHorizontal
              ? "flex flex-row items-center gap-0.5 px-1 flex-1 overflow-x-auto h-full"
              : "flex-1 overflow-y-auto px-3 py-2 space-y-5",
          )}
        >
          <div
            className={cn(
              isHorizontal
                ? "flex flex-row items-center gap-0.5"
                : "mt-1.5 space-y-0.5",
            )}
          >
            {navItems.map((item) => {
              const isActive = isNavRouteActive(item.path, currentPath);
              const Icon = item.icon;
              return (
                <Link
                  key={item.path}
                  to={resolveNavPath(item.path)}
                  onMouseEnter={() => prefetchRoute(item.path)}
                  className={cn(
                    "relative flex items-center rounded-lg text-[13px] font-medium transition-colors duration-150",
                    isHorizontal
                      ? "gap-0 px-3 py-2 justify-center"
                      : "gap-3 px-3 py-2",
                    isActive
                      ? "text-white"
                      : "text-neutral-400 hover:bg-white/[0.04] hover:text-neutral-200",
                  )}
                  title={isHorizontal ? t(item.translationKey) : undefined}
                >
                  {isActive && (
                    <motion.span
                      layoutId="sidebar-active"
                      className="absolute inset-0 rounded-lg bg-white/[0.08]"
                      transition={{
                        type: "spring",
                        stiffness: 500,
                        damping: 40,
                      }}
                    />
                  )}
                  <Icon
                    size={18}
                    className={cn(
                      "relative z-10",
                      isActive && "text-primary-400",
                    )}
                  />
                  {!isHorizontal && (
                    <span className="relative z-10 flex-1">
                      {t(item.translationKey)}
                    </span>
                  )}
                  {item.path === "/activity" && (
                    <NavBadge
                      count={activityBadge}
                      className={cn(
                        "relative z-10",
                        isHorizontal && "absolute right-1 top-1",
                      )}
                    />
                  )}
                </Link>
              );
            })}
          </div>
        </nav>

        {/* Bottom section */}
        {isHorizontal ? (
          <div className="flex items-center gap-1 px-2 ml-auto h-full shrink-0">
            {onOpenQuickActions && (
              <button
                type="button"
                onClick={onOpenQuickActions}
                className="flex h-8 w-8 items-center justify-center rounded-lg text-neutral-400 hover:bg-white/[0.06] transition-colors"
                aria-label={t("common.quickActions")}
                title={t("common.quickActions")}
              >
                <Search size={16} />
              </button>
            )}
            <AccountMenu
              variant="compact"
              side={position === "top" ? "bottom" : "top"}
            />
          </div>
        ) : (
          <div className="shrink-0 border-t border-white/[0.08] px-3 py-3 space-y-1">
            {onOpenQuickActions && (
              <button
                type="button"
                onClick={onOpenQuickActions}
                className="flex w-full items-center gap-3 rounded-lg px-2.5 py-2 text-[13px] font-medium transition-all duration-150 text-neutral-400 hover:bg-white/[0.04] hover:text-neutral-200"
              >
                <Search size={18} />
                <span className="flex-1 text-left">
                  {t("common.quickActions")}
                </span>
                <span className="rounded-md border px-1.5 py-0.5 text-[10px] font-semibold text-neutral-400 border-white/[0.08]">
                  ⌘K
                </span>
              </button>
            )}
            <AccountMenu
              variant="sidebar"
              side={position === "right" ? "left" : "right"}
            />
          </div>
        )}
      </aside>

      {/* Mobile top bar */}
      <div className="lg:hidden">
        <div style={{ height: "calc(56px + env(safe-area-inset-top, 0px))" }} />
        <nav className="fixed heading-safe-area top-0 left-0 right-0 z-50 bg-neutral-900/80 backdrop-blur-xl border-b border-white/[0.08] theme-transition">
          <div className="px-4 sm:px-6">
            <div className="flex items-center justify-between h-14">
              <Link
                to="/"
                className="flex items-center gap-2.5 group"
                onMouseEnter={() => prefetchRoute("/")}
              >
                <img
                  decoding="async"
                  src="/icon-32.png"
                  alt=""
                  className="h-7 w-7 transition-transform duration-200 group-hover:scale-110"
                />
                <span className="text-lg font-display font-semibold tracking-tight text-neutral-50">
                  Rawkoon
                </span>
              </Link>
            </div>
          </div>
        </nav>
      </div>
    </>
  );
}

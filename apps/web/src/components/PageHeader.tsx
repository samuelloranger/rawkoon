import { RefreshCw } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import type { ReactNode } from "react";

interface PageHeaderProps {
  icon?: LucideIcon;
  iconColor?: string;
  title: string;
  subtitle?: string;
  onRefresh?: () => void;
  isRefreshing?: boolean;
  className?: string;
  actions?: ReactNode;
}

export function PageHeader({
  title,
  subtitle,
  onRefresh,
  isRefreshing = false,
  className = "",
  actions,
}: PageHeaderProps) {
  const { t } = useTranslation("common");
  return (
    <div className={cn("mb-6", className)}>
      {/* Mobile layout: compact stacked */}
      <div className="flex flex-col gap-3 sm:hidden">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <h1 className="font-display text-xl font-semibold tracking-tight text-neutral-50 truncate">
              {title}
            </h1>
            {subtitle && (
              <p className="mt-0.5 text-xs text-neutral-400 truncate">
                {subtitle}
              </p>
            )}
          </div>
          {onRefresh && (
            <button
              onClick={onRefresh}
              disabled={isRefreshing}
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-neutral-400 hover:bg-neutral-800 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              title={t("common.refetch")}
            >
              <RefreshCw
                className={cn("h-3.5 w-3.5", isRefreshing && "animate-spin")}
              />
            </button>
          )}
        </div>
        {actions && <div className="flex items-center gap-2">{actions}</div>}
      </div>

      {/* Desktop layout: title | actions */}
      <div className="hidden sm:flex items-end justify-between gap-4">
        <div className="flex flex-col gap-1">
          <h1 className="font-display text-3xl font-semibold leading-none tracking-tight text-neutral-50">
            {title}
          </h1>
          {subtitle && <p className="text-sm text-neutral-400">{subtitle}</p>}
        </div>
        <div className="flex items-center gap-2">
          {actions}
          {onRefresh && (
            <button
              onClick={onRefresh}
              disabled={isRefreshing}
              className="flex h-9 w-9 items-center justify-center rounded-xl text-neutral-400 hover:bg-neutral-800 hover:text-neutral-200 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              title={t("common.refetch")}
            >
              <RefreshCw
                className={cn("h-4 w-4", isRefreshing && "animate-spin")}
              />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

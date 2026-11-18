import { useMemo, useState } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { Search } from "lucide-react";
import { useTranslation } from "react-i18next";
import {
  SETTINGS_GROUPS,
  matchesSettingsQuery,
  visibleSettingsPages,
} from "@/pages/settings/_lib/settingsPages";
import { cn } from "@/lib/utils";

/** The settings pages grouped by You, Server and System, optionally filtered by a search. */
export function SettingsIndex({
  isAdmin,
  currentPath,
  searchable = false,
  autoFocusSearch = false,
  onNavigate,
  healthAttention = false,
}: {
  isAdmin: boolean;
  currentPath: string;
  searchable?: boolean;
  autoFocusSearch?: boolean;
  onNavigate?: () => void;
  /** Marks the Health entry when readiness checks are failing. */
  healthAttention?: boolean;
}) {
  const { t } = useTranslation("common");
  const navigate = useNavigate();
  const [query, setQuery] = useState("");

  const groups = useMemo(() => {
    const pages = visibleSettingsPages(isAdmin).filter((p) =>
      matchesSettingsQuery(
        p,
        t(p.titleKey),
        query,
        t(`settings.pages.${p.id}.keywords`, { defaultValue: "" }),
      ),
    );
    return SETTINGS_GROUPS.map((g) => ({
      ...g,
      pages: pages.filter((p) => p.group === g.id),
    })).filter((g) => g.pages.length > 0);
  }, [isAdmin, query, t]);

  return (
    <div className="space-y-4">
      {searchable && (
        <div className="relative">
          <Search
            size={15}
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-neutral-400"
          />
          <input
            type="search"
            value={query}
            autoFocus={autoFocusSearch}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              const first = groups[0]?.pages[0];
              if (e.key === "Enter" && first && !e.nativeEvent.isComposing) {
                e.preventDefault();
                void navigate({ to: first.path });
                onNavigate?.();
              }
            }}
            aria-label={t("settings.search.label")}
            placeholder={t("settings.search.placeholder")}
            className="focus-ring h-10 w-full rounded-lg border border-neutral-700 bg-neutral-950 pl-9 pr-3 text-sm text-neutral-100 placeholder:text-neutral-400"
          />
        </div>
      )}
      {groups.length === 0 && (
        <p className="px-1 text-sm text-neutral-400">
          {t("settings.search.empty")}
        </p>
      )}
      {groups.map((group) => (
        <div key={group.id}>
          <p className="mb-1.5 px-3 text-[10px] font-semibold uppercase tracking-widest text-neutral-500">
            {t(group.labelKey)}
          </p>
          <ul className="space-y-0.5">
            {group.pages.map((p) => {
              const active =
                currentPath === p.path || currentPath.startsWith(`${p.path}/`);
              return (
                <li key={p.id}>
                  <Link
                    to={p.path}
                    onClick={onNavigate}
                    aria-current={active ? "page" : undefined}
                    className={cn(
                      "focus-ring flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors",
                      active
                        ? "bg-primary-500/10 text-primary-400"
                        : "text-neutral-400 hover:bg-neutral-800 hover:text-neutral-200",
                    )}
                  >
                    <p.icon className="h-4 w-4 shrink-0" />
                    {t(p.titleKey)}
                    {p.id === "health" && healthAttention && (
                      <span
                        role="img"
                        aria-label={t("settings.healthAttention")}
                        data-testid="health-attention-dot"
                        className="ml-auto h-2 w-2 rounded-full bg-red-500"
                      />
                    )}
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </div>
  );
}

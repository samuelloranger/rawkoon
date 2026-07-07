import {
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import { useNavigate, useRouterState } from "@tanstack/react-router";
import type { ReactNode } from "react";
import {
  Search,
  Sparkles,
  Bell,
  Settings,
  RefreshCw,
  Clapperboard,
  Tv,
  User,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { useQuickSearch } from "@/lib/search/useSearch";
import { navSections } from "@/lib/routing/navigation";
import { usePrefetchAllRoutes } from "@/lib/routing/usePrefetchAllRoutes";
import { Dialog } from "@/components/dialog";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

interface QuickActionPaletteProps {
  isOpen: boolean;
  onClose: () => void;
  onOpen: () => void;
}

interface QuickAction {
  id: string;
  title: string;
  description: string;
  icon: ReactNode;
  section: "actions" | "medias" | "users";
  keywords?: string[];
  shortcut?: string;
  action: () => void;
}

export function QuickActionPalette({
  isOpen,
  onClose,
  onOpen,
}: QuickActionPaletteProps) {
  const { t } = useTranslation("common");
  const navigate = useNavigate();
  const router = useRouterState();
  const prefetchAllRoutes = usePrefetchAllRoutes();
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);

  const handleClose = useCallback(() => {
    setQuery("");
    setActiveIndex(0);
    onClose();
  }, [onClose]);
  const inputRef = useRef<HTMLInputElement>(null);
  const deferredQuery = useDeferredValue(query);
  const normalizedQuery = deferredQuery.trim().toLowerCase();
  const isLoggedIn = router.location.pathname !== "/login";
  const shouldSearch = isOpen && normalizedQuery.length >= 2 && isLoggedIn;

  const actions = useMemo<QuickAction[]>(() => {
    const navActions = navSections.flatMap((section) =>
      section.items.map((item) => ({
        id: `nav-${item.path}`,
        title: t(item.translationKey),
        description: t("common.quickActionsOpenPage", {
          page: t(item.translationKey),
        }),
        icon: <item.icon size={20} />,
        section: "actions" as const,
        keywords: [item.path, item.translationKey, section.labelKey].filter(
          (k): k is string => Boolean(k),
        ),
        action: () => {
          navigate({ to: item.path });
          handleClose();
        },
      })),
    );

    return [
      ...navActions,
      {
        id: "notifications",
        title: t("notifications.title"),
        description: t("common.quickActionsOpenPage", {
          page: t("notifications.title"),
        }),
        icon: <Bell size={20} />,
        section: "actions",
        keywords: ["notifications", "alerts"],
        action: () => {
          navigate({ to: "/notifications" });
          handleClose();
        },
      },
      {
        id: "settings",
        title: t("settings.title"),
        description: t("common.quickActionsOpenPage", {
          page: t("settings.title"),
        }),
        icon: <Settings size={20} />,
        section: "actions",
        keywords: ["settings", "profile", "integrations"],
        action: () => {
          navigate({ to: "/settings", search: { tab: "profile" as const } });
          handleClose();
        },
      },
      {
        id: "refresh",
        title: t("common.refetch"),
        description: t("common.quickActionsRefreshCurrentPage"),
        icon: <RefreshCw size={20} />,
        section: "actions",
        shortcut: "R",
        keywords: ["refresh", "reload"],
        action: () => {
          window.location.reload();
        },
      },
    ];
  }, [handleClose, navigate, t]);

  const filteredActions = useMemo<QuickAction[]>(() => {
    if (!normalizedQuery) {
      return actions;
    }

    return actions.filter((action) => {
      const searchable = [
        action.title,
        action.description,
        ...(action.keywords ?? []),
      ]
        .join(" ")
        .toLowerCase();
      return searchable.includes(normalizedQuery);
    });
  }, [actions, normalizedQuery]);

  const searchQuery = useQuickSearch(normalizedQuery, {
    enabled: shouldSearch,
    staleTime: 30_000,
  });

  const collectionResults = useMemo<QuickAction[]>(() => {
    if (!shouldSearch || !searchQuery.data) return [];

    const { medias = [], users = [] } = searchQuery.data;

    const libraryStatusLabel = (status: string) =>
      t(`medias.library.itemStatus.${status}`, { defaultValue: status });

    const mediaActions: QuickAction[] = medias.map((item) => ({
      id: `media-${item.id}`,
      title: item.title,
      description: [
        item.type === "movie"
          ? t("medias.filterMovies")
          : t("medias.filterSeries"),
        item.year ?? "",
        libraryStatusLabel(item.status),
      ]
        .filter(Boolean)
        .join(" • "),
      icon:
        item.type === "movie" ? <Clapperboard size={20} /> : <Tv size={20} />,
      section: "medias" as const,
      action: () => {
        navigate({
          to: "/library/$libraryId",
          params: { libraryId: String(item.id) },
        });
        handleClose();
      },
    }));

    const userActions: QuickAction[] = users.map((user) => ({
      id: `user-${user.id}`,
      title: user.name,
      description: user.email,
      icon: <User size={20} />,
      section: "users" as const,
      action: () => {
        navigate({ to: "/settings", search: { tab: "profile" as const } });
        handleClose();
      },
    }));

    return [...mediaActions, ...userActions];
  }, [handleClose, navigate, searchQuery.data, shouldSearch, t]);

  const sectionLabels: Record<QuickAction["section"], string> = useMemo(
    () => ({
      medias: t("common.quickActionsSectionMedias"),
      users: t("common.quickActionsSectionUsers"),
      actions: t("common.quickActionsSectionActions"),
    }),
    [t],
  );

  const matchScore = (title: string, q: string): number => {
    const lower = title.toLowerCase();
    if (lower === q) return 3;
    if (lower.startsWith(q)) return 2;
    if (lower.includes(q)) return 1;
    return 0;
  };

  const results = useMemo<QuickAction[]>(() => {
    if (!normalizedQuery) {
      return filteredActions;
    }

    return [...collectionResults, ...filteredActions].sort(
      (a, b) =>
        matchScore(b.title, normalizedQuery) -
        matchScore(a.title, normalizedQuery),
    );
  }, [filteredActions, normalizedQuery, collectionResults]);

  const isSearchingCollections = shouldSearch && searchQuery.isLoading;

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const isCommandPaletteShortcut =
        (event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k";
      if (isCommandPaletteShortcut) {
        event.preventDefault();
        if (isOpen) {
          handleClose();
        } else {
          onOpen();
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [handleClose, isOpen, onOpen]);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    prefetchAllRoutes();

    const timer = window.setTimeout(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    }, 50);

    return () => window.clearTimeout(timer);
  }, [isOpen, prefetchAllRoutes]);

  const safeActiveIndex =
    results.length > 0 ? Math.min(activeIndex, results.length - 1) : 0;

  const handleKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>) => {
    if (!results.length) {
      return;
    }

    const len = results.length;
    const idx = Math.min(activeIndex, len - 1);

    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveIndex((idx + 1) % len);
    }

    if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex((idx - 1 + len) % len);
    }

    if (event.key === "Enter") {
      event.preventDefault();
      results[safeActiveIndex]?.action();
    }
  };

  return (
    <Dialog
      isOpen={isOpen}
      onClose={handleClose}
      title={t("common.quickActions")}
      panelClassName="max-w-3xl overflow-hidden p-0"
    >
      <div className="border-b px-5 py-4 border-neutral-700">
        <div className="flex items-center gap-3 rounded-2xl border px-3 border-neutral-700 bg-neutral-900">
          <Search className="h-4 w-4 text-neutral-400" />
          <Input
            ref={inputRef}
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setActiveIndex(0);
            }}
            onKeyDown={handleKeyDown}
            placeholder={t("common.quickActionsPlaceholder")}
            className="border-0 bg-transparent! px-0 focus:ring-0"
          />
          <span className="hidden items-center rounded-lg border px-2 py-1 text-[11px] font-semibold text-neutral-400 border-neutral-700 sm:inline-flex">
            ⌘K
          </span>
        </div>
        <div className="mt-3 flex items-center justify-between gap-3 text-xs text-neutral-400">
          <p>
            {normalizedQuery.length >= 2
              ? t("common.quickActionsSearchCollections")
              : t("common.quickActionsHint")}
          </p>
          <p>{router.location.pathname}</p>
        </div>
      </div>

      <div className="max-h-[60dvh] overflow-y-auto p-3">
        {isSearchingCollections && (
          <div className="px-3 pb-3 text-xs text-neutral-400">
            {t("common.quickActionsLoadingResults")}
          </div>
        )}

        {results.length > 0 ? (
          <div className="space-y-1">
            {results.map((action, index) => (
              <button
                key={action.id}
                type="button"
                onClick={action.action}
                onMouseEnter={() => setActiveIndex(index)}
                className={cn(
                  "flex w-full items-center gap-3 rounded-2xl px-4 py-3 text-left transition-colors",
                  safeActiveIndex === index
                    ? "bg-neutral-700/70"
                    : "hover:bg-neutral-700/40",
                )}
              >
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-neutral-800 text-neutral-400">
                  {action.icon}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="font-medium text-white">{action.title}</p>
                  <p className="truncate text-sm text-neutral-400">
                    {action.description}
                  </p>
                </div>
                {action.shortcut ? (
                  <span className="shrink-0 rounded-lg border px-2 py-1 text-[11px] font-semibold text-neutral-400 border-neutral-700">
                    {action.shortcut}
                  </span>
                ) : normalizedQuery ? (
                  <span className="shrink-0 rounded-md px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide bg-neutral-800 text-neutral-500">
                    {sectionLabels[action.section]}
                  </span>
                ) : null}
              </button>
            ))}
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed px-6 py-14 text-center border-neutral-700">
            <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-neutral-800">
              <Sparkles className="h-5 w-5 text-neutral-500" />
            </div>
            <p className="font-medium text-white">
              {t("common.quickActionsNoResults")}
            </p>
            <p className="mt-1 text-sm text-neutral-400">
              {t("common.quickActionsNoResultsDescription")}
            </p>
          </div>
        )}
      </div>
    </Dialog>
  );
}

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
import {
  Search,
  Sparkles,
  Compass,
  Settings,
  RefreshCw,
  Clapperboard,
  Tv,
  BookOpen,
  User,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { useQuickSearch } from "@/lib/search/useSearch";
import { navItems, resolveNavPath } from "@/lib/routing/navigation";
import { usePrefetchAllRoutes } from "@/lib/routing/usePrefetchAllRoutes";
import { Dialog } from "@/components/dialog";
import { displayEmail } from "@/lib/jellyfinEmail";
import { Input } from "@/components/ui/input";
import {
  QuickActionRow,
  type QuickAction,
} from "@/components/quick-actions/QuickActionRow";

interface QuickActionPaletteProps {
  isOpen: boolean;
  onClose: () => void;
  onOpen: () => void;
}

const matchScore = (title: string, q: string): number => {
  const lower = title.toLowerCase();
  if (lower === q) return 3;
  if (lower.startsWith(q)) return 2;
  if (lower.includes(q)) return 1;
  return 0;
};

const LISTBOX_ID = "quick-actions-listbox";

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
  const trimmedQuery = query.trim();
  const isLoggedIn = router.location.pathname !== "/login";
  const shouldSearch = isOpen && normalizedQuery.length >= 2 && isLoggedIn;

  const findAction = useMemo<QuickAction[]>(
    () =>
      trimmedQuery
        ? [
            {
              id: "find-search",
              title: t("common.quickActionsSearchFind", {
                query: trimmedQuery,
              }),
              description: t("common.quickActionsSearchFindDescription"),
              icon: <Compass size={20} />,
              section: "find" as const,
              action: () => {
                navigate({ to: "/find", search: { q: trimmedQuery } });
                handleClose();
              },
            },
          ]
        : [],
    [handleClose, navigate, t, trimmedQuery],
  );

  const actions = useMemo<QuickAction[]>(() => {
    const navActions = navItems.map((item) => ({
      id: `nav-${item.path}`,
      title: t(item.translationKey),
      description: t("common.quickActionsOpenPage", {
        page: t(item.translationKey),
      }),
      icon: <item.icon size={20} />,
      section: "actions" as const,
      keywords: [item.path, item.translationKey],
      action: () => {
        navigate({ to: resolveNavPath(item.path) });
        handleClose();
      },
    }));

    return [
      ...navActions,
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
          navigate({ to: "/settings/profile" });
          handleClose();
        },
      },
      {
        id: "refresh",
        title: t("common.refetch"),
        description: t("common.quickActionsRefreshCurrentPage"),
        icon: <RefreshCw size={20} />,
        section: "actions",
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

    const { medias = [], books = [], users = [] } = searchQuery.data;

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

    const bookActions: QuickAction[] = books.map((item) => ({
      id: `book-${item.id}`,
      title: item.title,
      description: [item.authors.join(", "), item.year ?? ""]
        .filter(Boolean)
        .join(" • "),
      icon: <BookOpen size={20} />,
      section: "books" as const,
      action: () => {
        navigate({
          to: "/books/$bookId",
          params: { bookId: String(item.id) },
        });
        handleClose();
      },
    }));

    const userActions: QuickAction[] = users.map((user) => ({
      id: `user-${user.id}`,
      title: user.name,
      description: displayEmail(user.email),
      icon: <User size={20} />,
      section: "users" as const,
      action: () => {
        navigate({ to: "/settings/people" });
        handleClose();
      },
    }));

    return [...mediaActions, ...bookActions, ...userActions];
  }, [handleClose, navigate, searchQuery.data, shouldSearch, t]);

  const sectionLabels: Record<QuickAction["section"], string> = useMemo(
    () => ({
      find: t("common.quickActionsSectionFind"),
      medias: t("common.quickActionsSectionMedias"),
      books: t("common.quickActionsSectionBooks"),
      users: t("common.quickActionsSectionUsers"),
      actions: t("common.quickActionsSectionActions"),
    }),
    [t],
  );

  const results = useMemo<QuickAction[]>(() => {
    if (!normalizedQuery) {
      return filteredActions;
    }

    const rest = [...collectionResults, ...filteredActions].sort(
      (a, b) =>
        matchScore(b.title, normalizedQuery) -
        matchScore(a.title, normalizedQuery),
    );

    return [...findAction, ...rest];
  }, [filteredActions, normalizedQuery, collectionResults, findAction]);

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

    if (event.key === "Home") {
      event.preventDefault();
      setActiveIndex(0);
    }

    if (event.key === "End") {
      event.preventDefault();
      setActiveIndex(len - 1);
    }

    if (event.key === "Enter") {
      event.preventDefault();
      // Enter confirms an IME composition rather than running a row.
      if (event.nativeEvent.isComposing) return;
      const active = results[safeActiveIndex];
      active?.action();
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
            autoFocus
            role="combobox"
            aria-autocomplete="list"
            aria-expanded={results.length > 0}
            aria-controls={LISTBOX_ID}
            aria-activedescendant={
              results.length > 0
                ? `${LISTBOX_ID}-${safeActiveIndex}`
                : undefined
            }
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
          <p>{t("common.quickActionsHint")}</p>
          <p className="hidden sm:block">{router.location.pathname}</p>
        </div>
      </div>

      <div className="max-h-[60dvh] overflow-y-auto p-3">
        {isSearchingCollections && results.length === 0 && (
          <div className="px-3 pb-3 text-xs text-neutral-400">
            {t("common.quickActionsSearching")}
          </div>
        )}

        {results.length > 0 ? (
          <div
            id={LISTBOX_ID}
            role="listbox"
            aria-label={t("common.quickActions")}
            className="space-y-1"
          >
            {results.map((action, index) => (
              <QuickActionRow
                key={action.id}
                id={`${LISTBOX_ID}-${index}`}
                action={action}
                isActive={safeActiveIndex === index}
                sectionLabel={
                  normalizedQuery ? sectionLabels[action.section] : null
                }
                onHover={() => setActiveIndex(index)}
              />
            ))}
          </div>
        ) : isSearchingCollections ? null : (
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

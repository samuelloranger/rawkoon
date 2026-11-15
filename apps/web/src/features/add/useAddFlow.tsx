import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import type {
  AddToLibraryRequest,
  AddToLibraryResponse,
  BookDiscoveryBook,
  BookEditionKind,
  CreateMediaRequestBody,
  TmdbMediaSearchItem,
} from "@rawkoon/shared/types";
import { useFetcher } from "@/lib/api/context";
import { HttpError } from "@/lib/api/httpClient";
import { featuresQuery } from "@/lib/routing/useFeatures";
import { useAddToLibrary } from "@/features/medias/hooks/useAddToLibrary";
import { useLiveSearchToast } from "@/features/medias/hooks/useLiveSearchToast";
import { mediaPostProcessingSettingsQuery } from "@/features/medias/hooks/useMediaPostProcessingSettings";
import { qualityProfilesListQuery } from "@/pages/settings/useQualityProfiles";
import { useCreateRequest } from "@/pages/activity/requests/_hooks/useRequests";
import { useAddBook } from "@/pages/books/_hooks/useBooks";
import { useAddDiscoveryBook } from "@/pages/books/_hooks/useBookDiscovery";
import { BookAddDialog } from "./BookAddDialog";
import { AddTitleDialog } from "./AddTitleDialog";
import { RequestSeasonsSheet } from "./RequestSeasonsSheet";

export type AddableTitle = Pick<
  TmdbMediaSearchItem,
  "tmdb_id" | "media_type" | "title" | "can_add"
> & { poster_url?: string | null; release_year?: number | null };

interface AddOptions {
  /** Start with "search now" off (the Add only paths). */
  searchOnAdd?: false;
  silent?: boolean;
  /** Swipe deck and home hero: a small tray with the defaults prefilled. */
  compact?: boolean;
}

export interface RequestMedia {
  tmdb_id: number;
  type: "movie" | "show";
  title: string;
  poster_url: string | null;
  year: number | null;
}

export type BookSource =
  | { kind: "search"; google_volume_id: string; isbn13: string | null }
  | { kind: "discovery"; book: BookDiscoveryBook };

export interface BookDisplay {
  title: string;
  author: string | null;
  coverUrl: string | null;
  year: number | null;
}

/** Body fields the dialog hands to the add route. */
export type AddBody = Omit<AddToLibraryRequest, "tmdb_id" | "type">;

export interface BookChoice {
  kinds: BookEditionKind[];
  profileId: number | null;
}

type Active =
  | { kind: "title"; item: AddableTitle; opts: AddOptions }
  | { kind: "request"; media: RequestMedia }
  | { kind: "book"; source: BookSource; display: BookDisplay };

interface AddFlow {
  /** Resolves with the added item, or null when cancelled or failed. */
  add: (
    item: AddableTitle,
    opts?: AddOptions,
  ) => Promise<AddToLibraryResponse | null>;
  /** Resolves true once the request exists. */
  request: (media: RequestMedia) => Promise<boolean>;
  addBook: (source: BookSource, display: BookDisplay) => Promise<boolean>;
  isAdding: boolean;
}

const AddFlowContext = createContext<AddFlow | null>(null);

export function useAddFlow(): AddFlow {
  const flow = useContext(AddFlowContext);
  if (!flow) throw new Error("useAddFlow needs an AddFlowProvider");
  return flow;
}

const isConflict = (e: unknown) => e instanceof HttpError && e.status === 409;

/** Owns every add and request surface: decides between the dialog and an instant add, and runs the mutation. */
export function AddFlowProvider({ children }: { children: ReactNode }) {
  const { t } = useTranslation("common");
  const queryClient = useQueryClient();
  const fetcher = useFetcher();
  const addMut = useAddToLibrary();
  const liveSearchToast = useLiveSearchToast();
  const createRequest = useCreateRequest();
  const addBookMut = useAddBook();
  const addDiscoveryMut = useAddDiscoveryBook();

  const [active, setActive] = useState<Active | null>(null);
  const settle = useRef<((value: never) => void) | null>(null);

  const open = useCallback(<T,>(next: Active, empty: T) => {
    // A newer prompt replaces an unanswered one.
    settle.current?.(undefined as never);
    return new Promise<T>((resolve) => {
      settle.current = ((value?: T) => resolve(value ?? empty)) as never;
      setActive(next);
    });
  }, []);

  const finish = useCallback((value?: unknown) => {
    const fn = settle.current;
    settle.current = null;
    setActive(null);
    fn?.(value as never);
  }, []);

  // A second click on the same title joins the first instead of racing it.
  const inflight = useRef(new Map<string, Promise<unknown>>());
  const dedupe = useCallback(<T,>(key: string, run: () => Promise<T>) => {
    const existing = inflight.current.get(key);
    if (existing) return existing as Promise<T>;
    const p = run().finally(() => inflight.current.delete(key));
    inflight.current.set(key, p);
    return p;
  }, []);

  const flags = useCallback(
    () => queryClient.fetchQuery(featuresQuery).catch(() => null),
    [queryClient],
  );

  const runAdd = useCallback(
    async (item: AddableTitle, body: AddBody, silent?: boolean) => {
      try {
        const response = await addMut.mutateAsync({
          tmdb_id: item.tmdb_id,
          type: item.media_type === "tv" ? "show" : "movie",
          ...body,
        });
        if (!silent) liveSearchToast.announceAdd(response, item.title);
        return response;
      } catch {
        toast.error(t("medias.addFailed"));
        return null;
      }
    },
    [addMut, liveSearchToast, t],
  );

  const add = useCallback<AddFlow["add"]>(
    (item, opts) =>
      dedupe(`add:${item.media_type}:${item.tmdb_id}`, async () => {
        if (addMut.isPending || !item.can_add) return null;
        const instant = () =>
          runAdd(
            item,
            opts?.searchOnAdd === false ? { search_on_add: false } : {},
            opts?.silent,
          );
        const f = await flags();
        if (!f?.ask_before_adding) return instant();
        const profiles = await queryClient
          .fetchQuery({
            ...qualityProfilesListQuery(fetcher),
            staleTime: 30_000,
          })
          .catch(() => null);
        // One movie profile leaves nothing to choose.
        if (
          !profiles ||
          (item.media_type === "movie" && profiles.profiles.length < 2)
        )
          return instant();
        await queryClient
          .fetchQuery({
            ...mediaPostProcessingSettingsQuery(fetcher),
            staleTime: 30_000,
          })
          .catch(() => null);
        return open<AddToLibraryResponse | null>(
          { kind: "title", item, opts: opts ?? {} },
          null,
        );
      }),
    [addMut.isPending, dedupe, flags, queryClient, fetcher, runAdd, open],
  );

  const sendRequest = useCallback(
    async (body: CreateMediaRequestBody) => {
      try {
        await createRequest.mutateAsync(body);
        return true;
      } catch (e) {
        // A pending request already exists, which is what the caller wanted.
        if (isConflict(e)) return true;
        toast.error(
          t("requests.requestFailed", {
            title: "title" in body ? body.title : "",
          }),
        );
        return false;
      }
    },
    [createRequest, t],
  );

  const request = useCallback<AddFlow["request"]>(
    (media) =>
      dedupe(`req:${media.type}:${media.tmdb_id}`, async () => {
        const f = await flags();
        if (media.type === "show" && f?.requesters_choose_seasons)
          return open<boolean>({ kind: "request", media }, false);
        return sendRequest(media);
      }),
    [dedupe, flags, open, sendRequest],
  );

  const runAddBook = useCallback(
    async (source: BookSource, choice: BookChoice) => {
      const profile =
        choice.profileId != null
          ? { book_quality_profile_id: choice.profileId }
          : {};
      try {
        if (source.kind === "search") {
          await addBookMut.mutateAsync({
            google_volume_id: source.google_volume_id,
            isbn13: source.isbn13,
            kinds: choice.kinds,
            ...profile,
          });
        } else {
          await addDiscoveryMut.mutateAsync({
            book: source.book,
            kinds: choice.kinds,
            ...profile,
          });
        }
        return true;
      } catch {
        toast.error(t("addDialog.bookAddFailed"));
        return false;
      }
    },
    [addBookMut, addDiscoveryMut, t],
  );

  const addBook = useCallback<AddFlow["addBook"]>(
    (source, display) =>
      dedupe(
        `book:${source.kind === "search" ? source.google_volume_id : source.book.isbn13}`,
        async () => {
          const f = await flags();
          if (!f?.ask_before_adding)
            return runAddBook(source, { kinds: ["ebook"], profileId: null });
          return open<boolean>({ kind: "book", source, display }, false);
        },
      ),
    [dedupe, flags, open, runAddBook],
  );

  const value = useMemo(
    () => ({ add, request, addBook, isAdding: addMut.isPending }),
    [add, request, addBook, addMut.isPending],
  );

  return (
    <AddFlowContext.Provider value={value}>
      {children}
      {active?.kind === "title" && (
        <AddTitleDialog
          item={active.item}
          compact={active.opts.compact ?? false}
          searchNow={active.opts.searchOnAdd !== false}
          onSubmit={(body) => runAdd(active.item, body, active.opts.silent)}
          onClose={finish}
        />
      )}
      {active?.kind === "request" && (
        <RequestSeasonsSheet
          media={active.media}
          onSubmit={(season) =>
            sendRequest({ ...active.media, ...(season ?? {}) })
          }
          onClose={finish}
        />
      )}
      {active?.kind === "book" && (
        <BookAddDialog
          display={active.display}
          onSubmit={(choice) => runAddBook(active.source, choice)}
          onClose={finish}
        />
      )}
    </AddFlowContext.Provider>
  );
}

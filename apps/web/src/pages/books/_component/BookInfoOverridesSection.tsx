import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Loader2, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useUpdateBookOverrides } from "@/pages/books/_hooks/useUpdateBookOverrides";
import { ApiError } from "@/lib/api/client";
import type { Book, BookOverridesRequest } from "@rawkoon/shared/types";

/**
 * Manual metadata editing.
 *
 * Mirrors LibraryInfoOverridesSection for movies and shows, with one
 * difference that matters: clearing a field here does not blank it, it hands
 * the field back to the metadata source chain and the server re-merges. So the
 * clear button is a revert, not a delete.
 *
 * `authors` is absent on purpose — it is maintained by a trigger over the
 * book_authors join table, not writable as a column.
 */

type FieldKind = "text" | "number" | "list" | "textarea";

type FieldDef = {
  key: keyof BookOverridesRequest;
  labelKey: string;
  kind: FieldKind;
  /** Reads the effective (merged) value currently shown for the book. */
  current: (b: Book) => string;
};

const FIELDS: FieldDef[] = [
  { key: "title", labelKey: "title", kind: "text", current: (b) => b.title },
  {
    key: "subtitle",
    labelKey: "subtitle",
    kind: "text",
    current: (b) => b.subtitle ?? "",
  },
  {
    key: "series_name",
    labelKey: "seriesName",
    kind: "text",
    current: (b) => b.series_name ?? "",
  },
  {
    key: "series_position",
    labelKey: "seriesPosition",
    kind: "number",
    current: (b) =>
      b.series_position == null ? "" : String(b.series_position),
  },
  {
    key: "narrators",
    labelKey: "narrators",
    kind: "list",
    current: (b) => b.narrators.join(", "),
  },
  {
    key: "genres",
    labelKey: "genres",
    kind: "list",
    current: (b) => b.genres.join(", "),
  },
  {
    key: "publisher",
    labelKey: "publisher",
    kind: "text",
    current: (b) => b.publisher ?? "",
  },
  {
    key: "page_count",
    labelKey: "pageCount",
    kind: "number",
    current: (b) => (b.page_count == null ? "" : String(b.page_count)),
  },
  {
    key: "published_date",
    labelKey: "publishedDate",
    kind: "text",
    current: (b) => b.published_date?.slice(0, 10) ?? "",
  },
  {
    key: "published_year",
    labelKey: "publishedYear",
    kind: "number",
    current: (b) => (b.published_year == null ? "" : String(b.published_year)),
  },
  {
    key: "rating",
    labelKey: "rating",
    kind: "number",
    current: (b) => (b.rating == null ? "" : String(b.rating)),
  },
  {
    key: "rating_count",
    labelKey: "ratingCountLabel",
    kind: "number",
    current: (b) => (b.rating_count == null ? "" : String(b.rating_count)),
  },
  {
    key: "language",
    labelKey: "language",
    kind: "text",
    current: (b) => b.language,
  },
  {
    key: "isbn13",
    labelKey: "isbn",
    kind: "text",
    current: (b) => b.isbn13 ?? "",
  },
  {
    key: "cover_url",
    labelKey: "coverUrl",
    kind: "text",
    current: (b) => b.cover_url ?? "",
  },
  {
    key: "overview",
    labelKey: "overview",
    kind: "textarea",
    current: (b) => b.overview ?? "",
  },
];

const LABEL =
  "text-[10px] font-medium uppercase tracking-wide text-neutral-400";

export function BookInfoOverridesSection({ book }: { book: Book }) {
  const { t } = useTranslation("common");
  const update = useUpdateBookOverrides(book.id);

  const [form, setForm] = useState<Record<string, string>>({});
  const [pending, setPending] = useState<string | null>(null);
  /** Last values seen from the server, to tell a dirty field from a stale one. */
  const lastServer = useRef<Record<string, string>>({});

  /**
   * Seed from the effective values so the form shows what the book displays,
   * whatever produced it.
   *
   * Saving one field refetches the book, which would otherwise reset every
   * input — losing edits typed into other fields before their own Save was
   * pressed. So a field is only reseeded when it is not dirty: untouched
   * fields follow the server, edited ones are left alone.
   */
  useEffect(() => {
    setForm((prev) => {
      const next: Record<string, string> = { ...prev };
      for (const f of FIELDS) {
        const server = f.current(book);
        const local = prev[f.key];
        if (local === undefined || local === lastServer.current[f.key]) {
          next[f.key] = server;
        }
        lastServer.current[f.key] = server;
      }
      return next;
    });
  }, [book]);

  const overrides = (book.overrides ?? {}) as Record<string, unknown>;
  /** Stored override keys are camelCase; the form is keyed by wire names. */
  const STORED_KEY: Record<string, string> = {
    series_name: "seriesName",
    series_position: "seriesPosition",
    page_count: "pageCount",
    published_date: "publishedDate",
    published_year: "publishedYear",
    rating_count: "ratingCount",
    cover_url: "coverUrl",
  };
  // Not Object.hasOwn: the web tsconfig targets below ES2022.
  const isOverridden = (key: string) =>
    Object.prototype.hasOwnProperty.call(overrides, STORED_KEY[key] ?? key);

  const toPayload = (f: FieldDef, raw: string): BookOverridesRequest => {
    const value = raw.trim();
    if (!value) return { [f.key]: null } as BookOverridesRequest;
    if (f.kind === "number") {
      const n = Number(value);
      return { [f.key]: Number.isFinite(n) ? n : null } as BookOverridesRequest;
    }
    if (f.kind === "list") {
      return {
        [f.key]: value
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean),
      } as BookOverridesRequest;
    }
    return { [f.key]: value } as BookOverridesRequest;
  };

  const save = async (f: FieldDef) => {
    setPending(f.key);
    try {
      await update.mutateAsync(toPayload(f, form[f.key] ?? ""));
      toast.success(t("books.detail.overrides.saved"));
    } catch (e) {
      toast.error(
        e instanceof ApiError ? e.message : t("books.detail.overrides.failed"),
      );
    } finally {
      setPending(null);
    }
  };

  const revert = async (f: FieldDef) => {
    setPending(f.key);
    try {
      const res = await update.mutateAsync({
        [f.key]: null,
      } as BookOverridesRequest);
      // Show whatever the sources produced, rather than leaving the input empty.
      setForm((prev) => ({ ...prev, [f.key]: f.current(res.item) }));
      toast.success(t("books.detail.overrides.reverted"));
    } catch (e) {
      toast.error(
        e instanceof ApiError ? e.message : t("books.detail.overrides.failed"),
      );
    } finally {
      setPending(null);
    }
  };

  return (
    <div className="space-y-4">
      <p className="text-xs text-neutral-400">
        {t("books.detail.overrides.hint")}
      </p>

      <div className="grid gap-4 sm:grid-cols-2">
        {FIELDS.map((f) => {
          const busy = pending === f.key;
          const dirty = (form[f.key] ?? "") !== f.current(book);
          // (f.current(book) is the effective value the server last returned)
          return (
            <div
              key={f.key}
              className={f.kind === "textarea" ? "sm:col-span-2" : undefined}
            >
              <div className="mb-1.5 flex items-center justify-between gap-2">
                <label className={LABEL} htmlFor={`ov-${f.key}`}>
                  {t(`books.detail.metadata.${f.labelKey}`, f.labelKey)}
                </label>
                {isOverridden(f.key) && (
                  <span className="text-[10px] text-amber-400">
                    {t("books.detail.overrides.edited")}
                  </span>
                )}
              </div>

              {f.kind === "textarea" ? (
                <textarea
                  id={`ov-${f.key}`}
                  rows={4}
                  value={form[f.key] ?? ""}
                  onChange={(e) =>
                    setForm((p) => ({ ...p, [f.key]: e.target.value }))
                  }
                  className="w-full rounded-md border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm text-neutral-100"
                />
              ) : (
                <Input
                  id={`ov-${f.key}`}
                  value={form[f.key] ?? ""}
                  inputMode={f.kind === "number" ? "decimal" : undefined}
                  placeholder={
                    f.kind === "list"
                      ? t("books.detail.overrides.listHint")
                      : undefined
                  }
                  onChange={(e) =>
                    setForm((p) => ({ ...p, [f.key]: e.target.value }))
                  }
                />
              )}

              <div className="mt-1.5 flex gap-2">
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  disabled={busy || !dirty}
                  onClick={() => save(f)}
                >
                  {busy && <Loader2 className="mr-1.5 h-3 w-3 animate-spin" />}
                  {t("books.detail.overrides.save")}
                </Button>
                {isOverridden(f.key) && (
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    disabled={busy}
                    onClick={() => revert(f)}
                    title={t("books.detail.overrides.revertHint")}
                  >
                    <RotateCcw className="mr-1.5 h-3 w-3" />
                    {t("books.detail.overrides.revert")}
                  </Button>
                )}
              </div>
            </div>
          );
        })}
      </div>

      <p className="text-[11px] text-neutral-500">
        {t("books.detail.overrides.authorsNote")}
      </p>
    </div>
  );
}

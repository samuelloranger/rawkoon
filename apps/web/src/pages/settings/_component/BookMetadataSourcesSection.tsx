import { useEffect, useState } from "react";
import { toast } from "sonner";
import { ArrowDown, ArrowUp, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import {
  useBookMetadataSources,
  useUpdateBookMetadataSources,
} from "@/pages/settings/useBookMetadataSources";
import { ApiError } from "@/lib/api/client";
import type { BookMetadataSource } from "@rawkoon/shared/types";

/**
 * Metadata source priority.
 *
 * The order doubles as the enable list — a source absent from the saved array
 * is disabled — so switching one off removes it rather than setting a second
 * flag that could disagree with the order.
 *
 * Reordering uses buttons, not drag-and-drop: a drag-only control is unusable
 * without a pointer.
 */

const ALL_SOURCES: BookMetadataSource[] = [
  "local",
  "audnexus",
  "googlebooks",
  "openlibrary",
];

const SOURCE_LABELS: Record<BookMetadataSource, string> = {
  local: "Files on disk",
  audnexus: "Audnexus / Audible",
  googlebooks: "Google Books",
  openlibrary: "Open Library",
};

const SOURCE_HINTS: Record<BookMetadataSource, string> = {
  local: "Tags in your own files. Highest priority so a tagger fix sticks.",
  audnexus: "Narrators, series, genres, publisher, ratings, cover art.",
  googlebooks:
    "Identity and descriptions. The fallback when nothing else matches.",
  openlibrary: "Page counts and ratings only.",
};

export function BookMetadataSourcesSection() {
  const { data, isLoading } = useBookMetadataSources();
  const update = useUpdateBookMetadataSources();

  const [order, setOrder] = useState<BookMetadataSource[]>([]);

  useEffect(() => {
    if (data?.order) setOrder(data.order);
  }, [data?.order]);

  const disabled = ALL_SOURCES.filter((s) => !order.includes(s));

  const move = (index: number, delta: number) => {
    const next = [...order];
    const target = index + delta;
    if (target < 0 || target >= next.length) return;
    const [item] = next.splice(index, 1);
    next.splice(target, 0, item);
    setOrder(next);
  };

  const toggle = (source: BookMetadataSource, on: boolean) => {
    setOrder((prev) =>
      on ? [...prev, source] : prev.filter((s) => s !== source),
    );
  };

  const save = async () => {
    try {
      await update.mutateAsync(order);
      toast.success("Metadata source order saved");
    } catch (e) {
      toast.error(
        e instanceof ApiError ? e.message : "Failed to save the source order",
      );
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 text-sm text-neutral-400">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading sources…
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <p className="text-xs text-neutral-400">
        Each field is taken from the highest source in this list that has it.
        Anything you have edited by hand always wins over every source.
      </p>

      <ol className="space-y-2">
        {order.map((source, index) => (
          <li
            key={source}
            className="flex items-center gap-3 rounded-lg border border-neutral-700 bg-neutral-900/40 px-3 py-2"
          >
            <span className="w-5 text-center text-xs font-semibold text-neutral-500">
              {index + 1}
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm text-neutral-100">
                {SOURCE_LABELS[source]}
              </p>
              <p className="truncate text-xs text-neutral-500">
                {SOURCE_HINTS[source]}
              </p>
            </div>
            <Button
              type="button"
              size="icon"
              variant="ghost"
              aria-label={`Move ${SOURCE_LABELS[source]} up`}
              disabled={index === 0}
              onClick={() => move(index, -1)}
            >
              <ArrowUp className="h-4 w-4" />
            </Button>
            <Button
              type="button"
              size="icon"
              variant="ghost"
              aria-label={`Move ${SOURCE_LABELS[source]} down`}
              disabled={index === order.length - 1}
              onClick={() => move(index, 1)}
            >
              <ArrowDown className="h-4 w-4" />
            </Button>
            <Switch
              checked
              aria-label={`Disable ${SOURCE_LABELS[source]}`}
              onCheckedChange={() => toggle(source, false)}
            />
          </li>
        ))}
      </ol>

      {disabled.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs font-medium text-neutral-400">Disabled</p>
          {disabled.map((source) => (
            <div
              key={source}
              className="flex items-center gap-3 rounded-lg border border-dashed border-neutral-700 px-3 py-2"
            >
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm text-neutral-400">
                  {SOURCE_LABELS[source]}
                </p>
              </div>
              <Switch
                checked={false}
                aria-label={`Enable ${SOURCE_LABELS[source]}`}
                onCheckedChange={() => toggle(source, true)}
              />
            </div>
          ))}
        </div>
      )}

      {order.length === 0 && (
        <p className="text-xs text-amber-400">
          With every source off, nothing can be enriched — saving this restores
          the default order.
        </p>
      )}

      <Button type="button" onClick={save} disabled={update.isPending}>
        {update.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
        Save source order
      </Button>
    </div>
  );
}

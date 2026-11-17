import { Fragment } from "react";
import { useTranslation } from "react-i18next";
import { ArrowDown, ArrowUp, GripVertical, Rows3, X } from "lucide-react";
import type { ShelfEntryView } from "@rawkoon/shared/types";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { GroupHeader } from "./GroupHeader";
import { startsGroup } from "./shelfOrder";
import type { useLiveReorder } from "./useLiveReorder";

export function ShelfEntriesList({
  shown,
  count,
  reorder,
  isAdmin,
  moveTo,
  setGroup,
  onRemove,
}: {
  shown: readonly ShelfEntryView[];
  count: number;
  reorder: ReturnType<typeof useLiveReorder<ShelfEntryView>>;
  isAdmin: boolean;
  moveTo: (fromId: number, toIndex: number) => void;
  setGroup: (entryId: number, label: string) => void;
  onRemove: (entryId: number) => void;
}) {
  const { t } = useTranslation("common");

  return (
    <ul className="divide-y divide-neutral-800 rounded-xl border border-neutral-800">
      {shown.map((entry, index) => (
        <Fragment key={entry.id}>
          {startsGroup(shown, index) && (
            <GroupHeader
              label={entry.group_label ?? ""}
              editable={isAdmin}
              onRename={(label) => setGroup(entry.id, label)}
            />
          )}
          <li
            {...reorder.rowProps(entry, index)}
            className={cn(
              "flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 sm:flex-nowrap",
              reorder.dragging === entry.id &&
                "relative z-10 opacity-50 ring-1 ring-primary-400",
            )}
          >
            {isAdmin && (
              <span aria-hidden className="cursor-grab text-neutral-500">
                <GripVertical size={15} />
              </span>
            )}
            <span className="w-6 shrink-0 text-right text-xs tabular-nums text-neutral-500">
              {index + 1}
            </span>
            <div className="h-14 w-10 shrink-0 overflow-hidden rounded bg-neutral-800">
              {entry.poster_url ? (
                <img
                  draggable={false}
                  src={entry.poster_url}
                  alt=""
                  loading="lazy"
                  className="h-full w-full object-cover"
                />
              ) : null}
            </div>
            <div className="min-w-0 flex-1 basis-32">
              <p className="truncate text-sm text-neutral-100">
                {entry.title}
                {entry.season != null ? ` · S${entry.season}` : ""}
              </p>
              <p className="text-xs text-neutral-500">
                {[entry.year, t(`shelves.type.${entry.type}`)]
                  .filter(Boolean)
                  .join(" · ")}
                {entry.in_library
                  ? ` · ${t("shelves.inLibrary")}`
                  : ` · ${t("shelves.notInLibrary")}`}
              </p>
              {isAdmin && entry.source === "rule" && (
                <p
                  className="mt-0.5 text-xs text-neutral-500"
                  title={entry.reason?.join(", ")}
                >
                  <span className="mr-1.5 rounded-full bg-neutral-800 px-2 py-0.5 text-neutral-300">
                    {t("shelves.rules.badge")}
                  </span>
                  {entry.reason?.join(" · ")}
                </p>
              )}
            </div>
            {isAdmin && (
              <div className="flex w-full shrink-0 items-center justify-end sm:w-auto">
                <Button
                  size="sm"
                  variant="ghost"
                  aria-label={t("shelves.moveEarlier", {
                    title: entry.title,
                  })}
                  disabled={index === 0}
                  onClick={() => moveTo(entry.id, index - 1)}
                >
                  <ArrowUp size={15} />
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  aria-label={t("shelves.moveLater", {
                    title: entry.title,
                  })}
                  disabled={index === count - 1}
                  onClick={() => moveTo(entry.id, index + 1)}
                >
                  <ArrowDown size={15} />
                </Button>
                {!startsGroup(shown, index) && (
                  <Button
                    size="sm"
                    variant="ghost"
                    aria-label={t("shelves.groupStart", {
                      title: entry.title,
                    })}
                    onClick={() => setGroup(entry.id, t("shelves.groupNew"))}
                  >
                    <Rows3 size={15} />
                  </Button>
                )}
                <Button
                  size="sm"
                  variant="ghost"
                  aria-label={t("shelves.removeEntry")}
                  onClick={() => onRemove(entry.id)}
                >
                  <X size={15} />
                </Button>
              </div>
            )}
          </li>
        </Fragment>
      ))}
    </ul>
  );
}

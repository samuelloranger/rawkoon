import { useTranslation } from "react-i18next";
import type { ShelfEntryView } from "@rawkoon/shared/types";
import { Button } from "@/components/ui/button";

/** Rule titles an admin took off the shelf; kept so the rules never add them back. */
export function RemovedEntries({
  entries,
  onPutBack,
}: {
  entries: ShelfEntryView[];
  onPutBack: (entry: ShelfEntryView) => void;
}) {
  const { t } = useTranslation("common");
  if (!entries.length) return null;
  return (
    <div className="mt-6">
      <h2 className="text-sm font-medium text-neutral-300">
        {t("shelves.removedTitle")}
      </h2>
      <p className="mb-2 text-xs text-neutral-500">
        {t("shelves.removedHint")}
      </p>
      <ul className="divide-y divide-neutral-800 rounded-xl border border-neutral-800">
        {entries.map((entry) => (
          <li
            key={entry.id}
            className="flex items-center gap-3 px-3 py-2 opacity-70"
          >
            <p className="min-w-0 flex-1 truncate text-sm text-neutral-300">
              {entry.title}
              {entry.year ? ` · ${entry.year}` : ""}
            </p>
            <Button size="sm" variant="ghost" onClick={() => onPutBack(entry)}>
              {t("shelves.putBack")}
            </Button>
          </li>
        ))}
      </ul>
    </div>
  );
}

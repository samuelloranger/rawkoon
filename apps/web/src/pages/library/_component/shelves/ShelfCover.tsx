import { Layers } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { ShelfSummary } from "@rawkoon/shared/types";
import { cn } from "@/lib/utils";

/**
 * A shelf's cover: its 2×2 poster mosaic, the backdrop it chose or an uploaded
 * image, with the
 * name and how many titles it holds over the bottom of the art. The same
 * drawing the TV uses, so a shelf reads the same on every screen.
 */
export function ShelfCover({
  shelf,
  className,
}: {
  shelf: ShelfSummary;
  className?: string;
}) {
  const { t } = useTranslation("common");
  const posters =
    shelf.cover.style === "mosaic" ? shelf.cover.posters.slice(0, 4) : [];
  // An uploaded cover is drawn like a backdrop: one image, filling the card
  const backdrop =
    shelf.cover.style === "backdrop"
      ? shelf.cover.backdrop_url
      : shelf.cover.style === "upload"
        ? shelf.cover.url
        : null;
  return (
    <div
      className={cn(
        "relative aspect-video w-full overflow-hidden rounded-xl bg-neutral-800",
        className,
      )}
    >
      {backdrop ? (
        <img
          src={backdrop}
          alt=""
          loading="lazy"
          className="h-full w-full object-cover"
        />
      ) : posters.length > 0 ? (
        <div className="grid h-full w-full grid-cols-2 grid-rows-2">
          {posters.map((url) => (
            <img
              key={url}
              src={url}
              alt=""
              loading="lazy"
              className="h-full w-full object-cover"
            />
          ))}
        </div>
      ) : (
        <div className="flex h-full w-full items-center justify-center text-neutral-600">
          <Layers size={28} />
        </div>
      )}
      <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/85 via-black/40 to-transparent px-3 pb-2 pt-8">
        <p className="truncate font-display text-sm font-semibold text-neutral-50">
          {shelf.name}
        </p>
        <p className="truncate text-xs text-neutral-300">
          {t("shelves.titles", { count: shelf.entry_count })}
        </p>
      </div>
      {!shelf.visible_now && (
        <span className="absolute left-2 top-2 rounded-full bg-black/70 px-2 py-0.5 text-[11px] font-medium text-neutral-300">
          {t("shelves.hiddenNow")}
        </span>
      )}
      {shelf.home_row && (
        <span className="absolute right-2 top-2 rounded-full bg-black/70 px-2 py-0.5 text-[11px] font-medium text-neutral-300">
          {t("shelves.onHome")}
        </span>
      )}
    </div>
  );
}

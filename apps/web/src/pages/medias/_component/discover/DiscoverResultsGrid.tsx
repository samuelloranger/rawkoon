import { motion, AnimatePresence } from "motion/react";
import type { TmdbMediaSearchItem } from "@rawkoon/shared/types";
import { ExploreCard } from "@/pages/medias/_component/ExploreCard";
import { cn } from "@/lib/utils";
import {
  discoverGridContainerVariants,
  discoverGridItemVariants,
} from "./discoverConfig";

export function DiscoverResultsGrid({
  discoverPageSize,
  showSkeletonGrid,
  hasItems,
  gridKey,
  isPlaceholderData,
  items,
  noResultsLabel,
}: {
  discoverPageSize: number;
  showSkeletonGrid: boolean;
  hasItems: boolean;
  gridKey: string;
  isPlaceholderData: boolean;
  items: TmdbMediaSearchItem[] | undefined;
  noResultsLabel: string;
}) {
  return (
    <div className="relative min-h-48">
      {showSkeletonGrid && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
          {Array.from({ length: discoverPageSize }).map((_, i) => (
            <div
              key={i}
              className="aspect-[2/3] animate-pulse rounded-xl bg-neutral-800 ring-1 ring-primary-500/30"
              style={{ animationDelay: `${i * 20}ms` }}
            />
          ))}
        </div>
      )}

      {!showSkeletonGrid && items?.length === 0 && (
        <div className="flex flex-col items-center justify-center gap-2 py-16">
          <p className="text-sm text-neutral-500">{noResultsLabel}</p>
        </div>
      )}

      <AnimatePresence mode="wait">
        {!showSkeletonGrid && hasItems && items && (
          <motion.div
            key={gridKey}
            className={cn(
              "grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6",
              isPlaceholderData && "pointer-events-none opacity-60",
            )}
            variants={discoverGridContainerVariants}
            initial="hidden"
            animate="show"
            exit={{ opacity: 0, transition: { duration: 0.1 } }}
          >
            {items.map((item) => (
              <motion.div key={item.id} variants={discoverGridItemVariants}>
                <ExploreCard item={item} />
              </motion.div>
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

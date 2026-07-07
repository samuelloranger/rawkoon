import { ChevronLeft, ChevronRight } from "lucide-react";

function PageDot({
  n,
  current,
  onClick,
}: {
  n: number;
  current: number;
  onClick: () => void;
}) {
  const active = n === current;
  return (
    <button
      type="button"
      onClick={onClick}
      className={[
        "flex h-8 min-w-8 items-center justify-center rounded-lg px-2 text-xs font-medium transition-[background-color,border-color,color] duration-150",
        active
          ? "bg-primary-600 text-neutral-950"
          : "border border-neutral-700 bg-neutral-900 text-neutral-400 hover:border-neutral-600 hover:text-neutral-200",
      ].join(" ")}
    >
      {n}
    </button>
  );
}

export function DiscoverPagination({
  page,
  totalPages,
  isFetching,
  onPageChange,
}: {
  page: number;
  totalPages: number;
  isFetching: boolean;
  onPageChange: (page: number) => void;
}) {
  if (totalPages <= 1) return null;

  const goPrev = () => onPageChange(Math.max(1, page - 1));
  const goNext = () => onPageChange(Math.min(totalPages, page + 1));

  return (
    <>
      <div className="flex items-center justify-between gap-3 md:hidden">
        <button
          type="button"
          onClick={goPrev}
          disabled={page === 1 || isFetching}
          className="flex h-11 flex-1 items-center justify-center gap-2 rounded-xl border border-neutral-700 bg-neutral-900 text-sm text-neutral-300 transition-colors hover:border-neutral-600 disabled:cursor-not-allowed disabled:opacity-30"
        >
          <ChevronLeft size={16} />
          <span className="font-medium">Prev</span>
        </button>

        <span className="shrink-0 text-sm tabular-nums text-neutral-500">
          {page} / {totalPages}
        </span>

        <button
          type="button"
          onClick={goNext}
          disabled={page === totalPages || isFetching}
          className="flex h-11 flex-1 items-center justify-center gap-2 rounded-xl border border-neutral-700 bg-neutral-900 text-sm text-neutral-300 transition-colors hover:border-neutral-600 disabled:cursor-not-allowed disabled:opacity-30"
        >
          <span className="font-medium">Next</span>
          <ChevronRight size={16} />
        </button>
      </div>

      <div className="hidden items-center justify-center gap-2 md:flex">
        <button
          type="button"
          onClick={goPrev}
          disabled={page === 1 || isFetching}
          className="flex h-8 w-8 items-center justify-center rounded-lg border border-neutral-700 bg-neutral-900 text-neutral-400 transition-colors hover:border-neutral-600 hover:text-neutral-200 disabled:cursor-not-allowed disabled:opacity-30"
        >
          <ChevronLeft size={15} />
        </button>

        <div className="flex items-center gap-1">
          {page > 3 && (
            <>
              <PageDot n={1} current={page} onClick={() => onPageChange(1)} />
              {page > 4 && (
                <span className="px-0.5 text-xs text-neutral-600">…</span>
              )}
            </>
          )}
          {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
            const start = Math.max(1, Math.min(page - 2, totalPages - 4));
            return start + i;
          }).map((n) => (
            <PageDot
              key={n}
              n={n}
              current={page}
              onClick={() => onPageChange(n)}
            />
          ))}
          {page < totalPages - 2 && (
            <>
              {page < totalPages - 3 && (
                <span className="px-0.5 text-xs text-neutral-600">…</span>
              )}
              <PageDot
                n={totalPages}
                current={page}
                onClick={() => onPageChange(totalPages)}
              />
            </>
          )}
        </div>

        <button
          type="button"
          onClick={goNext}
          disabled={page === totalPages || isFetching}
          className="flex h-8 w-8 items-center justify-center rounded-lg border border-neutral-700 bg-neutral-900 text-neutral-400 transition-colors hover:border-neutral-600 hover:text-neutral-200 disabled:cursor-not-allowed disabled:opacity-30"
        >
          <ChevronRight size={15} />
        </button>
      </div>
    </>
  );
}

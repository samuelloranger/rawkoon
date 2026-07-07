import { Check } from "lucide-react";

export function DiscoverServicePicker({
  providers,
  selectedId,
  onSelect,
  allLabel,
}: {
  providers: { id: number; name: string; logo_url: string }[];
  selectedId: number | null;
  onSelect: (id: number | null) => void;
  allLabel: string;
}) {
  return (
    <div className="max-h-[360px] overflow-y-auto p-2">
      <button
        type="button"
        onClick={() => onSelect(null)}
        className={[
          "flex w-full items-center justify-between rounded-md px-3 py-2 text-sm transition-colors",
          selectedId === null
            ? "bg-primary-500/15 text-primary-200"
            : "text-neutral-200 hover:bg-neutral-800",
        ].join(" ")}
      >
        <span className="font-medium">{allLabel}</span>
        {selectedId === null && <Check size={14} />}
      </button>
      <div className="mt-1 grid grid-cols-4 gap-1.5 p-1">
        {providers.map((p) => {
          const active = selectedId === p.id;
          return (
            <button
              key={p.id}
              type="button"
              onClick={() => onSelect(p.id)}
              title={p.name}
              aria-label={p.name}
              className={[
                "relative flex aspect-square items-center justify-center rounded-lg border p-1.5 transition-all",
                active
                  ? "border-primary-500 ring-2 ring-primary-500/30 bg-primary-500/5"
                  : "border-neutral-700 hover:border-neutral-600",
              ].join(" ")}
            >
              <img
                src={p.logo_url}
                alt={p.name}
                className="h-full w-full rounded-md object-contain"
              />
              {active && (
                <span className="absolute -top-1 -right-1 flex h-4 w-4 items-center justify-center rounded-full bg-primary-500 text-neutral-950 ring-2 ring-neutral-800">
                  <Check size={9} strokeWidth={3} />
                </span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

export function DiscoverGenrePicker({
  genres,
  selectedId,
  onSelect,
  allLabel,
}: {
  genres: { id: number; name: string }[];
  selectedId: number | null;
  onSelect: (id: number | null) => void;
  allLabel: string;
}) {
  return (
    <div className="max-h-[360px] overflow-y-auto p-2">
      <button
        type="button"
        onClick={() => onSelect(null)}
        className={[
          "flex w-full items-center justify-between rounded-md px-3 py-2 text-sm transition-colors",
          selectedId === null
            ? "bg-primary-500/15 text-primary-200"
            : "text-neutral-200 hover:bg-neutral-800",
        ].join(" ")}
      >
        <span className="font-medium">{allLabel}</span>
        {selectedId === null && <Check size={14} />}
      </button>
      <div className="mt-1 grid grid-cols-2 gap-1">
        {genres.map((g) => {
          const active = selectedId === g.id;
          return (
            <button
              key={g.id}
              type="button"
              onClick={() => onSelect(g.id)}
              className={[
                "flex items-center justify-between rounded-md px-3 py-1.5 text-left text-sm transition-colors",
                active
                  ? "bg-primary-500/15 text-primary-200"
                  : "text-neutral-200 hover:bg-neutral-800",
              ].join(" ")}
            >
              <span className="truncate">{g.name}</span>
              {active && <Check size={13} className="shrink-0" />}
            </button>
          );
        })}
      </div>
    </div>
  );
}

export function DiscoverSortPicker({
  options,
  selected,
  onSelect,
}: {
  options: { value: string; label: string }[];
  selected: string;
  onSelect: (value: string) => void;
}) {
  return (
    <div className="p-1.5">
      {options.map((o) => {
        const active = selected === o.value;
        return (
          <button
            key={o.value}
            type="button"
            onClick={() => onSelect(o.value)}
            className={[
              "flex w-full items-center justify-between rounded-md px-3 py-2 text-sm transition-colors",
              active
                ? "bg-primary-500/15 text-primary-200 font-medium"
                : "text-neutral-200 hover:bg-neutral-800",
            ].join(" ")}
          >
            <span>{o.label}</span>
            {active && <Check size={14} />}
          </button>
        );
      })}
    </div>
  );
}

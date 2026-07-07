import { useState } from "react";
import {
  Check,
  ChevronDown,
  ChevronUp,
  Globe,
  Lock,
  Plus,
  X,
} from "lucide-react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { useIndexers } from "@/pages/settings/useQualityProfiles";
import { cn } from "@/lib/utils";

// ─── Tracker priority bonus display ──────────────────────────────────────────

function trackerBonus(rank: number, preferOverQuality: boolean): string {
  const base = preferOverQuality ? 1500 : 300;
  const pts = Math.max(0, base - rank * 100);
  return pts > 0 ? `+${pts} pts` : "0 pts";
}

// ─── Tracker priority section ─────────────────────────────────────────────────

export function TrackerPrioritySection({
  trackers,
  preferOverQuality,
  onTrackersChange,
  onPreferOverQualityChange,
}: {
  trackers: string[];
  preferOverQuality: boolean;
  onTrackersChange: (next: string[]) => void;
  onPreferOverQualityChange: (next: boolean) => void;
}) {
  const [popoverOpen, setPopoverOpen] = useState(false);
  const [search, setSearch] = useState("");
  const { data, isFetching } = useIndexers(popoverOpen);

  const indexers = data?.indexers ?? [];
  const available = indexers.filter(
    (idx) =>
      !trackers.includes(idx.name) &&
      idx.name.toLowerCase().includes(search.toLowerCase()),
  );

  const add = (name: string) => {
    onTrackersChange([...trackers, name]);
    setSearch("");
  };

  const remove = (name: string) => {
    onTrackersChange(trackers.filter((t) => t !== name));
  };

  const move = (from: number, to: number) => {
    const next = [...trackers];
    const [item] = next.splice(from, 1);
    next.splice(to, 0, item);
    onTrackersChange(next);
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <label className="text-sm font-medium text-neutral-300">
          Trackers prioritaires
        </label>
        <Popover open={popoverOpen} onOpenChange={setPopoverOpen}>
          <PopoverTrigger asChild>
            <button
              type="button"
              className="inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs font-medium transition-colors border-neutral-700 bg-neutral-900 text-neutral-400 hover:border-neutral-600 hover:bg-neutral-800"
            >
              <Plus size={12} />
              Ajouter
            </button>
          </PopoverTrigger>
          <PopoverContent align="end" sideOffset={6} className="w-64 p-2">
            <input
              autoFocus
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Rechercher un tracker…"
              className="mb-2 w-full rounded-md border px-2.5 py-1.5 text-sm placeholder-neutral-400 focus:outline-none focus:ring-2 focus:ring-primary-500/30 border-neutral-700 bg-neutral-900 text-neutral-100"
            />
            {isFetching && available.length === 0 ? (
              <p className="px-2 py-3 text-center text-xs text-neutral-400">
                Chargement…
              </p>
            ) : available.length === 0 ? (
              <p className="px-2 py-3 text-center text-xs text-neutral-400">
                {search
                  ? "Aucun résultat"
                  : "Tous les trackers sont déjà ajoutés"}
              </p>
            ) : (
              <div className="max-h-52 overflow-y-auto">
                {available.map((idx) => (
                  <button
                    key={idx.id}
                    type="button"
                    onClick={() => {
                      add(idx.name);
                      setPopoverOpen(false);
                    }}
                    className="flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-sm text-neutral-300 hover:bg-neutral-700/50 transition-colors"
                  >
                    {idx.privacy === "private" ? (
                      <Lock size={12} className="shrink-0 text-amber-500" />
                    ) : (
                      <Globe size={12} className="shrink-0 text-neutral-400" />
                    )}
                    <span className="flex-1 text-left">{idx.name}</span>
                    {idx.privacy === "private" && (
                      <span className="rounded px-1 py-0.5 text-[10px] font-medium bg-amber-500/10 text-amber-400">
                        Privé
                      </span>
                    )}
                  </button>
                ))}
              </div>
            )}
          </PopoverContent>
        </Popover>
      </div>

      {trackers.length === 0 ? (
        <p className="rounded-lg border border-dashed px-4 py-3 text-center text-xs text-neutral-400 border-neutral-700">
          Aucun tracker prioritaire — tous les indexers sont traités également
        </p>
      ) : (
        <div className="flex flex-col gap-1">
          {trackers.map((name, i) => (
            <div
              key={name}
              className="flex items-center gap-2 rounded-lg border px-3 py-2 border-neutral-700 bg-neutral-800/60"
            >
              <span className="w-6 shrink-0 text-center text-xs font-semibold text-neutral-500">
                #{i + 1}
              </span>
              <span className="flex-1 text-sm text-neutral-200">{name}</span>
              <span className="text-xs font-medium text-primary-400">
                {trackerBonus(i, preferOverQuality)}
              </span>
              <div className="flex items-center gap-0.5">
                <button
                  type="button"
                  disabled={i === 0}
                  onClick={() => move(i, i - 1)}
                  className="rounded p-1 text-neutral-400 disabled:opacity-30 disabled:cursor-not-allowed hover:bg-neutral-700 hover:text-neutral-300 transition-colors"
                >
                  <ChevronUp size={14} />
                </button>
                <button
                  type="button"
                  disabled={i === trackers.length - 1}
                  onClick={() => move(i, i + 1)}
                  className="rounded p-1 text-neutral-400 disabled:opacity-30 disabled:cursor-not-allowed hover:bg-neutral-700 hover:text-neutral-300 transition-colors"
                >
                  <ChevronDown size={14} />
                </button>
                <button
                  type="button"
                  onClick={() => remove(name)}
                  className="rounded p-1 text-neutral-400 hover:text-red-500 hover:bg-red-500/10 transition-colors"
                >
                  <X size={14} />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {trackers.length > 0 && (
        <label className="flex items-start gap-2.5 cursor-pointer select-none group">
          <span
            className={cn(
              "mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded border transition-colors",
              preferOverQuality
                ? "text-white border-primary-400 bg-primary-400"
                : "border-neutral-600 group-hover:border-neutral-400",
            )}
          >
            {preferOverQuality && <Check size={10} strokeWidth={3} />}
          </span>
          <input
            type="checkbox"
            className="sr-only"
            checked={preferOverQuality}
            onChange={(e) => onPreferOverQualityChange(e.target.checked)}
          />
          <span className="flex flex-col gap-0.5">
            <span className="text-sm text-neutral-300">
              Préférer le tracker sur la qualité
            </span>
            <span className="text-xs text-neutral-500">
              Le tracker prioritaire l'emporte sur la résolution et la source
              (+1 500 / +1 000 / +500 pts)
            </span>
          </span>
        </label>
      )}
    </div>
  );
}

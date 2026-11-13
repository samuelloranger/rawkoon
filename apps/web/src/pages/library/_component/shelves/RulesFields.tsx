import { useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { X } from "lucide-react";
import type { ShelfLookupItem, ShelfPreviewTitle } from "@rawkoon/shared/types";
import { useFetcher } from "@/lib/api/context";
import { SHELVES_ENDPOINTS } from "@/lib/endpoints";
import { queryKeys } from "@/lib/queryKeys";
import { useDebounced } from "@/features/transcode/useDebounced";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

const Chip = ({
  children,
  onRemove,
  removeLabel,
}: {
  children: ReactNode;
  onRemove?: () => void;
  removeLabel?: string;
}) => (
  <span className="inline-flex max-w-full items-center gap-1 rounded-full bg-neutral-800 px-2.5 py-1 text-xs text-neutral-200">
    <span className="truncate">{children}</span>
    {onRemove && (
      <button
        type="button"
        aria-label={removeLabel}
        onClick={onRemove}
        className="focus-ring -m-1 shrink-0 p-1 text-neutral-400 hover:text-neutral-100"
      >
        <X size={14} />
      </button>
    )}
  </span>
);

export const Field = ({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) => (
  <div className="space-y-1.5">
    <p className="text-xs font-medium text-neutral-400">{label}</p>
    {children}
  </div>
);

/** A genre is on, or off; pills toggle, so include and exclude lists share one genre list. */
export function GenrePills({
  genres,
  selected,
  label,
  onToggle,
}: {
  genres: { id: number; name: string }[];
  selected: number[];
  label: string;
  onToggle: (id: number) => void;
}) {
  return (
    <div role="group" aria-label={label} className="flex flex-wrap gap-1.5">
      {genres.map((genre) => (
        <button
          key={genre.id}
          type="button"
          aria-pressed={selected.includes(genre.id)}
          onClick={() => onToggle(genre.id)}
          className={cn(
            "focus-ring min-h-9 rounded-full border px-3 py-1.5 text-xs",
            selected.includes(genre.id)
              ? "border-primary-400 bg-primary-500/20 text-neutral-100"
              : "border-neutral-700 text-neutral-400 hover:text-neutral-200",
          )}
        >
          {genre.name}
        </button>
      ))}
    </div>
  );
}

/** Debounced TMDB search that adds a chip; `names` remembers the pick's name for display. */
export function LookupField({
  kind,
  ids,
  names,
  label,
  onAdd,
  onRemove,
}: {
  kind: "keywords" | "companies";
  ids: number[];
  names: Map<string, string>;
  label: string;
  onAdd: (item: ShelfLookupItem) => void;
  onRemove: (id: number) => void;
}) {
  const { t } = useTranslation("common");
  const fetcher = useFetcher();
  const [text, setText] = useState("");
  const q = useDebounced(text.trim(), 300);
  const results = useQuery({
    queryKey: queryKeys.shelfPicker.lookup(kind, q),
    queryFn: () =>
      fetcher<{ items: ShelfLookupItem[] }>(SHELVES_ENDPOINTS.LOOKUP(kind, q)),
    enabled: q.length >= 2,
    retry: false,
  });
  const items = (results.data?.items ?? []).filter(
    (item) => !ids.includes(item.id),
  );

  return (
    <Field label={label}>
      {ids.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {ids.map((id) => (
            <Chip
              key={id}
              removeLabel={t("shelves.rules.remove", {
                name: names.get(`${kind}:${id}`) ?? `#${id}`,
              })}
              onRemove={() => onRemove(id)}
            >
              {names.get(`${kind}:${id}`) ?? `#${id}`}
            </Chip>
          ))}
        </div>
      )}
      <Input
        value={text}
        placeholder={t("shelves.rules.lookupPlaceholder")}
        aria-label={label}
        onChange={(event) => setText(event.target.value)}
      />
      {q.length >= 2 && text.trim() === q && (
        <ul className="max-h-48 overflow-y-auto rounded-md border border-neutral-800 bg-neutral-900">
          {results.isError ? (
            <li className="px-3 py-2 text-xs text-neutral-500">
              {t("shelves.rules.lookupError")}
            </li>
          ) : items.length === 0 ? (
            <li className="px-3 py-2 text-xs text-neutral-500">
              {results.isLoading
                ? t("shelves.searching")
                : t("shelves.noResults")}
            </li>
          ) : (
            items.map((item) => (
              <li key={item.id}>
                <button
                  type="button"
                  onClick={() => {
                    onAdd(item);
                    setText("");
                  }}
                  className="focus-ring w-full px-3 py-2 text-left text-sm text-neutral-200 hover:bg-neutral-800"
                >
                  {item.name}
                </button>
              </li>
            ))
          )}
        </ul>
      )}
    </Field>
  );
}

/** Free-form chips: type, press Enter. `parse` returns null to reject the text. */
export function TokenField<T extends string | number>({
  label,
  hint,
  values,
  parse,
  onChange,
}: {
  label: string;
  hint?: string;
  values: T[];
  parse: (text: string) => T | null;
  onChange: (next: T[]) => void;
}) {
  const { t } = useTranslation("common");
  const [text, setText] = useState("");
  const commit = () => {
    const value = parse(text.trim());
    if (value != null && !values.includes(value)) onChange([...values, value]);
    setText("");
  };
  return (
    <Field label={label}>
      {values.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {values.map((value) => (
            <Chip
              key={value}
              removeLabel={t("shelves.rules.remove", { name: value })}
              onRemove={() => onChange(values.filter((v) => v !== value))}
            >
              {value}
            </Chip>
          ))}
        </div>
      )}
      <Input
        value={text}
        placeholder={hint}
        aria-label={label}
        onChange={(event) => setText(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            commit();
          }
        }}
      />
    </Field>
  );
}

export const NumberField = ({
  label,
  value,
  onChange,
  step,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  step?: string;
}) => (
  <Field label={label}>
    <Input
      type="number"
      inputMode="decimal"
      min={0}
      step={step}
      value={value}
      aria-label={label}
      onChange={(event) => onChange(event.target.value)}
    />
  </Field>
);

export function PreviewRow({
  item,
  action,
}: {
  item: ShelfPreviewTitle;
  action?: ReactNode;
}) {
  const { t } = useTranslation("common");
  return (
    <li className="flex items-center gap-3 px-3 py-2">
      <div className="h-14 w-10 shrink-0 overflow-hidden rounded bg-neutral-800">
        {item.poster_url ? (
          <img
            src={item.poster_url}
            alt=""
            loading="lazy"
            className="h-full w-full object-cover"
          />
        ) : null}
      </div>
      <div className="min-w-0 flex-1 space-y-1">
        <p className="truncate text-sm text-neutral-100">
          {item.title}
          <span className="text-xs text-neutral-500">
            {" "}
            {[item.year, t(`shelves.type.${item.type}`)]
              .filter(Boolean)
              .join(" · ")}
          </span>
        </p>
        <div className="flex flex-wrap gap-1">
          {item.in_shelf && <Chip>{t("shelves.alreadyOnShelf")}</Chip>}
          {item.reason.map((part) => (
            <Chip key={part}>{part}</Chip>
          ))}
        </div>
      </div>
      {action}
    </li>
  );
}

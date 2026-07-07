import { useTranslation } from "react-i18next";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import type { LabeledTitleOption } from "@/lib/utils/interactive-search";

interface SearchTitleSelectProps {
  options: LabeledTitleOption[];
  /** Currently active search query (matches one option's `query`) */
  value: string;
  onSelect: (query: string) => void;
  triggerClassName?: string;
}

/**
 * Language picker for the interactive-search title. Lets the user search by the
 * localized title in any available language (EN/FR pinned, original tagged),
 * which matters on private trackers that name releases inconsistently.
 */
export function SearchTitleSelect({
  options,
  value,
  onSelect,
  triggerClassName,
}: SearchTitleSelectProps) {
  const { t } = useTranslation("common");
  const selected = options.find((option) => option.query === value);
  const label = t("medias.interactive.searchTitleLabel", "Search title");

  return (
    <Select value={value} onValueChange={onSelect}>
      <SelectTrigger
        aria-label={label}
        className={cn(
          "h-7 w-auto gap-1 rounded-md border-0 border-l-0 px-2 py-0.5 text-[11px] font-medium bg-neutral-800 text-neutral-200 hover:bg-neutral-700/80",
          triggerClassName,
        )}
      >
        <span className="truncate">{selected?.label ?? label}</span>
      </SelectTrigger>
      <SelectContent className="max-h-72">
        {options.map((option) => (
          <SelectItem key={option.query} value={option.query}>
            <span className="font-medium">{option.label}</span>
            <span className="ml-2 text-xs text-neutral-500">
              {option.query}
            </span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

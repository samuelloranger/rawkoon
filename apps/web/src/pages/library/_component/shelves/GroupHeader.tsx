import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

/** A group's header row; the input follows the server's label, so a failed rename snaps back. */
export function GroupHeader({
  label,
  editable,
  onRename,
}: {
  label: string;
  editable: boolean;
  onRename: (label: string) => void;
}) {
  const { t } = useTranslation("common");
  const [text, setText] = useState(label);
  useEffect(() => setText(label), [label]);

  return (
    <li className="flex items-center gap-2 bg-neutral-900/60 px-3 py-1.5">
      {editable ? (
        <>
          <Input
            value={text}
            maxLength={80}
            aria-label={t("shelves.groupLabel")}
            className="h-8 min-w-0 flex-1 text-xs font-medium"
            onChange={(event) => setText(event.target.value)}
            onBlur={() => {
              if (text.trim() !== label) onRename(text);
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter") event.currentTarget.blur();
            }}
          />
          <Button
            size="sm"
            variant="ghost"
            aria-label={t("shelves.groupRemove", { label })}
            onClick={() => onRename("")}
          >
            <X size={15} />
          </Button>
        </>
      ) : (
        <span className="text-xs font-medium uppercase tracking-wide text-neutral-400">
          {label}
        </span>
      )}
    </li>
  );
}

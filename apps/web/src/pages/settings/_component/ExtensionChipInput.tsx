import { useState } from "react";
import { useTranslation } from "react-i18next";
import { X } from "lucide-react";

const normalize = (raw: string) => {
  const ext = raw.trim().toLowerCase().replace(/^\.+/, "");
  return /^[a-z0-9]{1,10}$/.test(ext) ? ext : null;
};

export function ExtensionChipInput({
  value,
  onChange,
}: {
  value: string[];
  onChange: (next: string[]) => void;
}) {
  const { t } = useTranslation("common");
  const [draft, setDraft] = useState("");
  const [invalid, setInvalid] = useState(false);

  const commit = () => {
    if (draft.trim() === "") return;
    const ext = normalize(draft);
    if (!ext) {
      setInvalid(true);
      return;
    }
    if (!value.includes(ext)) onChange([...value, ext]);
    setDraft("");
    setInvalid(false);
  };

  return (
    <div>
      <div className="focus-within:ring-primary-400 flex flex-wrap gap-1.5 rounded-lg border border-neutral-700 bg-neutral-950 p-2 focus-within:ring-2">
        {value.map((ext) => (
          <span
            key={ext}
            className="inline-flex items-center gap-1 rounded-md border border-neutral-700 bg-neutral-800 py-0.5 pl-2 pr-1 font-mono text-xs"
          >
            .{ext}
            <button
              type="button"
              aria-label={t("settings.downloadSafety.remove", { ext })}
              className="rounded px-0.5 text-neutral-500 hover:text-neutral-100"
              onClick={() => onChange(value.filter((v) => v !== ext))}
            >
              <X size={12} aria-hidden />
            </button>
          </span>
        ))}
        <input
          value={draft}
          aria-label={t("settings.downloadSafety.add")}
          placeholder={t("settings.downloadSafety.add")}
          aria-invalid={invalid}
          className="min-w-32 flex-1 bg-transparent px-1 font-mono text-xs outline-none"
          onChange={(e) => {
            setDraft(e.target.value);
            setInvalid(false);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === ",") {
              e.preventDefault();
              commit();
            } else if (
              e.key === "Backspace" &&
              draft === "" &&
              value.length > 0
            ) {
              onChange(value.slice(0, -1));
            }
          }}
          onBlur={commit}
        />
      </div>
      {invalid && (
        <p className="mt-1 text-xs text-red-400">
          {t("settings.downloadSafety.invalid")}
        </p>
      )}
    </div>
  );
}

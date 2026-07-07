import {
  type ReactNode,
  useState,
  useEffect,
  useRef,
  startTransition,
} from "react";
import { cn } from "@/lib/utils";
import { useTranslation } from "react-i18next";
import { ChevronDown, Check } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";

interface IntegrationSectionCardProps {
  children: ReactNode;
  className?: string;
  description: string;
  enabled: boolean;
  isDirty?: boolean;
  loading: boolean;
  logoUrl?: string;
  onCancel: () => void;
  onEnabledChange: (enabled: boolean) => void;
  onSave: () => void;
  saving: boolean;
  title: string;
}

export function IntegrationSectionCard({
  children,
  className,
  description,
  enabled,
  isDirty,
  loading,
  logoUrl,
  onCancel,
  onEnabledChange,
  onSave,
  saving,
  title,
}: IntegrationSectionCardProps) {
  const { t } = useTranslation("common");
  const isBusy = loading || saving;
  const [isOpen, setIsOpen] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const prevSaving = useRef(false);

  // Detect save completion and briefly show success state
  useEffect(() => {
    const wasSaving = prevSaving.current;
    prevSaving.current = saving;
    if (wasSaving && !saving) {
      startTransition(() => setSaveSuccess(true));
      const timer = setTimeout(() => setSaveSuccess(false), 1500);
      return () => clearTimeout(timer);
    }
    return () => {};
  }, [saving]);

  return (
    <div
      className={cn(
        "bg-neutral-800 rounded-xl border border-neutral-700",
        className,
      )}
    >
      {/* Header — always visible */}
      <div className="flex items-center gap-3 p-6">
        <button
          type="button"
          onClick={() => setIsOpen((o) => !o)}
          className="flex items-center gap-3 flex-1 text-left min-w-0 overflow-hidden"
        >
          {logoUrl && (
            <img
              src={logoUrl}
              alt={title}
              className="w-10 h-10 rounded-xl object-contain flex-shrink-0"
              onError={(e) => {
                e.currentTarget.style.display = "none";
              }}
            />
          )}
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h3 className="text-base font-semibold text-neutral-100">
                {title}
              </h3>
              {isDirty && (
                <span
                  className="w-2 h-2 rounded-full bg-amber-400 flex-shrink-0"
                  title={t("settings.integrations.unsavedChanges")}
                />
              )}
            </div>
            <p className="text-sm text-neutral-400 mt-0.5 truncate">
              {description}
            </p>
          </div>
        </button>

        <div className="flex items-center gap-2 flex-shrink-0">
          {/* Toggle switch */}
          <Switch checked={enabled} onCheckedChange={onEnabledChange} />

          {/* Chevron */}
          <button
            type="button"
            onClick={() => setIsOpen((o) => !o)}
            className="p-1 text-neutral-400 hover:text-neutral-200 rounded-md transition-colors"
          >
            <ChevronDown
              className={cn(
                "w-4 h-4 transition-transform duration-200",
                isOpen && "rotate-180",
              )}
            />
          </button>
        </div>
      </div>

      {/* Expandable content */}
      {isOpen && (
        <div className="border-t border-neutral-700 p-6 pt-4">
          <div className="space-y-4">{children}</div>

          <div className="mt-6 flex items-center gap-3">
            {isDirty && (
              <span className="text-xs text-amber-400 font-medium mr-auto">
                {t("settings.integrations.unsavedChanges")}
              </span>
            )}
            <div className="flex items-center gap-3 ml-auto">
              <Button
                type="button"
                variant="outline"
                onClick={onCancel}
                disabled={isBusy}
              >
                {t("common.cancel")}
              </Button>
              <Button
                type="button"
                onClick={onSave}
                disabled={isBusy}
                className={cn(
                  "gap-2",
                  saveSuccess ? "bg-green-600 hover:bg-green-700" : "",
                )}
              >
                {saveSuccess ? (
                  <>
                    <Check className="w-4 h-4" />
                    {t("common.saved")}
                  </>
                ) : saving ? (
                  t("common.loading")
                ) : (
                  t("settings.integrations.save")
                )}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

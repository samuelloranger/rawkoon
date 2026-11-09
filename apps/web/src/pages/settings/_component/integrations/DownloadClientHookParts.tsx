import { useState } from "react";
import type {
  DownloadClientHookConfig,
  DownloadClientHookStatus,
} from "@rawkoon/shared/types";
import { Check, ChevronDown, Copy } from "lucide-react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { copyToClipboard } from "@/lib/utils/clipboard";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { HOOK_I18N } from "./downloadClientHookI18n";
import { statusClass } from "./hookStatusClass";

export function HookStatusBanner({
  status,
  config,
}: {
  status: DownloadClientHookStatus;
  config: DownloadClientHookConfig | undefined;
}) {
  const { t } = useTranslation("common");
  const isWarning = status === "foreign-program" || status === "stale";

  return (
    <div
      className={cn(
        "rounded-lg border p-3 space-y-3 text-sm",
        statusClass(status),
      )}
    >
      <p>{t(`${HOOK_I18N}.status.${status}`)}</p>
      {status === "foreign-program" && config?.qbittorrentCommand && (
        <CopyableBlock
          label={t(`${HOOK_I18N}.qbittorrentCommand`)}
          value={config.qbittorrentCommand}
          copyLabel={t(`${HOOK_I18N}.copyCommand`)}
          warning={isWarning}
        />
      )}
    </div>
  );
}

export function ScriptCollapse({
  title,
  open,
  onToggle,
  disabled,
  script,
  step1,
  step2,
}: {
  title: string;
  open: boolean;
  onToggle: () => void;
  disabled: boolean;
  script: string;
  step1: string;
  step2: string;
}) {
  const { t } = useTranslation("common");

  return (
    <div
      className={cn(
        "rounded-lg border border-neutral-700 overflow-hidden",
        disabled && "opacity-60",
      )}
    >
      <button
        type="button"
        onClick={onToggle}
        disabled={disabled}
        className="flex w-full items-center justify-between gap-2 px-4 py-3 text-left text-sm font-medium text-neutral-200 hover:bg-neutral-700/40 disabled:cursor-not-allowed"
      >
        <span>{title}</span>
        <ChevronDown
          className={cn(
            "h-4 w-4 text-neutral-400 transition-transform duration-200",
            open && "rotate-180",
          )}
        />
      </button>
      {open && (
        <div className="border-t border-neutral-700 px-4 py-3 space-y-3">
          <ol className="list-decimal list-inside space-y-1 text-xs text-neutral-400">
            <li>{step1}</li>
            <li>{step2}</li>
          </ol>
          <CopyableBlock
            label={t(`${HOOK_I18N}.copyScript`)}
            value={script}
            copyLabel={t(`${HOOK_I18N}.copyScript`)}
          />
        </div>
      )}
    </div>
  );
}

function CopyableBlock({
  label,
  value,
  copyLabel,
  warning,
}: {
  label: string;
  value: string;
  copyLabel: string;
  warning?: boolean;
}) {
  const { t } = useTranslation("common");
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    if (!(await copyToClipboard(value))) {
      toast.error(t("common.copyFailed"));
      return;
    }
    setCopied(true);
    toast.success(t("common.copied"));
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div className="space-y-2">
      <p
        className={cn(
          "text-xs font-medium",
          warning ? "text-amber-200" : "text-neutral-400",
        )}
      >
        {label}
      </p>
      <div className="flex items-start gap-2">
        <pre className="flex-1 max-h-48 overflow-auto whitespace-pre-wrap break-all rounded-md border border-neutral-700 bg-neutral-950 px-3 py-2 font-mono text-xs text-neutral-100">
          {value}
        </pre>
        <Button
          type="button"
          size="sm"
          variant="secondary"
          onClick={() => void handleCopy()}
          className="gap-1.5 shrink-0"
        >
          {copied ? (
            <Check className="w-3.5 h-3.5" />
          ) : (
            <Copy className="w-3.5 h-3.5" />
          )}
          {copied ? t("common.copied") : copyLabel}
        </Button>
      </div>
    </div>
  );
}

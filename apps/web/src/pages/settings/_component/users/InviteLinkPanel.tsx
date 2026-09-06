import { useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Copy, Check } from "lucide-react";
import { Button } from "@/components/ui/button";

interface InviteLinkPanelProps {
  link: string;
  onDismiss: () => void;
}

export function InviteLinkPanel({ link, onDismiss }: InviteLinkPanelProps) {
  const { t } = useTranslation("common");
  const [copied, setCopied] = useState(false);

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    toast.success(t("common.copied"));
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="bg-primary-950/40 border border-primary-800 rounded-xl p-5 animate-in zoom-in-95 duration-200">
      <h3 className="text-sm font-semibold text-primary-200 mb-2 flex items-center gap-2">
        <Check className="w-4 h-4 text-green-400" />
        {t("settings.users.inviteLinkTitle")}
      </h3>
      <p className="text-xs text-neutral-300 mb-4">
        {t("settings.users.inviteLinkHelp")}
      </p>
      <div className="flex gap-2">
        <input
          type="text"
          readOnly
          value={link}
          className="focus-ring flex-1 px-3 py-1.5 border border-neutral-700 rounded-md text-xs text-white bg-neutral-900"
        />
        <Button
          size="sm"
          onClick={() => copyToClipboard(link)}
          className="flex items-center gap-1.5"
        >
          {copied ? (
            <Check className="w-3.5 h-3.5" />
          ) : (
            <Copy className="w-3.5 h-3.5" />
          )}
          {copied ? t("common.copied") : t("common.copy")}
        </Button>
        <Button variant="outline" size="sm" onClick={onDismiss}>
          {t("settings.users.dismissLink")}
        </Button>
      </div>
    </div>
  );
}

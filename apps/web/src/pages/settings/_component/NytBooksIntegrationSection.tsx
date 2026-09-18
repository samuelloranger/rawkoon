import { useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ApiError } from "@/lib/api/client";
import {
  useNytBooksIntegration,
  useTestNytBooksIntegration,
  useUpdateNytBooksIntegration,
} from "@/pages/settings/useNytBooksIntegration";

const LABEL = "mb-1 block text-sm font-medium text-neutral-200";
const HINT = "mt-1 block text-xs text-neutral-500";

function errorMessage(e: unknown, fallback: string): string {
  return e instanceof ApiError ? e.message : fallback;
}

/** NYT Books API key: the credential behind the NYT bestseller Explore source. */
export function NytBooksIntegrationSection() {
  const { t } = useTranslation("common");
  const { data: integration } = useNytBooksIntegration();
  const update = useUpdateNytBooksIntegration();
  const test = useTestNytBooksIntegration();
  const [apiKey, setApiKey] = useState("");
  const hasKey = integration?.integration.has_api_key ?? false;

  const saveKey = async () => {
    try {
      await update.mutateAsync({ api_key: apiKey.trim(), enabled: true });
      setApiKey("");
      toast.success(t("settings.books.nyt.saved"));
    } catch (e) {
      toast.error(errorMessage(e, t("settings.books.nyt.saveFailed")));
    }
  };

  const testKey = async () => {
    try {
      const result = await test.mutateAsync({
        api_key: apiKey.trim() || undefined,
      });
      if (result.success) toast.success(t("settings.books.nyt.testOk"));
      else toast.error(result.error ?? t("settings.books.nyt.testFailed"));
    } catch (e) {
      toast.error(errorMessage(e, t("settings.books.nyt.testFailed")));
    }
  };

  return (
    <>
      <div>
        <label className={LABEL} htmlFor="nyt-key">
          {t("settings.books.nyt.keyLabel")}
        </label>
        <Input
          id="nyt-key"
          type="password"
          autoComplete="off"
          value={apiKey}
          onChange={(e) => setApiKey(e.target.value)}
          placeholder={
            hasKey
              ? t("settings.books.nyt.keyStored")
              : t("settings.books.nyt.keyPlaceholder")
          }
        />
        <p className={HINT}>{t("settings.books.nyt.keyHint")}</p>
      </div>

      <div className="flex flex-wrap gap-2">
        <Button
          onClick={() => void saveKey()}
          disabled={update.isPending || (!apiKey.trim() && !hasKey)}
        >
          {update.isPending && (
            <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
          )}
          {t("settings.books.nyt.save")}
        </Button>
        <Button
          variant="secondary"
          onClick={() => void testKey()}
          disabled={test.isPending || (!apiKey.trim() && !hasKey)}
        >
          {test.isPending && (
            <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
          )}
          {t("settings.books.nyt.test")}
        </Button>
      </div>
    </>
  );
}

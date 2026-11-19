import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { connectionFailureText } from "@/lib/connectionFailureText";
import { useTestIntegration } from "@/pages/settings/useTestIntegration";

/** "Test" for an integration form: checks what is typed now, so no save is needed first. */
export function IntegrationTestButton({
  endpoint,
  website_url,
  api_key,
}: {
  endpoint: string;
  website_url?: string;
  api_key?: string;
}) {
  const { t } = useTranslation("common");
  const test = useTestIntegration(endpoint);

  const run = async () => {
    try {
      const result = await test.mutateAsync({
        website_url: website_url?.trim() || undefined,
        api_key: api_key?.trim() || undefined,
      });
      if (result.success) toast.success(t("settings.integrations.testSuccess"));
      else
        toast.error(
          connectionFailureText(
            t,
            result,
            t("settings.integrations.testError"),
          ),
        );
    } catch (error) {
      toast.error(
        connectionFailureText(t, error, t("settings.integrations.testError")),
      );
    }
  };

  return (
    <Button
      type="button"
      variant="outline"
      onClick={() => void run()}
      disabled={test.isPending}
    >
      {test.isPending
        ? t("settings.integrations.testing")
        : t("settings.integrations.testConnection")}
    </Button>
  );
}

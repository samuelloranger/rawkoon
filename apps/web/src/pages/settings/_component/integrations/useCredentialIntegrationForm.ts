import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

interface CredentialIntegration {
  website_url?: string;
  username?: string;
  enabled?: boolean;
}

interface SaveCredentialIntegrationInput {
  website_url: string;
  username: string;
  password?: string;
  enabled: boolean;
}

interface UseCredentialIntegrationFormParams {
  integration: CredentialIntegration | undefined;
  save: (input: SaveCredentialIntegrationInput) => Promise<unknown>;
}

export function useCredentialIntegrationForm({
  integration,
  save,
}: UseCredentialIntegrationFormParams) {
  const { t } = useTranslation("common");
  const [websiteUrl, setWebsiteUrl] = useState(integration?.website_url || "");
  const [username, setUsername] = useState(integration?.username || "");
  const [password, setPassword] = useState("");
  const [enabled, setEnabled] = useState(Boolean(integration?.enabled));

  const isDirty = useMemo(() => {
    if (!integration) return false;
    return (
      websiteUrl !== (integration.website_url || "") ||
      username !== (integration.username || "") ||
      password !== "" ||
      enabled !== Boolean(integration.enabled)
    );
  }, [enabled, integration, password, username, websiteUrl]);

  const handleCancel = () => {
    setWebsiteUrl(integration?.website_url || "");
    setUsername(integration?.username || "");
    setPassword("");
    setEnabled(Boolean(integration?.enabled));
  };

  const handleSave = () => {
    save({
      website_url: websiteUrl,
      username,
      password: password.trim() ? password : undefined,
      enabled,
    })
      .then(() => {
        setPassword("");
        toast.success(t("settings.integrations.saveSuccess"));
      })
      .catch(() => toast.error(t("settings.integrations.saveError")));
  };

  return {
    websiteUrl,
    setWebsiteUrl,
    username,
    setUsername,
    password,
    setPassword,
    enabled,
    setEnabled,
    isDirty,
    handleCancel,
    handleSave,
  };
}

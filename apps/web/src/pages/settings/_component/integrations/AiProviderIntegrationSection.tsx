import { useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Loader2, CheckCircle2, XCircle, AlertTriangle } from "lucide-react";
import { useAiProviderIntegration } from "@/pages/settings/useAiProviderIntegration";
import { useUpdateAiProviderIntegration } from "@/pages/settings/useUpdateAiProviderIntegration";
import { IntegrationSectionCard } from "@/pages/settings/_component/integrations/IntegrationSectionCard";
import { IntegrationUrlInput } from "@/pages/settings/_component/integrations/IntegrationUrlInput";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { useFetcher } from "@/lib/api/context";
import { INTEGRATION_ENDPOINTS } from "@/lib/endpoints";

export function AiProviderIntegrationSection() {
  const { data, isLoading } = useAiProviderIntegration();
  return (
    <AiProviderIntegrationSectionImpl
      key={data?.integration?.type ?? "pending"}
      data={data}
      isLoading={isLoading}
    />
  );
}

function AiProviderIntegrationSectionImpl({
  data,
  isLoading,
}: {
  data: ReturnType<typeof useAiProviderIntegration>["data"];
  isLoading: boolean;
}) {
  const { t } = useTranslation("common");
  const saveMutation = useUpdateAiProviderIntegration();
  const fetcher = useFetcher();

  const [baseUrl, setBaseUrl] = useState(data?.integration?.base_url ?? "");
  const [model, setModel] = useState(data?.integration?.model ?? "");
  const [apiKey, setApiKey] = useState("");
  const [enabled, setEnabled] = useState(Boolean(data?.integration?.enabled));
  const [testState, setTestState] = useState<
    "idle" | "loading" | "ok" | "model-not-found" | "error"
  >("idle");

  const hasStoredKey = Boolean(data?.integration?.has_api_key);

  const isDirty =
    baseUrl !== (data?.integration?.base_url ?? "") ||
    model !== (data?.integration?.model ?? "") ||
    apiKey !== "" ||
    enabled !== Boolean(data?.integration?.enabled);

  const handleCancel = () => {
    setBaseUrl(data?.integration?.base_url ?? "");
    setModel(data?.integration?.model ?? "");
    setApiKey("");
    setEnabled(Boolean(data?.integration?.enabled));
    setTestState("idle");
  };

  const handleSave = () => {
    saveMutation
      .mutateAsync({ base_url: baseUrl, model, api_key: apiKey, enabled })
      .then(() => {
        setApiKey("");
        toast.success(t("settings.integrations.saveSuccess"));
      })
      .catch(() => toast.error(t("settings.integrations.saveError")));
  };

  const handleTest = async () => {
    setTestState("loading");
    try {
      const result = await fetcher<{
        success: boolean;
        model_available: boolean | null;
      }>(INTEGRATION_ENDPOINTS.AI_PROVIDER_TEST);
      setTestState(result.model_available === false ? "model-not-found" : "ok");
    } catch {
      setTestState("error");
    }
  };

  return (
    <IntegrationSectionCard
      title="AI Provider"
      description="OpenAI-compatible LLM server for AI-assisted release picking — local (llama.cpp, Ollama) or hosted (Groq, Gemini, OpenAI) with an API key."
      enabled={enabled}
      onEnabledChange={setEnabled}
      loading={isLoading}
      saving={saveMutation.isPending}
      isDirty={isDirty}
      onSave={handleSave}
      onCancel={handleCancel}
    >
      <div className="space-y-4">
        <IntegrationUrlInput
          label="Base URL"
          value={baseUrl}
          onChange={setBaseUrl}
          placeholder="http://homelab:11434"
        />
        <div className="space-y-1.5">
          <label
            htmlFor="ai-provider-integration-section-model"
            className="block text-sm font-medium text-neutral-300"
          >
            Model
          </label>
          <Input
            id="ai-provider-integration-section-model"
            value={model}
            onChange={(e) => setModel(e.target.value)}
            placeholder="llama3.2"
          />
        </div>
        <div className="space-y-1.5">
          <label
            htmlFor="ai-provider-integration-section-api-key"
            className="block text-sm font-medium text-neutral-300"
          >
            API key
          </label>
          <Input
            id="ai-provider-integration-section-api-key"
            type="password"
            autoComplete="off"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder={
              hasStoredKey
                ? "Saved — leave blank to keep"
                : "Leave blank for a local server"
            }
          />
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => void handleTest()}
            disabled={!enabled || testState === "loading" || isDirty}
          >
            {testState === "loading" && (
              <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
            )}
            {t("settings.integrations.testConnection")}
          </Button>
          {testState === "ok" && (
            <span className="flex items-center gap-1 text-sm text-green-400">
              <CheckCircle2 className="h-3.5 w-3.5" />
              Connected
            </span>
          )}
          {testState === "model-not-found" && (
            <span className="flex items-center gap-1 text-sm text-yellow-400">
              <AlertTriangle className="h-3.5 w-3.5" />
              Model not found on server
            </span>
          )}
          {testState === "error" && (
            <span className="flex items-center gap-1 text-sm text-red-500">
              <XCircle className="h-3.5 w-3.5" />
              Could not connect
            </span>
          )}
        </div>
      </div>
    </IntegrationSectionCard>
  );
}

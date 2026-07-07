import { useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Loader2, CheckCircle2, XCircle, AlertTriangle } from "lucide-react";
import { useLocalAiIntegration } from "@/pages/settings/useLocalAiIntegration";
import { useUpdateLocalAiIntegration } from "@/pages/settings/useUpdateLocalAiIntegration";
import { IntegrationSectionCard } from "@/pages/settings/_component/integrations/IntegrationSectionCard";
import { IntegrationUrlInput } from "@/pages/settings/_component/integrations/IntegrationUrlInput";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { useFetcher } from "@/lib/api/context";
import { INTEGRATION_ENDPOINTS } from "@/lib/endpoints";

export function LocalAiIntegrationSection() {
  const { data, isLoading } = useLocalAiIntegration();
  return (
    <LocalAiIntegrationSectionImpl
      key={data?.integration?.type ?? "pending"}
      data={data}
      isLoading={isLoading}
    />
  );
}

function LocalAiIntegrationSectionImpl({
  data,
  isLoading,
}: {
  data: ReturnType<typeof useLocalAiIntegration>["data"];
  isLoading: boolean;
}) {
  const { t } = useTranslation("common");
  const saveMutation = useUpdateLocalAiIntegration();
  const fetcher = useFetcher();

  const [baseUrl, setBaseUrl] = useState(data?.integration?.base_url ?? "");
  const [model, setModel] = useState(data?.integration?.model ?? "");
  const [enabled, setEnabled] = useState(Boolean(data?.integration?.enabled));
  const [testState, setTestState] = useState<
    "idle" | "loading" | "ok" | "model-not-found" | "error"
  >("idle");

  const isDirty =
    baseUrl !== (data?.integration?.base_url ?? "") ||
    model !== (data?.integration?.model ?? "") ||
    enabled !== Boolean(data?.integration?.enabled);

  const handleCancel = () => {
    setBaseUrl(data?.integration?.base_url ?? "");
    setModel(data?.integration?.model ?? "");
    setEnabled(Boolean(data?.integration?.enabled));
    setTestState("idle");
  };

  const handleSave = () => {
    saveMutation
      .mutateAsync({ base_url: baseUrl, model, enabled })
      .then(() => toast.success(t("settings.integrations.saveSuccess")))
      .catch(() => toast.error(t("settings.integrations.saveError")));
  };

  const handleTest = async () => {
    setTestState("loading");
    try {
      const result = await fetcher<{
        success: boolean;
        model_available: boolean | null;
      }>(INTEGRATION_ENDPOINTS.LOCAL_AI_TEST);
      setTestState(result.model_available === false ? "model-not-found" : "ok");
    } catch {
      setTestState("error");
    }
  };

  return (
    <IntegrationSectionCard
      title="Local AI"
      description="OpenAI-compatible local LLM server (e.g. llama.cpp, Ollama) for AI-assisted release picking."
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
          <label className="block text-sm font-medium text-neutral-300">
            Model
          </label>
          <Input
            value={model}
            onChange={(e) => setModel(e.target.value)}
            placeholder="llama3.2"
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

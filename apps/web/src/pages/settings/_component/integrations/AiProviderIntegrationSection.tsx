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
import { Switch } from "@/components/ui/switch";
import {
  AI_FEATURES,
  type AiFeature,
  type AiFeatureToggles,
} from "@rawkoon/shared/types";
import { useFetcher } from "@/lib/api/context";
import { INTEGRATION_ENDPOINTS } from "@/lib/endpoints";

const isFeatureOn = (toggles: AiFeatureToggles, feature: AiFeature) =>
  toggles[feature] !== false;

const priceToText = (value: number | null | undefined) =>
  value == null ? "" : String(value);

const textToPrice = (text: string): number | null => {
  const n = Number.parseFloat(text);
  return text.trim() !== "" && Number.isFinite(n) && n >= 0 ? n : null;
};

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
  const [inputPrice, setInputPrice] = useState(
    priceToText(data?.integration?.input_price_per_million),
  );
  const [outputPrice, setOutputPrice] = useState(
    priceToText(data?.integration?.output_price_per_million),
  );
  const [budget, setBudget] = useState(
    priceToText(data?.integration?.daily_budget_usd),
  );
  const [features, setFeatures] = useState<AiFeatureToggles>(
    data?.integration?.features ?? {},
  );
  const [enabled, setEnabled] = useState(Boolean(data?.integration?.enabled));
  const [testState, setTestState] = useState<
    "idle" | "loading" | "ok" | "model-not-found" | "error"
  >("idle");

  const hasStoredKey = Boolean(data?.integration?.has_api_key);

  const isDirty =
    baseUrl !== (data?.integration?.base_url ?? "") ||
    model !== (data?.integration?.model ?? "") ||
    apiKey !== "" ||
    inputPrice !== priceToText(data?.integration?.input_price_per_million) ||
    outputPrice !== priceToText(data?.integration?.output_price_per_million) ||
    budget !== priceToText(data?.integration?.daily_budget_usd) ||
    AI_FEATURES.some(
      (f) =>
        isFeatureOn(features, f) !==
        isFeatureOn(data?.integration?.features ?? {}, f),
    ) ||
    enabled !== Boolean(data?.integration?.enabled);

  const budgetWithoutPrices =
    textToPrice(budget) !== null &&
    textToPrice(inputPrice) === null &&
    textToPrice(outputPrice) === null;

  const handleCancel = () => {
    setBaseUrl(data?.integration?.base_url ?? "");
    setModel(data?.integration?.model ?? "");
    setApiKey("");
    setInputPrice(priceToText(data?.integration?.input_price_per_million));
    setOutputPrice(priceToText(data?.integration?.output_price_per_million));
    setBudget(priceToText(data?.integration?.daily_budget_usd));
    setFeatures(data?.integration?.features ?? {});
    setEnabled(Boolean(data?.integration?.enabled));
    setTestState("idle");
  };

  const handleSave = () => {
    saveMutation
      .mutateAsync({
        base_url: baseUrl,
        model,
        api_key: apiKey,
        enabled,
        input_price_per_million: textToPrice(inputPrice),
        output_price_per_million: textToPrice(outputPrice),
        daily_budget_usd: textToPrice(budget),
        features,
      })
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
        <div className="grid gap-4 sm:grid-cols-2">
          <PriceInput
            id="ai-provider-integration-section-input-price"
            label={t("settings.ai.inputPrice")}
            value={inputPrice}
            onChange={setInputPrice}
          />
          <PriceInput
            id="ai-provider-integration-section-output-price"
            label={t("settings.ai.outputPrice")}
            value={outputPrice}
            onChange={setOutputPrice}
          />
          <p className="text-xs text-neutral-500 sm:col-span-2">
            {t("settings.ai.priceHelp")}
          </p>
        </div>
        <div className="space-y-1.5">
          <PriceInput
            id="ai-provider-integration-section-budget"
            label={t("settings.ai.budget.label")}
            value={budget}
            onChange={setBudget}
            placeholder={t("settings.ai.budget.placeholder")}
          />
          <p className="text-xs text-neutral-500">
            {t("settings.ai.budget.help")}
          </p>
          {budgetWithoutPrices && (
            <p className="flex items-center gap-1 text-xs text-yellow-400">
              <AlertTriangle className="h-3.5 w-3.5" />
              {t("settings.ai.budget.needsPrices")}
            </p>
          )}
        </div>
        <fieldset className="space-y-2">
          <legend className="text-sm font-medium text-neutral-300">
            {t("settings.ai.featureToggles.title")}
          </legend>
          <p className="text-xs text-neutral-500">
            {t("settings.ai.featureToggles.help")}
          </p>
          {AI_FEATURES.map((feature) => {
            const label = t(`settings.ai.featureToggles.${feature}`);
            return (
              <div key={feature} className="flex items-center justify-between">
                <span className="text-sm text-neutral-200">{label}</span>
                <Switch
                  aria-label={label}
                  checked={isFeatureOn(features, feature)}
                  onCheckedChange={(on) =>
                    setFeatures((prev) => ({ ...prev, [feature]: on }))
                  }
                />
              </div>
            );
          })}
        </fieldset>
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

function PriceInput({
  id,
  label,
  value,
  onChange,
  placeholder = "0.00",
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
}) {
  return (
    <div className="space-y-1.5">
      <label
        htmlFor={id}
        className="block text-sm font-medium text-neutral-300"
      >
        {label}
      </label>
      <Input
        id={id}
        type="number"
        min={0}
        step="any"
        inputMode="decimal"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
      />
    </div>
  );
}

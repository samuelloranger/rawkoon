import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  useAudnexusIntegration,
  useTestAudnexusIntegration,
  useUpdateAudnexusIntegration,
} from "@/pages/settings/useAudnexusIntegration";
import { ApiError } from "@/lib/api/client";

/**
 * Audnexus, the source of narrators, series and genres.
 *
 * No API key: the public instance is keyless. The base URL is editable so a
 * self-hosted instance can be used instead — worth knowing that the project
 * publishes no prebuilt image, so self-hosting means building from source.
 */

const LABEL = "block text-sm font-medium text-neutral-300 mb-1.5";
const HINT = "mt-1.5 text-xs text-neutral-500";

/** Regions Audnexus accepts. The region decides which catalogue is searched. */
const REGIONS = [
  { value: "us", label: "United States (.com)" },
  { value: "ca", label: "Canada (.ca)" },
  { value: "uk", label: "United Kingdom (.co.uk)" },
  { value: "fr", label: "France (.fr)" },
  { value: "de", label: "Germany (.de)" },
  { value: "es", label: "Spain (.es)" },
  { value: "it", label: "Italy (.it)" },
  { value: "au", label: "Australia (.com.au)" },
  { value: "br", label: "Brazil (.com.br)" },
  { value: "in", label: "India (.in)" },
  { value: "jp", label: "Japan (.co.jp)" },
];

export function AudnexusIntegrationSection() {
  const { t } = useTranslation("common");
  const { data } = useAudnexusIntegration();
  const update = useUpdateAudnexusIntegration();
  const test = useTestAudnexusIntegration();

  const [baseUrl, setBaseUrl] = useState("");
  const [region, setRegion] = useState("us");
  const [enabled, setEnabled] = useState(false);

  useEffect(() => {
    const i = data?.integration;
    if (!i) return;
    setBaseUrl(i.base_url);
    setRegion(i.region);
    setEnabled(i.enabled);
  }, [data?.integration]);

  const save = async () => {
    try {
      await update.mutateAsync({ base_url: baseUrl.trim(), region, enabled });
      toast.success(t("settings.books.audnexus.saved"));
    } catch (e) {
      toast.error(
        e instanceof ApiError
          ? e.message
          : t("settings.books.audnexus.saveFailed"),
      );
    }
  };

  const runTest = async () => {
    try {
      const res = await test.mutateAsync({ base_url: baseUrl.trim(), region });
      if (res.success) toast.success(t("settings.books.audnexus.reachable"));
      else toast.error(res.error ?? t("settings.books.audnexus.notReachable"));
    } catch (e) {
      toast.error(
        e instanceof ApiError
          ? e.message
          : t("settings.books.audnexus.testFailed"),
      );
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-4">
        <div>
          <p className="text-sm text-neutral-200">Enabled</p>
          <p className="text-xs text-neutral-500">
            Supplies narrators, series, genres, publisher, ratings and cover
            art.
          </p>
        </div>
        <Switch
          checked={enabled}
          onCheckedChange={setEnabled}
          aria-label={t("settings.books.audnexus.enable")}
        />
      </div>

      <div>
        <label className={LABEL} htmlFor="audnexus-region">
          Region
        </label>
        <Select value={region} onValueChange={setRegion}>
          <SelectTrigger id="audnexus-region">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {REGIONS.map((r) => (
              <SelectItem key={r.value} value={r.value}>
                {r.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <p className={HINT}>
          Which catalogue to search. Pick the one your editions were published
          in — a French audiobook is only listed in the French catalogue.
        </p>
      </div>

      <div>
        <label className={LABEL} htmlFor="audnexus-base-url">
          Server URL
        </label>
        <Input
          id="audnexus-base-url"
          value={baseUrl}
          placeholder={t("settings.books.audnexus.baseUrlPlaceholder")}
          onChange={(e) => setBaseUrl(e.target.value)}
        />
        <p className={HINT}>
          The public instance needs no account and is rate-limited to 300
          requests a minute. Point this at your own build to avoid depending on
          it.
        </p>
      </div>

      <div className="flex flex-wrap gap-2">
        <Button type="button" onClick={save} disabled={update.isPending}>
          {update.isPending && (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          )}
          Save
        </Button>
        <Button
          type="button"
          variant="outline"
          onClick={runTest}
          disabled={test.isPending}
        >
          {test.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          Test connection
        </Button>
      </div>
    </div>
  );
}

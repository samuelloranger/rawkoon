import { useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { BookOpen, ExternalLink, Loader2 } from "lucide-react";
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
  useAppSettings,
  useUpdateAppSettings,
} from "@/pages/settings/useAppSettings";
import {
  useGoogleBooksIntegration,
  useTestGoogleBooksIntegration,
  useUpdateGoogleBooksIntegration,
} from "@/pages/settings/useGoogleBooksIntegration";
import { useMediaPostProcessingSettings } from "@/features/medias/hooks/useMediaPostProcessingSettings";
import { useUpdateMediaPostProcessingSettings } from "@/features/medias/hooks/useUpdateMediaPostProcessingSettings";
import { useBookQualityProfiles } from "@/pages/books/_hooks/useBooks";
import { SettingsPageHeader } from "@/pages/settings/_component/SettingsPageHeader";
import { BookQualityProfilesSection } from "@/pages/settings/_component/BookQualityProfilesSection";
import { AudnexusIntegrationSection } from "@/pages/settings/_component/AudnexusIntegrationSection";
import { BookMetadataSourcesSection } from "@/pages/settings/_component/BookMetadataSourcesSection";
import { ApiError } from "@/lib/api/client";

/** Radix Select has no empty value, so "no default" needs a sentinel. */
const NO_PROFILE = "none";

const LABEL = "block text-sm font-medium text-neutral-300 mb-1.5";
const HINT = "mt-1.5 text-xs text-neutral-500";

function CardSection({
  title,
  description,
  children,
  actions,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
  actions?: React.ReactNode;
}) {
  return (
    <div className="overflow-hidden rounded-xl border border-neutral-700 bg-neutral-800">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-neutral-700/60 px-6 py-4">
        <div>
          <h2 className="text-sm font-semibold text-neutral-100">{title}</h2>
          {description && (
            <p className="mt-0.5 text-xs text-neutral-400">{description}</p>
          )}
        </div>
        {actions}
      </div>
      <div className="space-y-4 p-6">{children}</div>
    </div>
  );
}

const errorMessage = (e: unknown, fallback: string): string =>
  e instanceof ApiError ? e.message : fallback;

/**
 * Books settings.
 *
 * Everything here was previously only reachable through the configureBooks
 * maintenance script. The API key in particular could not be set with SQL: it
 * is encrypted with the instance secret, and a plaintext value is treated as
 * unconfigured — so a settings screen is the difference between the feature
 * being usable and needing shell access.
 */
export function BooksSettingsTab() {
  const { t } = useTranslation("common");

  const { data: appSettings } = useAppSettings();
  const updateApp = useUpdateAppSettings();

  const { data: integration } = useGoogleBooksIntegration();
  const updateIntegration = useUpdateGoogleBooksIntegration();
  const testIntegration = useTestGoogleBooksIntegration();

  const { data: mediaSettings } = useMediaPostProcessingSettings();
  const updatePaths = useUpdateMediaPostProcessingSettings();

  const { data: profilesData } = useBookQualityProfiles();
  const profiles = profilesData?.profiles ?? [];

  const booksEnabled = appSettings?.settings.books_enabled ?? false;
  const hasKey = integration?.integration.has_api_key ?? false;
  const settings = mediaSettings?.settings;

  const [apiKey, setApiKey] = useState("");
  const [booksPath, setBooksPath] = useState("");
  const [audiobooksPath, setAudiobooksPath] = useState("");
  const [bookTemplate, setBookTemplate] = useState("");
  const [audiobookTemplate, setAudiobookTemplate] = useState("");
  const [defaultProfile, setDefaultProfile] = useState(NO_PROFILE);

  // Seed the file fields from the server value, re-seeding only when the server
  // value itself changes, so typing is never clobbered by a refetch. Adjusted
  // during render rather than in an effect: an effect here would fire after a
  // paint with the stale values, and its dependency list cannot express "only
  // this one field of the response".
  const [seededAt, setSeededAt] = useState<string | null>(null);
  if (settings && seededAt !== settings.updated_at) {
    setSeededAt(settings.updated_at);
    setBooksPath(settings.books_library_path ?? "");
    setAudiobooksPath(settings.audiobooks_library_path ?? "");
    setBookTemplate(settings.book_template);
    setAudiobookTemplate(settings.audiobook_template);
    setDefaultProfile(
      settings.default_book_quality_profile_id != null
        ? String(settings.default_book_quality_profile_id)
        : NO_PROFILE,
    );
  }

  const canEnable = hasKey || booksEnabled;

  const saveKey = async () => {
    try {
      await updateIntegration.mutateAsync({
        api_key: apiKey.trim(),
        enabled: true,
      });
      setApiKey("");
      toast.success(t("settings.books.provider.saved"));
    } catch (e) {
      toast.error(errorMessage(e, t("settings.books.provider.saveFailed")));
    }
  };

  const testKey = async () => {
    try {
      const result = await testIntegration.mutateAsync({
        api_key: apiKey.trim() || undefined,
      });
      if (result.success) toast.success(t("settings.books.provider.testOk"));
      else toast.error(result.error ?? t("settings.books.provider.testFailed"));
    } catch (e) {
      toast.error(errorMessage(e, t("settings.books.provider.testFailed")));
    }
  };

  const savePaths = async () => {
    try {
      await updatePaths.mutateAsync({
        books_library_path: booksPath.trim() || null,
        audiobooks_library_path: audiobooksPath.trim() || null,
        book_template: bookTemplate.trim(),
        audiobook_template: audiobookTemplate.trim(),
        default_book_quality_profile_id:
          defaultProfile === NO_PROFILE ? null : Number(defaultProfile),
      });
      toast.success(t("settings.books.files.saved"));
    } catch (e) {
      toast.error(errorMessage(e, t("settings.books.files.saveFailed")));
    }
  };

  const toggleBooks = async (enabled: boolean) => {
    try {
      await updateApp.mutateAsync({ books_enabled: enabled });
      toast.success(
        enabled
          ? t("settings.books.general.enabled")
          : t("settings.books.general.disabled"),
      );
    } catch (e) {
      toast.error(errorMessage(e, t("settings.books.general.saveFailed")));
    }
  };

  return (
    <div className="space-y-6">
      <SettingsPageHeader
        icon={BookOpen}
        title={t("settings.books.title")}
        description={t("settings.books.description")}
      />

      <CardSection
        title={t("settings.books.general.title")}
        description={t("settings.books.general.description")}
      >
        <label className="flex items-start justify-between gap-6">
          <span>
            <span className="block text-sm font-medium text-neutral-200">
              {t("settings.books.general.toggleLabel")}
            </span>
            <span className={HINT}>
              {t("settings.books.general.toggleHint")}
            </span>
          </span>
          <Switch
            checked={booksEnabled}
            disabled={updateApp.isPending || !canEnable}
            onCheckedChange={(checked) => void toggleBooks(checked)}
          />
        </label>

        {/* Enabling without a key would put a Books section in the navigation
            that fails on its first search. Say why the switch is inert. */}
        {!canEnable && (
          <p className="rounded-lg bg-amber-500/10 px-3 py-2 text-xs text-amber-300">
            {t("settings.books.general.needsKey")}
          </p>
        )}

        {booksEnabled && (!booksPath || !audiobooksPath) && (
          <p className="rounded-lg bg-amber-500/10 px-3 py-2 text-xs text-amber-300">
            {t("settings.books.general.needsPaths")}
          </p>
        )}
      </CardSection>

      <CardSection
        title={t("settings.books.provider.title")}
        description={t("settings.books.provider.description")}
        actions={
          <a
            href="https://console.cloud.google.com/apis/library/books.googleapis.com"
            target="_blank"
            rel="noreferrer noopener"
            className="focus-ring inline-flex items-center gap-1 rounded text-xs text-primary-300 hover:text-primary-200"
          >
            {t("settings.books.provider.getKey")}
            <ExternalLink className="h-3 w-3" />
          </a>
        }
      >
        <div>
          <label className={LABEL} htmlFor="googlebooks-key">
            {t("settings.books.provider.keyLabel")}
          </label>
          <Input
            id="googlebooks-key"
            type="password"
            autoComplete="off"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder={
              hasKey
                ? t("settings.books.provider.keyStored")
                : t("settings.books.provider.keyPlaceholder")
            }
          />
          <p className={HINT}>{t("settings.books.provider.keyHint")}</p>
        </div>

        <div className="flex flex-wrap gap-2">
          <Button
            onClick={() => void saveKey()}
            disabled={
              updateIntegration.isPending || (!apiKey.trim() && !hasKey)
            }
          >
            {updateIntegration.isPending && (
              <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
            )}
            {t("settings.books.provider.save")}
          </Button>
          <Button
            variant="secondary"
            onClick={() => void testKey()}
            disabled={testIntegration.isPending || (!apiKey.trim() && !hasKey)}
          >
            {testIntegration.isPending && (
              <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
            )}
            {t("settings.books.provider.test")}
          </Button>
        </div>
      </CardSection>

      <CardSection
        title={t("settings.books.audnexus.title")}
        description={t("settings.books.audnexus.description")}
        actions={
          <a
            href="https://github.com/laxamentumtech/audnexus"
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 text-xs text-neutral-400 hover:text-neutral-200"
          >
            {t("settings.books.audnexus.docs")}
            <ExternalLink className="h-3 w-3" />
          </a>
        }
      >
        <AudnexusIntegrationSection />
      </CardSection>

      <CardSection
        title={t("settings.books.metadataSources.title")}
        description={t("settings.books.metadataSources.description")}
      >
        <BookMetadataSourcesSection />
      </CardSection>

      <CardSection
        title={t("settings.books.files.title")}
        description={t("settings.books.files.description")}
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className={LABEL} htmlFor="books-path">
              {t("settings.books.files.booksPath")}
            </label>
            <Input
              id="books-path"
              value={booksPath}
              onChange={(e) => setBooksPath(e.target.value)}
              placeholder="/mnt/storage/Books"
            />
          </div>
          <div>
            <label className={LABEL} htmlFor="audiobooks-path">
              {t("settings.books.files.audiobooksPath")}
            </label>
            <Input
              id="audiobooks-path"
              value={audiobooksPath}
              onChange={(e) => setAudiobooksPath(e.target.value)}
              placeholder="/mnt/storage/Audiobooks"
            />
          </div>
        </div>
        <p className={HINT}>{t("settings.books.files.pathHint")}</p>

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className={LABEL} htmlFor="book-template">
              {t("settings.books.files.bookTemplate")}
            </label>
            {/* A template is a machine string, so it is set in the mono face —
                the same rule the books pages follow for paths and formats. */}
            <Input
              id="book-template"
              className="font-mono text-xs"
              value={bookTemplate}
              onChange={(e) => setBookTemplate(e.target.value)}
            />
          </div>
          <div>
            <label className={LABEL} htmlFor="audiobook-template">
              {t("settings.books.files.audiobookTemplate")}
            </label>
            <Input
              id="audiobook-template"
              className="font-mono text-xs"
              value={audiobookTemplate}
              onChange={(e) => setAudiobookTemplate(e.target.value)}
            />
          </div>
        </div>
        <p className={HINT}>{t("settings.books.files.templateHint")}</p>

        <div className="max-w-xs">
          <label className={LABEL}>
            {t("settings.books.files.defaultProfile")}
          </label>
          <Select value={defaultProfile} onValueChange={setDefaultProfile}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={NO_PROFILE}>
                {t("settings.books.files.noDefaultProfile")}
              </SelectItem>
              {profiles.map((p) => (
                <SelectItem key={p.id} value={String(p.id)}>
                  {p.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className={HINT}>{t("settings.books.files.defaultProfileHint")}</p>
        </div>

        <Button
          onClick={() => void savePaths()}
          disabled={updatePaths.isPending}
        >
          {updatePaths.isPending && (
            <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
          )}
          {t("settings.books.files.save")}
        </Button>
      </CardSection>

      <BookQualityProfilesSection />
    </div>
  );
}

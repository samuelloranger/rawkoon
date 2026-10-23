import { useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { HttpError } from "@/lib/api/httpClient";
import { useSSOProviders } from "@/lib/auth/useAuth";
import {
  useJellyfinProfile,
  useLinkJellyfin,
  useUnlinkJellyfin,
} from "@/lib/auth/useJellyfinSignIn";
import { JellyfinSignInForm } from "@/pages/login/_component/JellyfinSignInForm";

/** Link or unlink the signed-in user's own Jellyfin account. */
export function JellyfinLinkSection() {
  const { t } = useTranslation("common");
  const { data: providers } = useSSOProviders();
  const available = providers?.jellyfin_sign_in === true;
  const { data: profile } = useJellyfinProfile(available);
  const linkMutation = useLinkJellyfin();
  const unlinkMutation = useUnlinkJellyfin();
  const [linking, setLinking] = useState(false);

  if (!available) return null;

  const handleUnlink = async () => {
    try {
      await unlinkMutation.mutateAsync();
      toast.success(t("settings.jellyfinLink.unlinkSuccess"));
    } catch (error: unknown) {
      toast.error(
        (error instanceof HttpError ? error.apiError() : undefined) ||
          t("settings.jellyfinLink.unlinkError"),
      );
    }
  };

  return (
    <div className="bg-neutral-800 rounded-xl border border-neutral-700 p-6">
      <h2 className="text-base font-semibold mb-1.5 text-neutral-100">
        {t("settings.jellyfinLink.title")}
      </h2>
      <p className="text-neutral-400 mb-4 text-sm">
        {t("settings.jellyfinLink.description")}
      </p>

      {linking ? (
        <JellyfinSignInForm
          submitLabel={t("settings.jellyfinLink.link")}
          pending={linkMutation.isPending}
          onBack={() => setLinking(false)}
          onSubmit={async (credentials) => {
            await linkMutation.mutateAsync(credentials);
            setLinking(false);
            toast.success(t("settings.jellyfinLink.linkSuccess"));
          }}
        />
      ) : profile?.linked ? (
        <div className="flex items-center justify-between gap-4">
          <p className="text-sm text-neutral-200">
            {profile.jellyfin_name
              ? t("settings.jellyfinLink.linkedAs", {
                  name: profile.jellyfin_name,
                })
              : t("settings.jellyfinLink.linked")}
          </p>
          {profile.can_unlink && (
            <Button
              variant="outline"
              size="sm"
              onClick={handleUnlink}
              disabled={unlinkMutation.isPending}
            >
              {t("settings.jellyfinLink.unlink")}
            </Button>
          )}
        </div>
      ) : (
        <div className="flex items-center justify-between gap-4">
          <p className="text-sm text-neutral-400">
            {t("settings.jellyfinLink.notLinked")}
          </p>
          <Button size="sm" onClick={() => setLinking(true)}>
            {t("settings.jellyfinLink.link")}
          </Button>
        </div>
      )}
    </div>
  );
}

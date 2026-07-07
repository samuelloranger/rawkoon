import { useTranslation } from "react-i18next";
import { UserRound, Monitor } from "lucide-react";
import { PasskeysSection } from "@/pages/settings/_component/PasskeysSection";
import { ProfileForm } from "@/pages/settings/_component/ProfileForm";
import { SettingsPageHeader } from "@/pages/settings/_component/SettingsPageHeader";
import { NavPositionPicker } from "@/components/NavPositionPicker";
import { useNavPosition } from "@/pages/settings/useNavPosition";

export function ProfileTab() {
  const { t } = useTranslation("common");
  const { position, setPosition } = useNavPosition();

  return (
    <div
      className="animate-in fade-in slide-in-from-right-4 duration-300 space-y-6"
      key="profile-tab"
    >
      <SettingsPageHeader
        icon={UserRound}
        title={t("settings.profile.title")}
        description={t("settings.profile.description")}
      />
      <div className="bg-neutral-800 rounded-xl border border-neutral-700 p-6">
        <ProfileForm />
      </div>
      <div className="bg-neutral-800 rounded-xl border border-neutral-700 p-6">
        <div className="flex items-center gap-2 mb-4">
          <Monitor size={16} className="text-neutral-500" />
          <h3 className="text-sm font-semibold text-neutral-100">Navigation</h3>
        </div>
        <p className="text-sm text-neutral-400 mb-4">
          Choose where the navigation rail appears on desktop.
        </p>
        <NavPositionPicker value={position} onChange={setPosition} />
      </div>
      <PasskeysSection />
    </div>
  );
}

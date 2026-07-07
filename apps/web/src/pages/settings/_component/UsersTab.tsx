import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Users } from "lucide-react";
import { SettingsPageHeader } from "@/pages/settings/_component/SettingsPageHeader";
import { InviteLinkPanel } from "@/pages/settings/_component/users/InviteLinkPanel";
import { UsersListSection } from "@/pages/settings/_component/users/UsersListSection";
import { PendingInvitationsSection } from "@/pages/settings/_component/users/PendingInvitationsSection";
import { UserProvisioningSection } from "@/pages/settings/_component/users/UserProvisioningSection";

export function UsersTab() {
  const { t } = useTranslation("common");
  const [generatedLink, setGeneratedLink] = useState<string | null>(null);

  return (
    <div
      className="animate-in fade-in slide-in-from-right-4 duration-300"
      key="users-tab"
    >
      <div className="space-y-6">
        <SettingsPageHeader
          icon={Users}
          title={t("settings.users.title")}
          description="Manage application users, roles, password resets, and link-based invites."
        />

        {generatedLink && (
          <InviteLinkPanel
            link={generatedLink}
            onDismiss={() => setGeneratedLink(null)}
          />
        )}

        <UsersListSection />

        <PendingInvitationsSection onLinkGenerated={setGeneratedLink} />

        <UserProvisioningSection onLinkGenerated={setGeneratedLink} />
      </div>
    </div>
  );
}

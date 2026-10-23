import { CalendarSubscriptionSection } from "@/pages/settings/_component/CalendarSubscriptionSection";
import { JellyfinLinkSection } from "@/pages/settings/_component/JellyfinLinkSection";
import { PasskeysSection } from "@/pages/settings/_component/PasskeysSection";
import { ProfileForm } from "@/pages/settings/_component/ProfileForm";
import { SettingsPageShell } from "@/pages/settings/_component/SettingsPageShell";

export function SecurityPage() {
  return (
    <SettingsPageShell id="security">
      <div className="rounded-xl border border-neutral-700 bg-neutral-800 p-6">
        <ProfileForm part="password" />
      </div>
      <PasskeysSection />
      <JellyfinLinkSection />
      <CalendarSubscriptionSection />
    </SettingsPageShell>
  );
}

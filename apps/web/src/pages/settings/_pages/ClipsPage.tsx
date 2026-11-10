import { SettingsPageShell } from "@/pages/settings/_component/SettingsPageShell";
import { ClipsTab } from "@/pages/settings/_component/ClipsTab";

export function ClipsPage() {
  return (
    <SettingsPageShell id="clips">
      <ClipsTab />
    </SettingsPageShell>
  );
}

import { createFileRoute } from "@tanstack/react-router";
import { settingsGuard } from "@/pages/settings/_lib/settingsGuard";
import { ClipsPage } from "@/pages/settings/_pages/ClipsPage";

export const Route = createFileRoute("/settings/clips/")({
  beforeLoad: settingsGuard({ adminOnly: true }),
  component: ClipsPage,
});

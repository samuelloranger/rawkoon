import { useState } from "react";
import { Outlet, useRouterState } from "@tanstack/react-router";
import { ChevronDown } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Dialog } from "@/components/dialog";
import { useGrabReadiness } from "@/features/medias/hooks/useGrabReadiness";
import { failingChecks } from "@/features/medias/lib/grabReadiness";
import { useCurrentUser } from "@/lib/auth/useAuth";
import { SETTINGS_PAGES } from "@/pages/settings/_lib/settingsPages";
import { SettingsIndex } from "./SettingsIndex";

/** Settings shell: a grouped rail on desktop, a searchable index sheet on phones. */
export function SettingsLayout() {
  const { t } = useTranslation("common");
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const isAdmin = useCurrentUser().data?.is_admin === true;
  // Same cached query the Health page uses; no extra polling, just a longer stale window.
  const readiness = useGrabReadiness({ enabled: isAdmin, staleTime: 60_000 });
  const healthAttention =
    isAdmin && failingChecks(readiness.data?.checks).length > 0;
  const [indexOpen, setIndexOpen] = useState(false);
  const current = SETTINGS_PAGES.find(
    (p) => pathname === p.path || pathname.startsWith(`${p.path}/`),
  );

  return (
    <div className="flex flex-1 flex-col bg-neutral-900 md:flex-row">
      <div className="border-b border-neutral-800 bg-neutral-900 px-4 py-3 md:hidden">
        <button
          type="button"
          onClick={() => setIndexOpen(true)}
          aria-haspopup="dialog"
          className="focus-ring flex w-full items-center justify-between rounded-lg border border-neutral-700 bg-neutral-800 px-3 py-2 text-sm font-medium text-neutral-100"
        >
          <span className="truncate">
            {current ? t(current.titleKey) : t("settings.title")}
          </span>
          <ChevronDown size={16} className="shrink-0 text-neutral-400" />
        </button>
      </div>
      <Dialog
        isOpen={indexOpen}
        onClose={() => setIndexOpen(false)}
        title={t("settings.title")}
        panelClassName="max-w-md p-4 text-left"
      >
        <SettingsIndex
          isAdmin={isAdmin}
          healthAttention={healthAttention}
          currentPath={pathname}
          searchable
          autoFocusSearch
          onNavigate={() => setIndexOpen(false)}
        />
      </Dialog>

      <aside className="relative hidden w-64 flex-shrink-0 border-r border-neutral-800 bg-neutral-900 md:block">
        <div className="overflow-y-auto">
          <div className="border-b border-neutral-800 px-6 py-5">
            <h1 className="text-lg font-semibold text-neutral-100">
              {t("settings.title")}
            </h1>
          </div>
          <nav className="p-3" aria-label={t("settings.title")}>
            <SettingsIndex
              isAdmin={isAdmin}
              currentPath={pathname}
              healthAttention={healthAttention}
            />
          </nav>
        </div>
      </aside>

      <div className="min-w-0 flex-1 overflow-x-hidden p-4 md:p-8">
        <div className="mx-auto max-w-4xl">
          <Outlet />
        </div>
      </div>
    </div>
  );
}

import { useTranslation } from "react-i18next";
import { useNavigate, useSearch } from "@tanstack/react-router";
import { ProfileTab } from "@/pages/settings/_component/ProfileTab";
import { NotificationsTab } from "@/pages/settings/_component/NotificationsTab";
import { IntegrationsTab } from "@/pages/settings/_component/IntegrationsTab";
import { DataExportTab } from "@/pages/settings/_component/DataExportTab";
import { UsersTab } from "@/pages/settings/_component/UsersTab";
import { JobsTab } from "@/pages/settings/_component/JobsTab";
import { MediaSettingsTab } from "@/pages/settings/_component/MediaSettingsTab";
import { GeneralSettingsTab } from "@/pages/settings/_component/GeneralSettingsTab";
import { ReleasesTab } from "@/pages/settings/_component/ReleasesTab";
import { SessionsTab } from "@/pages/settings/_component/SessionsTab";
import { ApiKeysTab } from "@/pages/settings/_component/ApiKeysTab";
import { RecentActivityTab } from "@/pages/settings/_component/RecentActivityTab";
import { OidcProvidersTab } from "@/pages/settings/_component/OidcProvidersTab";
import { BlocklistTab } from "@/pages/settings/_component/BlocklistTab";
import { useCurrentUser } from "@/lib/auth/useAuth";
import { cn } from "@/lib/utils";
import {
  User,
  Bell,
  Puzzle,
  Users,
  Database,
  Clock,
  ShieldCheck,
  History,
  Clapperboard,
  Package,
  Settings as SettingsIcon,
  KeyRound,
  ShieldBan,
  type LucideIcon,
} from "lucide-react";
import { usePrefetchRoute } from "@/lib/routing/usePrefetchRoute";

export type Tab =
  | "activity"
  | "notifications"
  | "profile"
  | "integrations"
  | "general"
  | "sso"
  | "data-export"
  | "jobs"
  | "users"
  | "sessions"
  | "api-keys"
  | "media"
  | "releases"
  | "blocklist";

interface TabItem {
  id: Tab;
  label: string;
  icon: LucideIcon;
}

export function Settings() {
  const { t } = useTranslation("common");
  const navigate = useNavigate();
  const search = useSearch({ from: "/settings/" });
  const { data: currentUser } = useCurrentUser();
  const prefetchRoute = usePrefetchRoute();
  const activeTab = (search.tab as Tab) || "profile";

  const setActiveTab = (tab: Tab) => {
    navigate({ to: "/settings", search: { tab } });
  };

  const userTabs: TabItem[] = [
    { id: "profile", label: t("settings.profile.title"), icon: User },
    { id: "activity", label: t("settings.activity.title"), icon: History },
    {
      id: "notifications",
      label: t("settings.notifications.title"),
      icon: Bell,
    },
  ];

  const adminTabs: TabItem[] = currentUser?.is_admin
    ? [
        {
          id: "general",
          label: t("settings.general.title"),
          icon: SettingsIcon,
        },
        {
          id: "integrations",
          label: t("settings.integrations.title"),
          icon: Puzzle,
        },
        {
          id: "sso",
          label: t("settings.integrations.sso.title"),
          icon: ShieldCheck,
        },
        { id: "users", label: t("settings.users.title"), icon: Users },
        {
          id: "sessions",
          label: t("settings.sessions.title"),
          icon: ShieldCheck,
        },
        {
          id: "api-keys",
          label: t("settings.apiKeys.title"),
          icon: KeyRound,
        },
        { id: "jobs", label: t("settings.jobs.title"), icon: Clock },
        {
          id: "media",
          label: t("settings.media.title"),
          icon: Clapperboard,
        },
        {
          id: "data-export",
          label: t("settings.dataExport.title"),
          icon: Database,
        },
        {
          id: "releases",
          label: t("settings.releases.title"),
          icon: Package,
        },
        {
          id: "blocklist",
          label: t("settings.blocklist.title"),
          icon: ShieldBan,
        },
      ]
    : [];

  const renderTab = (tab: TabItem) => (
    <div key={tab.id} className="relative">
      {activeTab === tab.id && (
        <span className="absolute left-0 top-1 bottom-1 w-0.5 rounded-full bg-primary-400" />
      )}
      <button
        onClick={() => setActiveTab(tab.id)}
        onMouseEnter={() => prefetchRoute("/settings", { tab: tab.id })}
        className={cn(
          "w-full flex items-center gap-3 pl-4 pr-3 py-2.5 rounded-lg text-sm font-medium transition-all duration-150",
          activeTab === tab.id
            ? "bg-primary-500/10 text-primary-400"
            : "text-neutral-400 hover:bg-neutral-800 hover:text-neutral-200",
        )}
      >
        <tab.icon className="w-4 h-4 flex-shrink-0" />
        {tab.label}
      </button>
    </div>
  );

  return (
    <div className="flex-1 flex flex-col md:flex-row bg-neutral-900">
      {/* Mobile: select dropdown */}
      <div className="md:hidden border-b border-neutral-800 bg-neutral-900 px-4 py-3">
        <select
          value={activeTab}
          onChange={(e) => setActiveTab(e.target.value as Tab)}
          className="w-full px-3 py-2 rounded-lg border border-neutral-700 bg-neutral-800 text-neutral-100 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-primary-500"
        >
          <optgroup label={t("settings.sections.account")}>
            {userTabs.map((tab) => (
              <option key={tab.id} value={tab.id}>
                {tab.label}
              </option>
            ))}
          </optgroup>
          {adminTabs.length > 0 && (
            <optgroup label={t("settings.sections.admin")}>
              {adminTabs.map((tab) => (
                <option key={tab.id} value={tab.id}>
                  {tab.label}
                </option>
              ))}
            </optgroup>
          )}
        </select>
      </div>

      {/* Desktop: sidebar */}
      <aside className="hidden md:block w-64 flex-shrink-0 relative border-r border-neutral-800 bg-neutral-900">
        <div className="overflow-y-auto">
          <div className="px-6 py-5 border-b border-neutral-800">
            <h1 className="text-lg font-semibold text-neutral-100">
              {t("settings.title")}
            </h1>
          </div>
          <nav className="p-3">
            <div className="mb-4">
              <p className="text-[10px] font-semibold text-neutral-500 uppercase tracking-widest mb-1.5 px-3">
                {t("settings.sections.account")}
              </p>
              <div className="space-y-0.5">{userTabs.map(renderTab)}</div>
            </div>
            {adminTabs.length > 0 && (
              <div>
                <p className="text-[10px] font-semibold text-neutral-500 uppercase tracking-widest mb-1.5 px-3">
                  {t("settings.sections.admin")}
                </p>
                <div className="space-y-0.5">{adminTabs.map(renderTab)}</div>
              </div>
            )}
          </nav>
        </div>
      </aside>

      {/* Content */}
      <div className="flex-1 min-w-0 p-4 md:p-8 overflow-x-hidden">
        <div className="max-w-4xl mx-auto">
          {activeTab === "profile" && <ProfileTab />}
          {activeTab === "activity" && <RecentActivityTab />}
          {activeTab === "notifications" && <NotificationsTab />}
          {activeTab === "integrations" && currentUser?.is_admin && (
            <IntegrationsTab />
          )}
          {activeTab === "general" && currentUser?.is_admin && (
            <GeneralSettingsTab />
          )}
          {activeTab === "sso" && currentUser?.is_admin && <OidcProvidersTab />}
          {activeTab === "data-export" && currentUser?.is_admin && (
            <DataExportTab />
          )}
          {activeTab === "users" && currentUser?.is_admin && <UsersTab />}
          {activeTab === "sessions" && currentUser?.is_admin && <SessionsTab />}
          {activeTab === "api-keys" && currentUser?.is_admin && <ApiKeysTab />}
          {activeTab === "jobs" && currentUser?.is_admin && <JobsTab />}
          {activeTab === "media" && currentUser?.is_admin && (
            <MediaSettingsTab />
          )}
          {activeTab === "releases" && currentUser?.is_admin && <ReleasesTab />}
          {activeTab === "blocklist" && currentUser?.is_admin && (
            <BlocklistTab />
          )}
        </div>
      </div>
    </div>
  );
}

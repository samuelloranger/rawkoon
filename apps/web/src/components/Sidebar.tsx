import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { motion } from "motion/react";
import { useState } from "react";
import { clearUser } from "@/lib/auth";
import { useLogout } from "@/lib/auth/useAuth";
import { useUpdateProfile } from "@/pages/settings/useUsers";
import { formatDisplayName } from "@/lib/utils/format";
import { NotificationsMenu } from "@/components/NotificationsBell";
import { UserMenu } from "@/components/UserMenu";
import { Loader, LogOut, Search, Settings } from "lucide-react";
import { usePrefetchRoute } from "@/lib/routing/usePrefetchRoute";
import { useAuth } from "@/lib/auth/useAuth";
import { useTheme } from "@/lib/app/useTheme";
import { cn } from "@/lib/utils";
import { navSections } from "@/lib/routing/navigation";
import type { NavPosition } from "@rawkoon/shared/types";
import { NavPositionPicker } from "@/components/NavPositionPicker";
import { useNavPosition } from "@/pages/settings/useNavPosition";

interface SidebarProps {
  onOpenQuickActions?: () => void;
  position: NavPosition;
}

export function Sidebar({ onOpenQuickActions, position }: SidebarProps) {
  const { user } = useAuth();
  const { t, i18n } = useTranslation("common");
  const router = useRouterState();
  const currentPath = router.location.pathname;
  const navigate = useNavigate();
  const logoutMutation = useLogout();
  const prefetchRoute = usePrefetchRoute();

  useTheme();
  const { setPosition } = useNavPosition();
  const isHorizontal = position === "top" || position === "bottom";
  const [popoverOpen, setPopoverOpen] = useState(false);
  const [popoverCoords, setPopoverCoords] = useState({ x: 0, y: 0 });

  const updateProfile = useUpdateProfile();

  const languages = [
    { code: "en", name: "EN" },
    { code: "fr", name: "FR" },
  ];
  const currentLanguage =
    languages.find((lang) => lang.code === i18n.language) || languages[0];

  const toggleLanguage = () => {
    const nextLanguage =
      languages.find((lang) => lang.code !== i18n.language) || languages[0];
    i18n.changeLanguage(nextLanguage.code);
    if (user) {
      updateProfile.mutate(
        { locale: nextLanguage.code },
        {
          onError: (error) =>
            console.debug("Failed to update locale on server:", error),
        },
      );
    }
  };

  const handleLogout = async () => {
    try {
      let subscriptionEndpoint: string | undefined;
      if ("serviceWorker" in navigator && "PushManager" in window) {
        try {
          const registration = await navigator.serviceWorker.ready;
          const subscription = await registration.pushManager.getSubscription();
          if (subscription) {
            subscriptionEndpoint = subscription.endpoint;
            try {
              await subscription.unsubscribe();
            } catch (error) {
              console.warn(
                "Failed to unsubscribe from service worker on logout:",
                error,
              );
            }
          }
        } catch (error) {
          console.warn(
            "Could not get subscription endpoint for logout:",
            error,
          );
        }
      }

      await logoutMutation.mutateAsync(subscriptionEndpoint);
      clearUser();
      navigate({ to: "/login" });
    } catch (error) {
      console.error("Logout error:", error);
      clearUser();
      navigate({ to: "/login" });
    }
  };

  function handleContextMenu(e: React.MouseEvent) {
    if ((e.target as HTMLElement).closest("a")) return;
    e.preventDefault();
    setPopoverCoords({ x: e.clientX, y: e.clientY });
    setPopoverOpen(true);
  }

  const initials = user ? formatDisplayName(user).charAt(0).toUpperCase() : "";

  return (
    <>
      {/* Desktop sidebar */}
      <aside
        onContextMenu={handleContextMenu}
        className={cn(
          "hidden lg:flex fixed z-50 bg-neutral-900/80 backdrop-blur-xl theme-transition",
          {
            "left-0 top-0 bottom-0 w-60 flex-col border-r border-white/[0.08]":
              position === "left",
            "right-0 top-0 bottom-0 w-60 flex-col border-l border-white/[0.08]":
              position === "right",
            "top-0 left-0 right-0 h-12 flex-row items-center border-b border-white/[0.08]":
              position === "top",
            "bottom-0 left-0 right-0 h-12 flex-row items-center border-t border-white/[0.08]":
              position === "bottom",
          },
        )}
      >
        {/* Logo */}
        <div
          className={cn(
            "flex items-center gap-2.5 shrink-0",
            isHorizontal ? "px-3 h-full" : "px-5 h-16",
          )}
        >
          <Link
            to="/"
            className="flex items-center gap-2.5 group"
            onMouseEnter={() => prefetchRoute("/")}
          >
            <img
              src="/icon-32.png"
              alt=""
              className="h-7 w-7 transition-transform duration-200 group-hover:scale-110"
            />
            {!isHorizontal && (
              <span className="text-lg font-bold tracking-tight text-white">
                Rawkoon
              </span>
            )}
          </Link>
        </div>

        {/* Nav items */}
        <nav
          className={cn(
            isHorizontal
              ? "flex flex-row items-center gap-0.5 px-1 flex-1 overflow-x-auto h-full"
              : "flex-1 overflow-y-auto px-3 py-2 space-y-5",
          )}
        >
          {navSections.map((section, sectionIndex) => (
            <div
              key={section.labelKey ?? sectionIndex}
              className={cn(!isHorizontal && "space-y-0")}
            >
              {/* Section label — only when labelled, hidden on horizontal */}
              {!isHorizontal && section.labelKey && (
                <span className="px-3 text-[11px] font-semibold uppercase tracking-wider text-neutral-500">
                  {t(section.labelKey)}
                </span>
              )}
              <div
                className={cn(
                  isHorizontal
                    ? "flex flex-row items-center gap-0.5"
                    : "mt-1.5 space-y-0.5",
                )}
              >
                {section.items.map((item) => {
                  const isActive =
                    item.path === "/"
                      ? currentPath === "/"
                      : currentPath === item.path ||
                        currentPath.startsWith(`${item.path}/`);
                  const Icon = item.icon;
                  return (
                    <Link
                      key={item.path}
                      to={item.path}
                      onMouseEnter={() => prefetchRoute(item.path)}
                      className={cn(
                        "relative flex items-center rounded-lg text-[13px] font-medium transition-colors duration-150",
                        isHorizontal
                          ? "gap-0 px-3 py-2 justify-center"
                          : "gap-3 px-3 py-2",
                        isActive
                          ? "text-white"
                          : "text-neutral-400 hover:bg-white/[0.04] hover:text-neutral-200",
                      )}
                      title={isHorizontal ? t(item.translationKey) : undefined}
                    >
                      {isActive && (
                        <motion.span
                          layoutId="sidebar-active"
                          className="absolute inset-0 rounded-lg bg-white/[0.08]"
                          transition={{
                            type: "spring",
                            stiffness: 500,
                            damping: 40,
                          }}
                        />
                      )}
                      <Icon
                        size={18}
                        className={cn(
                          "relative z-10",
                          isActive && "text-primary-400",
                        )}
                      />
                      {/* Item label — hidden on horizontal */}
                      {!isHorizontal && (
                        <span className="relative z-10">
                          {t(item.translationKey)}
                        </span>
                      )}
                    </Link>
                  );
                })}
              </div>
            </div>
          ))}
        </nav>

        {/* Bottom section */}
        {isHorizontal ? (
          /* Horizontal: compact icon row on the right */
          <div className="flex items-center gap-0.5 px-2 ml-auto h-full shrink-0">
            {onOpenQuickActions && (
              <button
                type="button"
                onClick={onOpenQuickActions}
                className="flex h-8 w-8 items-center justify-center rounded-lg text-neutral-400 hover:bg-white/[0.06] transition-colors"
                aria-label={t("common.quickActions")}
                title={t("common.quickActions")}
              >
                <Search size={16} />
              </button>
            )}
            <NotificationsMenu />
            <Link
              to="/settings"
              search={{ tab: "profile" }}
              title={t("settings.title")}
              className={cn(
                "flex h-8 w-8 items-center justify-center rounded-lg transition-colors duration-150",
                currentPath.startsWith("/settings")
                  ? "text-white bg-white/[0.08]"
                  : "text-neutral-400 hover:bg-white/[0.06]",
              )}
            >
              <Settings size={16} />
            </Link>
            <button
              onClick={toggleLanguage}
              className="flex h-8 items-center justify-center rounded-lg px-2 text-[11px] font-semibold text-neutral-400 hover:bg-white/[0.06] hover:text-neutral-200 transition-colors"
              title={t("common.language")}
            >
              {currentLanguage.name}
            </button>
            <button
              onClick={handleLogout}
              className="flex h-8 w-8 items-center justify-center rounded-lg text-neutral-400 hover:bg-white/[0.06] hover:text-red-400 transition-colors"
              aria-label={t("nav.logout")}
              title={t("nav.logout")}
            >
              <LogOut size={16} />
            </button>
          </div>
        ) : (
          /* Vertical: existing bottom section */
          <div className="shrink-0 border-t border-white/[0.08] px-3 py-3 space-y-1">
            {onOpenQuickActions && (
              <button
                type="button"
                onClick={onOpenQuickActions}
                className="flex w-full items-center gap-3 rounded-lg px-2.5 py-2 text-[13px] font-medium transition-all duration-150 text-neutral-400 hover:bg-white/[0.04] hover:text-neutral-200"
              >
                <Search size={18} />
                <span className="flex-1 text-left">
                  {t("common.quickActions")}
                </span>
                <span className="rounded-md border px-1.5 py-0.5 text-[10px] font-semibold text-neutral-400 border-white/[0.08]">
                  ⌘K
                </span>
              </button>
            )}

            {/* Notifications */}
            <div className="flex items-center">
              <NotificationsMenu />
              <span className="ml-2 text-[13px] font-medium text-neutral-400">
                {t("notifications.title")}
              </span>
            </div>

            {/* Settings */}
            <Link
              to="/settings"
              search={{ tab: "profile" }}
              onMouseEnter={() =>
                prefetchRoute("/settings", { tab: "profile" })
              }
              className={cn(
                "relative flex items-center gap-3 px-2.5 py-2 rounded-lg text-[13px] font-medium transition-colors duration-150",
                currentPath.startsWith("/settings")
                  ? "text-white"
                  : "text-neutral-400 hover:bg-white/[0.04] hover:text-neutral-200",
              )}
            >
              {currentPath.startsWith("/settings") && (
                <motion.span
                  layoutId="sidebar-active"
                  className="absolute inset-0 rounded-lg bg-white/[0.08]"
                  transition={{ type: "spring", stiffness: 500, damping: 40 }}
                />
              )}
              <Settings size={18} className="relative z-10" />
              <span className="relative z-10">{t("settings.title")}</span>
            </Link>

            {/* Divider */}
            <div className="h-px bg-white/[0.08] my-1" />

            {/* User section */}
            {user && (
              <div className="flex items-center gap-2 px-1.5 py-1">
                {user.avatar_url ? (
                  <img
                    src={user.avatar_url}
                    alt={formatDisplayName(user)}
                    className="h-8 w-8 rounded-lg object-cover ring-1 ring-white/10 shrink-0"
                  />
                ) : (
                  <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary-900/40 text-xs font-semibold text-primary-300 shrink-0">
                    {initials}
                  </div>
                )}
                <span className="text-[13px] font-medium text-neutral-300 truncate">
                  {formatDisplayName(user)}
                </span>
              </div>
            )}

            {/* Quick actions row */}
            <div className="flex items-center gap-1 px-1">
              <button
                onClick={toggleLanguage}
                className="flex h-8 items-center justify-center rounded-lg px-2 text-[11px] font-semibold text-neutral-400 hover:bg-white/[0.06] hover:text-neutral-200 transition-colors"
                title={t("common.language")}
              >
                {currentLanguage.name}
              </button>
              <div className="flex-1" />
              <button
                onClick={handleLogout}
                className="flex h-8 w-8 items-center justify-center rounded-lg text-neutral-400 hover:bg-white/[0.06] hover:text-red-400 transition-colors"
                aria-label={t("nav.logout")}
                title={t("nav.logout")}
              >
                <LogOut size={16} />
              </button>
            </div>
          </div>
        )}

        {/* Right-click position popover */}
        {popoverOpen && (
          <>
            <div
              className="fixed inset-0 z-[60]"
              onClick={() => setPopoverOpen(false)}
            />
            <div
              className="fixed z-[61] bg-neutral-800 border border-neutral-700 rounded-xl shadow-xl p-3"
              style={{ left: popoverCoords.x, top: popoverCoords.y }}
            >
              <p className="text-xs font-semibold text-neutral-400 mb-2 px-1">
                Navigation position
              </p>
              <NavPositionPicker
                value={position}
                onChange={(p) => {
                  setPosition(p);
                  setPopoverOpen(false);
                }}
              />
            </div>
          </>
        )}
      </aside>

      {/* Mobile top bar */}
      <div className="lg:hidden">
        <div style={{ height: "calc(56px + env(safe-area-inset-top, 0px))" }} />
        <nav className="fixed heading-safe-area top-0 left-0 right-0 z-50 bg-neutral-900/80 backdrop-blur-xl border-b border-white/[0.08] theme-transition">
          <div className="px-4 sm:px-6">
            <div className="flex items-center justify-between h-14">
              {/* Left: Logo */}
              <Link
                to="/"
                className="flex items-center gap-2.5 group"
                onMouseEnter={() => prefetchRoute("/")}
              >
                <img
                  src="/icon-32.png"
                  alt=""
                  className="h-7 w-7 transition-transform duration-200 group-hover:scale-110"
                />
                <span className="text-lg font-bold tracking-tight text-white">
                  Rawkoon
                </span>
              </Link>

              {/* Right: Notifications + User */}
              <div className="flex items-center gap-0.5">
                {onOpenQuickActions && (
                  <>
                    <button
                      type="button"
                      onClick={onOpenQuickActions}
                      className="flex h-9 w-9 items-center justify-center rounded-xl transition-colors text-neutral-400 hover:bg-white/[0.06]"
                      aria-label={t("common.quickActions")}
                      title={t("common.quickActions")}
                    >
                      <Search className="h-4 w-4" />
                    </button>
                    <div className="mx-1.5 h-5 w-px bg-white/[0.08]" />
                  </>
                )}
                <NotificationsMenu />
                <div className="mx-1.5 h-5 w-px bg-white/[0.08]" />
                {!user ? (
                  <div className="flex h-9 w-9 items-center justify-center text-neutral-400">
                    <Loader className="h-4 w-4 animate-spin" />
                  </div>
                ) : (
                  <UserMenu user={user} onLogout={handleLogout} />
                )}
              </div>
            </div>
          </div>
        </nav>
      </div>
    </>
  );
}

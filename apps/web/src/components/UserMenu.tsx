import { useState } from "react";
import { Link, useRouterState } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import * as Popover from "@radix-ui/react-popover";
import { useUpdateProfile } from "@/pages/settings/useUsers";
import type { User } from "@rawkoon/shared/types";
import { formatDisplayName } from "@/lib/utils/format";
import { useTheme } from "@/lib/app/useTheme";
import { cn } from "@/lib/utils";
import { ChevronDown, LogOut, Settings } from "lucide-react";
import { usePrefetchRoute } from "@/lib/routing/usePrefetchRoute";
import { navSections } from "@/lib/routing/navigation";

interface UserMenuProps {
  user: User;
  onLogout: () => void;
}

export function UserMenu({ user, onLogout }: UserMenuProps) {
  const { t, i18n } = useTranslation("common");
  const router = useRouterState();
  const currentPath = router.location.pathname;
  const [isOpen, setIsOpen] = useState(false);
  useTheme();
  const updateProfile = useUpdateProfile();
  const prefetchRoute = usePrefetchRoute();

  const languages = [
    { code: "en", name: "English" },
    { code: "fr", name: "Français" },
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
          onError: (error) => {
            console.debug("Failed to update locale on server:", error);
          },
        },
      );
    }
  };

  const handleLogout = () => {
    setIsOpen(false);
    onLogout();
  };

  const initials = formatDisplayName(user).charAt(0).toUpperCase();

  return (
    <Popover.Root open={isOpen} onOpenChange={setIsOpen}>
      <Popover.Trigger asChild>
        <button
          className="flex h-9 items-center gap-2 rounded-xl px-1.5 hover:bg-white/[0.06] transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-1"
          aria-label={t("common.userMenu")}
        >
          {user.avatar_url ? (
            <img
              src={user.avatar_url}
              alt={formatDisplayName(user)}
              className="h-7 w-7 rounded-lg object-cover ring-1 ring-white/10"
            />
          ) : (
            <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-primary-900/40 text-xs font-semibold text-primary-300">
              {initials}
            </div>
          )}
          <span className="hidden lg:block max-w-[100px] truncate text-[13px] font-medium text-neutral-300">
            {formatDisplayName(user)}
          </span>
          <ChevronDown
            className={`hidden lg:block h-3.5 w-3.5 text-neutral-500 transition-transform duration-200 ${isOpen ? "rotate-180" : ""}`}
          />
        </button>
      </Popover.Trigger>

      <Popover.Portal>
        <Popover.Content
          className="min-w-[220px] w-56 bg-neutral-800 rounded-xl shadow-lg border border-neutral-700/60 z-50 overflow-hidden data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2"
          align="end"
          sideOffset={8}
          collisionPadding={16}
        >
          {/* Mobile nav items */}
          <div
            className={cn(
              "py-2 px-2 border-b border-neutral-700/60",
              "block lg:hidden",
            )}
          >
            {navSections.map((section, sectionIndex) => (
              <div
                key={section.labelKey ?? sectionIndex}
                className="pb-2 last:pb-0"
              >
                {section.labelKey && (
                  <p className="px-2 pb-1.5 text-[10px] font-semibold uppercase tracking-widest text-neutral-500">
                    {t(section.labelKey)}
                  </p>
                )}
                <div className="grid grid-cols-3 gap-1">
                  {section.items.map((item) => {
                    const isActive =
                      currentPath === item.path ||
                      (item.path !== "/" &&
                        currentPath.startsWith(`${item.path}/`));
                    return (
                      <Link
                        key={item.path}
                        to={item.path}
                        onClick={() => setIsOpen(false)}
                        onMouseEnter={() => prefetchRoute(item.path)}
                        style={{ touchAction: "manipulation" }}
                        className={`flex flex-col items-center justify-center gap-1 py-2.5 px-1 rounded-xl transition-all duration-150 ${
                          isActive
                            ? "bg-primary-500/10 text-primary-300"
                            : "text-neutral-400 hover:bg-white/[0.04] active:bg-white/[0.08]"
                        }`}
                      >
                        <item.icon
                          size={20}
                          className={`transition-transform ${isActive ? "scale-110" : ""}`}
                        />
                        <span className="text-[10px] font-medium leading-none text-center w-full truncate">
                          {t(item.translationKey)}
                        </span>
                        {isActive && (
                          <span className="absolute bottom-1 w-1 h-1 rounded-full bg-primary-500 opacity-0" />
                        )}
                      </Link>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>

          {/* Preferences */}
          <div className="py-2 px-3 border-b border-neutral-700/60">
            <button
              onClick={toggleLanguage}
              className="flex items-center justify-between w-full py-1.5 group"
            >
              <span className="text-xs font-medium text-neutral-500">
                {t("common.language")}
              </span>
              <span className="text-xs font-medium text-neutral-300 group-hover:text-white transition-colors">
                {currentLanguage.name}
              </span>
            </button>
          </div>

          {/* Actions */}
          <div className="py-1.5 px-1.5">
            <Link
              to="/settings"
              search={{ tab: "profile" }}
              onClick={() => setIsOpen(false)}
              onMouseEnter={() =>
                prefetchRoute("/settings", { tab: "profile" })
              }
              className={`flex items-center gap-2.5 w-full px-2.5 py-2 text-sm rounded-lg transition-colors ${
                currentPath === "/settings"
                  ? "text-white bg-white/[0.06]"
                  : "text-neutral-300 hover:bg-white/[0.04]"
              }`}
            >
              <Settings className="h-4 w-4" />
              {t("settings.title")}
            </Link>
            <button
              onClick={handleLogout}
              className="flex items-center gap-2.5 w-full px-2.5 py-2 text-sm rounded-lg text-neutral-300 hover:bg-white/[0.04] transition-colors"
            >
              <LogOut className="h-4 w-4" />
              {t("nav.logout")}
            </button>
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

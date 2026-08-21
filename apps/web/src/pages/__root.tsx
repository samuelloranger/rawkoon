import {
  createRootRouteWithContext,
  ScrollRestoration,
  useRouterState,
} from "@tanstack/react-router";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Toaster } from "sonner";
import type { QueryClient } from "@tanstack/react-query";
import { Sidebar } from "@/components/Sidebar";
import { PageTransition } from "@/components/PageTransition";
import { NotificationPermissionModal } from "@/components/NotificationPermissionModal";
import { QuickActionPalette } from "@/components/QuickActionPalette";
import { RouteDataRefetcher } from "@/components/RouteDataRefetcher";
import { useAutoSubscribeNotifications } from "@/lib/notifications/useAutoSubscribeNotifications";
import { LibraryNavigationProvider } from "@/features/medias/context/LibraryNavigationContext";
import { ConfirmProvider } from "@/components/confirm/ConfirmContext";
import { PlayerProvider } from "@/features/player/PlayerProvider";
import { PlayerBar } from "@/features/player/PlayerBar";
import { PlayerExpanded } from "@/features/player/PlayerExpanded";
import { useNavPosition } from "@/pages/settings/useNavPosition";

interface RouterContext {
  queryClient: QueryClient;
}

function RootLayout() {
  const { showModal, handleAllow, handleDismiss } =
    useAutoSubscribeNotifications();
  const router = useRouterState();
  const [isQuickActionsOpen, setIsQuickActionsOpen] = useState(false);
  const { position } = useNavPosition();

  const contentPadding: Record<typeof position, string> = {
    left: "lg:pl-60",
    right: "lg:pr-60",
    top: "lg:pt-12",
    bottom: "lg:pb-12",
  };

  const { t } = useTranslation("common");
  const isSettings = router.location.pathname.startsWith("/settings");
  const shouldShowNav = !["/login"].includes(router.location.pathname);

  return (
    <ConfirmProvider>
      <LibraryNavigationProvider>
        <PlayerProvider>
          <ScrollRestoration />
          {shouldShowNav && (
            <>
              {/*
              Visible only once focused, so keyboard users can jump the sidebar
              instead of tabbing every nav item on every route change.
            */}
              <a
                href="#main-content"
                className="focus-ring sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[var(--z-tooltip)] focus:rounded-lg focus:bg-neutral-800 focus:px-4 focus:py-2 focus:text-sm focus:font-medium focus:text-neutral-50"
              >
                {t("a11y.skipToContent")}
              </a>
              <Sidebar
                position={position}
                onOpenQuickActions={() => setIsQuickActionsOpen(true)}
              />
            </>
          )}
          <div className={shouldShowNav ? contentPadding[position] : ""}>
            <main
              id="main-content"
              tabIndex={-1}
              className={`user min-h-full flex-1 flex flex-col ${isSettings ? "pb-0 min-h-screen" : "pb-10"}`}
            >
              <RouteDataRefetcher />
              <PageTransition />
            </main>
          </div>
          <QuickActionPalette
            isOpen={isQuickActionsOpen}
            onOpen={() => setIsQuickActionsOpen(true)}
            onClose={() => setIsQuickActionsOpen(false)}
          />
          <NotificationPermissionModal
            isOpen={showModal}
            onAllow={handleAllow}
            onDismiss={handleDismiss}
          />
          <Toaster position="bottom-center" richColors />
          {/* Outside the routed content so playback survives every navigation. */}
          <PlayerBar />
          <PlayerExpanded />
        </PlayerProvider>
      </LibraryNavigationProvider>
    </ConfirmProvider>
  );
}

export const Route = createRootRouteWithContext<RouterContext>()({
  component: RootLayout,
});

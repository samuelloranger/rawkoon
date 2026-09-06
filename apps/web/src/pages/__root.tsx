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
import { useAutoSubscribeNotifications } from "@/lib/notifications/useAutoSubscribeNotifications";
import { LibraryNavigationProvider } from "@/features/medias/context/LibraryNavigationContext";
import { ConfirmProvider } from "@/components/confirm/ConfirmContext";
import { useNavPosition } from "@/pages/settings/useNavPosition";
import { MiniPlayer } from "@/features/player/MiniPlayer";
import { PlayerProvider, usePlayer } from "@/features/player/PlayerProvider";

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
  const isRead = /\/books\/[^/]+\/read\/?$/.test(router.location.pathname);
  const shouldShowNav =
    !["/login"].includes(router.location.pathname) && !isRead;

  return (
    <ConfirmProvider>
      <PlayerProvider>
        <LibraryNavigationProvider>
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
            <MainWithPlayerPad isSettings={isSettings} />
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
          <MiniPlayer />
        </LibraryNavigationProvider>
      </PlayerProvider>
    </ConfirmProvider>
  );
}

function MainWithPlayerPad({ isSettings }: { isSettings: boolean }) {
  const player = usePlayer();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const onListen = /\/books\/[^/]+\/listen\/?$/.test(pathname);
  const pad =
    player.loaded && !onListen
      ? "pb-28"
      : isSettings
        ? "pb-0 min-h-screen"
        : "pb-10";

  return (
    <main
      id="main-content"
      tabIndex={-1}
      className={`user min-h-full flex-1 flex flex-col ${pad}`}
    >
      <PageTransition />
    </main>
  );
}

export const Route = createRootRouteWithContext<RouterContext>()({
  component: RootLayout,
});

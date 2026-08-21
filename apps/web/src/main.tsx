import "@fontsource-variable/fraunces/index.css";
import "@fontsource-variable/hanken-grotesk/index.css";
// The reading face. Commissioned for screen reading, and the face Google Books
// itself sets — which is where rawkoon's book metadata comes from.
import "@fontsource-variable/literata/index.css";
import { StrictMode } from "react";
import ReactDOM from "react-dom/client";
import { RouterProvider } from "@tanstack/react-router";
import { MotionConfig } from "motion/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { FetcherProvider } from "@/lib/api/context";
import { router } from "@/router";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { checkVersionAndReload } from "@/lib/version";
import { registerServiceWorker } from "@/lib/sw/registration";
import { bootstrapAuthFromWindow } from "@/lib/auth";
import { useCloseReadNotifications } from "@/lib/notifications/useCloseReadNotifications";
import { useIOSImprovements } from "@/lib/app/useIOSImprovements";
import { NotificationToastContainer } from "@/components/NotificationToastContainer";
import { QUERY_DEFAULTS, setQueryClient } from "@/lib/api/queryClient";
import { webFetcher } from "@/lib/api/fetcher";
import "@fontsource/fira-code/400.css";
import "@fontsource/fira-code/500.css";
import "@fontsource/fira-code/600.css";
import "@fontsource/fira-code/700.css";
import "./lib/i18n/index";
import "./index.css";

const queryClient = new QueryClient({ defaultOptions: QUERY_DEFAULTS });

// Export queryClient instance for use outside React components
setQueryClient(queryClient);
bootstrapAuthFromWindow(queryClient);

// Component to handle service worker query invalidation and iOS improvements
function AppWithServiceWorkerIntegration() {
  useCloseReadNotifications();
  useIOSImprovements();

  return (
    <>
      <RouterProvider router={router} context={{ queryClient }} />
      <NotificationToastContainer />
    </>
  );
}

// Reload once when Vite fails to preload a route chunk (transient network blip,
// deploy race, etc). Without this, the error reaches the ErrorBoundary and the
// user sees a broken screen instead of the next page.
window.addEventListener("vite:preloadError", (event) => {
  event.preventDefault();
  const key = "rawkoon_preload_reload_at";
  const last = Number(sessionStorage.getItem(key) ?? 0);
  if (Date.now() - last < 10_000) return;
  sessionStorage.setItem(key, String(Date.now()));
  window.location.reload();
});

// Register service worker for push notifications
registerServiceWorker();

// Render immediately to avoid blank screens if optional bootstrapping hangs.
ReactDOM.createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <FetcherProvider fetcher={webFetcher}>
          {/*
            reducedMotion="user" makes every `motion` component honour the OS
            setting without each call site reaching for useReducedMotion.
            Transforms and layout animations are dropped; opacity is kept, so
            state changes stay legible.
          */}
          <MotionConfig reducedMotion="user">
            <AppWithServiceWorkerIntegration />
          </MotionConfig>
        </FetcherProvider>
      </QueryClientProvider>
    </ErrorBoundary>
  </StrictMode>,
);

// Run bootstrapping tasks in the background.
void checkVersionAndReload();

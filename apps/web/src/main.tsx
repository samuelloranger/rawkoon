import "@fontsource-variable/fraunces/index.css";
import "@fontsource-variable/hanken-grotesk/index.css";
import { StrictMode } from "react";
import ReactDOM from "react-dom/client";
import { RouterProvider } from "@tanstack/react-router";
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
import { setQueryClient } from "@/lib/api/queryClient";
import { webFetcher } from "@/lib/api/fetcher";
import "@fontsource/fira-code/400.css";
import "@fontsource/fira-code/500.css";
import "@fontsource/fira-code/600.css";
import "@fontsource/fira-code/700.css";
import "./lib/i18n/index";
import "./index.css";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      refetchOnMount: false, // Only refetch if data is stale
      refetchOnReconnect: false,
      retry: 1,
      staleTime: 30 * 1000, // Data stays fresh for 30 seconds - prevents flashing on navigation
      gcTime: 5 * 60 * 1000, // Keep unused data in cache for 5 minutes - instant back navigation
    },
  },
});

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
          <AppWithServiceWorkerIntegration />
        </FetcherProvider>
      </QueryClientProvider>
    </ErrorBoundary>
  </StrictMode>,
);

// Run bootstrapping tasks in the background.
void checkVersionAndReload();

import { useState, useEffect } from "react";
import { useAuth } from "@/lib/auth/useAuth";

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{
    outcome: "accepted" | "dismissed";
    platform?: string;
  }>;
  platforms?: string[];
}

export function usePWA() {
  const [deferredPrompt, setDeferredPrompt] =
    useState<BeforeInstallPromptEvent | null>(null);
  const [isIOS] = useState(
    () =>
      /iPad|iPhone|iPod/.test(navigator.userAgent) &&
      !(window as Window & { MSStream?: unknown }).MSStream,
  );
  const { user } = useAuth();
  const [isStandalone, setIsStandalone] = useState(
    () =>
      window.matchMedia("(display-mode: standalone)").matches ||
      ("standalone" in window.navigator &&
        (window.navigator as Navigator & { standalone?: boolean })
          .standalone === true),
  );
  const [showIOSBanner, setShowIOSBanner] = useState(false);
  const [showPWABanner, setShowPWABanner] = useState(false);

  useEffect(() => {
    if (!user) return;

    const isFirefox = /Firefox/.test(navigator.userAgent);
    if (isFirefox) return;

    const handleBeforeInstallPrompt = (e: Event) => {
      e.preventDefault();
      const installPrompt = e as BeforeInstallPromptEvent;
      setDeferredPrompt(installPrompt);

      const dismissed =
        localStorage.getItem("pwa-install-dismissed") === "true";
      if (!dismissed) {
        setShowPWABanner(true);
      }
    };

    const handleAppInstalled = () => {
      console.log("PWA was installed");
      setDeferredPrompt(null);
      setShowPWABanner(false);
      setIsStandalone(true);
      localStorage.setItem("pwa-install-dismissed", "true");
    };

    if (!isStandalone) {
      window.addEventListener("beforeinstallprompt", handleBeforeInstallPrompt);
      window.addEventListener("appinstalled", handleAppInstalled);

      if (isIOS && localStorage.getItem("ios-install-dismissed") !== "true") {
        setTimeout(() => setShowIOSBanner(true), 5000);
      }
    }

    return () => {
      window.removeEventListener(
        "beforeinstallprompt",
        handleBeforeInstallPrompt,
      );
      window.removeEventListener("appinstalled", handleAppInstalled);
    };
  }, [user, isIOS, isStandalone]);

  const installPWA = async () => {
    if (!deferredPrompt) {
      console.warn("Install prompt not available");
      return;
    }

    try {
      await deferredPrompt.prompt();
      const choiceResult = await deferredPrompt.userChoice;

      if (choiceResult.outcome === "accepted") {
        console.log("User accepted the PWA install prompt");
      } else {
        console.log("User dismissed the PWA install prompt");
      }

      setDeferredPrompt(null);
      dismissPWABanner();
    } catch (error) {
      console.error("Error showing install prompt:", error);
      setDeferredPrompt(null);
      dismissPWABanner();
    }
  };

  const dismissIOSBanner = () => {
    setShowIOSBanner(false);
    localStorage.setItem("ios-install-dismissed", "true");
  };

  const dismissPWABanner = () => {
    setShowPWABanner(false);
    localStorage.setItem("pwa-install-dismissed", "true");
    setDeferredPrompt(null);
  };

  return {
    isIOS,
    isStandalone,
    showIOSBanner,
    showPWABanner,
    installPWA,
    dismissIOSBanner,
    dismissPWABanner,
  };
}

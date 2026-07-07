/**
 * Hook to handle iOS-specific improvements for better user experience
 * - Touch responsiveness improvements
 * - Prevents zoom on double tap for form elements
 * - Viewport height fix for iOS address bar
 */

import { useEffect } from "react";

export function useIOSImprovements(): void {
  useEffect(() => {
    const isIOS =
      /iPad|iPhone|iPod/.test(navigator.userAgent) &&
      !(window as Window & { MSStream?: unknown }).MSStream;

    if (!isIOS) {
      return;
    }

    const touchStartHandler = () => {};

    // Prevent zoom on double tap for form elements
    let lastTouchEnd = 0;
    const touchEndHandler = (event: TouchEvent) => {
      const now = Date.now();
      const timeSince = now - lastTouchEnd;

      if (timeSince < 300 && timeSince > 40) {
        event.preventDefault();
      }

      lastTouchEnd = now;
    };

    const orientationChangeHandler = () => {
      window.setTimeout(setVH, 100);
    };

    // Viewport height fix for iOS address bar
    const setVH = () => {
      const vh = window.innerHeight * 0.01;
      document.documentElement.style.setProperty("--vh", `${vh}px`);
    };

    // Improve touch responsiveness
    document.addEventListener("touchstart", touchStartHandler, {
      passive: true,
    });
    document.addEventListener("touchend", touchEndHandler, false);
    setVH();
    window.addEventListener("resize", setVH);
    window.addEventListener("orientationchange", orientationChangeHandler);

    // Cleanup function
    return () => {
      document.removeEventListener("touchstart", touchStartHandler);
      document.removeEventListener("touchend", touchEndHandler);
      window.removeEventListener("resize", setVH);
      window.removeEventListener("orientationchange", orientationChangeHandler);
    };
  }, []);
}

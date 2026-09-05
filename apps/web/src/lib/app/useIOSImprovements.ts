/**
 * Hook to handle iOS-specific improvements for better user experience
 * - Viewport height fix for iOS address bar
 *
 * Double-tap zoom is handled in CSS (`touch-action: manipulation` on
 * html/body) plus the `user-scalable=no` viewport meta. It must NOT be done
 * by preventing `touchend`: that also suppresses the synthesized `click`,
 * and Radix primitives (Select, in particular) open on `click` for touch
 * pointers — so any tap following another touch within ~300ms silently did
 * nothing.
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

    const orientationChangeHandler = () => {
      window.setTimeout(setVH, 100);
    };

    // Viewport height fix for iOS address bar
    const setVH = () => {
      const vh = window.innerHeight * 0.01;
      document.documentElement.style.setProperty("--vh", `${vh}px`);
    };

    setVH();
    window.addEventListener("resize", setVH);
    window.addEventListener("orientationchange", orientationChangeHandler);

    return () => {
      window.removeEventListener("resize", setVH);
      window.removeEventListener("orientationchange", orientationChangeHandler);
    };
  }, []);
}

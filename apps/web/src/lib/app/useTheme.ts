import { useEffect } from "react";

/**
 * Cozy Dusk is dark-only. This hook always applies the dark theme and exposes
 * a no-op toggle so existing call sites keep compiling. (Kept as a hook rather
 * than deleted to avoid a wide refactor in this phase.)
 */
export function useTheme() {
  useEffect(() => {
    document.documentElement.classList.add("dark");
    document.documentElement.style.colorScheme = "dark";
  }, []);

  return { isDark: true as const, toggleTheme: () => {} };
}

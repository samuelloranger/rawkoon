import {
  BookOpen,
  Bookmark,
  CalendarIcon,
  Compass,
  Inbox,
  LayoutDashboard,
  Layers2,
  Library,
  Sparkles,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

interface NavItem {
  path: string;
  translationKey: string;
  icon: LucideIcon;
  /**
   * Hide this entry unless the named feature flag is on. Books default to off
   * so a movies-only install sees no change after upgrading.
   */
  featureFlag?: "books";
}

export interface NavSection {
  labelKey?: string;
  items: NavItem[];
}

export const navSections: NavSection[] = [
  {
    items: [
      {
        path: "/",
        translationKey: "nav.dashboard",
        icon: LayoutDashboard,
      },
      {
        path: "/calendar",
        translationKey: "nav.calendar",
        icon: CalendarIcon,
      },
      {
        path: "/library",
        translationKey: "nav.library",
        icon: Library,
      },
      {
        path: "/books",
        translationKey: "nav.books",
        icon: BookOpen,
        featureFlag: "books",
      },
      {
        path: "/requests",
        translationKey: "nav.requests",
        icon: Inbox,
      },
      {
        path: "/explore",
        translationKey: "nav.explore",
        icon: Compass,
      },
      {
        path: "/discover",
        translationKey: "nav.discover",
        icon: Sparkles,
      },
      {
        path: "/watchlist",
        translationKey: "nav.watchlist",
        icon: Bookmark,
      },
      {
        path: "/collections",
        translationKey: "nav.collections",
        icon: Layers2,
      },
    ],
  },
];

/**
 * Nav sections with feature-flagged entries removed. Every nav consumer should
 * use this rather than `navSections` directly, so a disabled feature cannot
 * leak into the sidebar, the user menu, or the command palette.
 */
export function visibleNavSections(flags: {
  books_enabled?: boolean;
}): NavSection[] {
  const enabled = (item: NavItem): boolean =>
    item.featureFlag === "books" ? !!flags.books_enabled : true;

  return navSections
    .map((section) => ({ ...section, items: section.items.filter(enabled) }))
    .filter((section) => section.items.length > 0);
}

import {
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

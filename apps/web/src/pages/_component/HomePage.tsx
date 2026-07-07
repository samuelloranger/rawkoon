import { useTranslation } from "react-i18next";
import { motion, type Variants } from "motion/react";
import { PageLayout } from "@/components/PageLayout";
import { CardErrorBoundary } from "@/components/ErrorBoundary";
import { useCurrentUser } from "@/lib/auth/useAuth";
import { getUserFirstName } from "@/lib/utils/format";
import { GreetingCard } from "@/pages/_component/GreetingCard";
import { RecentlyAddedRail } from "@/pages/_component/RecentlyAddedRail";
import { UpcomingRail } from "@/pages/_component/UpcomingRail";
import { WidgetGrid } from "@/pages/_component/WidgetGrid";

// ─── Motion variants ──────────────────────────────────────────────────────────

const sectionsVariants: Variants = {
  hidden: {},
  show: { transition: { staggerChildren: 0.055 } },
};

const sectionVariants: Variants = {
  hidden: { opacity: 0, y: 10 },
  show: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.4, ease: [0.16, 1, 0.3, 1] },
  },
};

// ─── Main page ────────────────────────────────────────────────────────────────

/**
 * Home is a fixed media composition: greeting, two full-width poster rails,
 * then a responsive widget grid — in a stable order. No configurable layout,
 * edit mode, or persistence.
 */
export function HomePage() {
  const { t } = useTranslation("common");
  const { data: user } = useCurrentUser();

  return (
    <PageLayout fullWidth>
      <GreetingCard userName={getUserFirstName(user, t("dashboard.user"))} />
      <motion.div
        className="mt-6 space-y-8"
        variants={sectionsVariants}
        initial="hidden"
        animate="show"
      >
        <motion.div variants={sectionVariants}>
          <CardErrorBoundary>
            <RecentlyAddedRail />
          </CardErrorBoundary>
        </motion.div>
        <motion.div variants={sectionVariants}>
          <CardErrorBoundary>
            <UpcomingRail />
          </CardErrorBoundary>
        </motion.div>
        <motion.div variants={sectionVariants}>
          <WidgetGrid />
        </motion.div>
      </motion.div>
    </PageLayout>
  );
}

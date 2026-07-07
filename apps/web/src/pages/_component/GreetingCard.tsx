import { useMemo } from "react";
import { useTranslation } from "react-i18next";

interface GreetingCardProps {
  userName: string;
}

type TimeOfDay = "morning" | "afternoon" | "evening" | "night";

function getTimeOfDay(hour: number): TimeOfDay {
  if (hour >= 5 && hour < 12) return "morning";
  if (hour >= 12 && hour < 17) return "afternoon";
  if (hour >= 17 && hour < 21) return "evening";
  return "night";
}

export function GreetingCard({ userName }: GreetingCardProps) {
  const { t } = useTranslation("common");

  const { greeting, subtext } = useMemo(() => {
    const now = new Date();
    const hour = now.getHours();
    const dayOfWeek = now.getDay();
    const timeOfDay = getTimeOfDay(hour);
    const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;

    let baseGreeting: string;
    switch (timeOfDay) {
      case "morning":
        baseGreeting = t("dashboard.goodMorning");
        break;
      case "afternoon":
        baseGreeting = t("dashboard.goodAfternoon");
        break;
      default:
        baseGreeting = t("dashboard.goodEvening");
        break;
    }

    // Time-based subtext — stable between SSR and initial client render.
    let subtext: string;
    switch (timeOfDay) {
      case "morning":
        subtext = t("dashboard.subtexts.morning", {
          defaultValue: "Ready to make today count?",
        });
        break;
      case "afternoon":
        subtext = t("dashboard.subtexts.afternoon", {
          defaultValue: "Keep the momentum going!",
        });
        break;
      case "evening":
        subtext = t("dashboard.subtexts.evening", {
          defaultValue: "Wrapping up the day? Check your progress.",
        });
        break;
      default:
        subtext = t("dashboard.subtexts.night", {
          defaultValue: "Planning for tomorrow?",
        });
        break;
    }

    // Day-of-week flavor overrides the generic time-based subtext.
    if (isWeekend) {
      subtext = t("dashboard.subtexts.weekendRelax", {
        defaultValue: "Time to relax and recharge.",
      });
    } else if (dayOfWeek === 1) {
      subtext = t("dashboard.subtexts.monday", {
        defaultValue: "Fresh week, fresh start. You got this!",
      });
    } else if (dayOfWeek === 5) {
      subtext = t("dashboard.subtexts.friday", {
        defaultValue: "Almost there! Finish strong.",
      });
    }

    return { greeting: baseGreeting, subtext };
  }, [t]);

  return (
    <div className="relative">
      <h1 className="text-lg md:text-xl font-bold tracking-tight text-neutral-50">
        {greeting}, {userName}
      </h1>
      <p className="mt-0.5 text-xs text-neutral-400 leading-relaxed">
        {subtext}
      </p>
    </div>
  );
}

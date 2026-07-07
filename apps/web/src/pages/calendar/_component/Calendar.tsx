import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { PageLayout } from "@/components/PageLayout";
import { PageHeader } from "@/components/PageHeader";
import { useDashboardUpcoming } from "@/pages/_component/useDashboardUpcoming";
import type {
  DashboardUpcomingItem,
  TmdbMediaSearchItem,
} from "@rawkoon/shared/types";
import { sameDay } from "@rawkoon/shared/utils";
import { useNavigate, useSearch } from "@tanstack/react-router";
import { CalendarIcon } from "lucide-react";
import { ExploreCardDetailDialog } from "@/pages/medias/_component/ExploreCardDetailDialog";
import {
  parseCalendarSearchDate,
  localDateKey,
  upcomingToDialogItem,
} from "@/pages/calendar/_component/calendarUtils";
import { CalendarGrid } from "@/pages/calendar/_component/CalendarGrid";
import { CalendarDayPanel } from "@/pages/calendar/_component/CalendarDayPanel";

export type CalendarSearchParams = {
  date?: string;
};

export function Calendar() {
  const searchParams = useSearch({
    from: "/calendar/",
  }) as CalendarSearchParams;
  return (
    <CalendarBody
      key={searchParams.date ?? "none"}
      searchParams={searchParams}
    />
  );
}

function CalendarBody({
  searchParams,
}: {
  searchParams: CalendarSearchParams;
}) {
  const { t } = useTranslation("common");
  const navigate = useNavigate();

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const initialNotificationDate = useMemo(
    () => parseCalendarSearchDate(searchParams.date),
    [searchParams.date],
  );
  const initialDate = initialNotificationDate ?? today;

  const [currentMonth, setCurrentMonth] = useState(initialDate.getMonth() + 1);
  const [currentYear, setCurrentYear] = useState(initialDate.getFullYear());
  const [selectedDate, setSelectedDate] = useState<Date | null>(initialDate);

  const { data: upcomingData, isLoading: upcomingLoading } =
    useDashboardUpcoming();
  const [releaseDialogItem, setReleaseDialogItem] =
    useState<TmdbMediaSearchItem | null>(null);

  const handleReleaseClick = (item: DashboardUpcomingItem) => {
    if (item.library_id != null) {
      navigate({
        to: "/library/$libraryId",
        params: { libraryId: String(item.library_id) },
      });
      return;
    }

    setReleaseDialogItem(upcomingToDialogItem(item));
  };

  const releasesByDate = useMemo(() => {
    const map = new Map<string, DashboardUpcomingItem[]>();
    for (const item of upcomingData?.items ?? []) {
      if (!item.release_date) continue;
      const k = item.release_date.slice(0, 10);
      if (!map.has(k)) map.set(k, []);
      map.get(k)!.push(item);
    }
    return map;
  }, [upcomingData?.items]);

  // Get calendar grid
  const calendarGrid = useMemo(() => {
    const firstDay = new Date(currentYear, currentMonth - 1, 1);
    const lastDay = new Date(currentYear, currentMonth, 0);
    const daysInMonth = lastDay.getDate();
    const startingDayOfWeek = firstDay.getDay();

    const grid: Date[][] = [];
    let currentWeek: Date[] = [];

    for (let i = 0; i < startingDayOfWeek; i++) {
      const prevMonth = currentMonth === 1 ? 12 : currentMonth - 1;
      const prevYear = currentMonth === 1 ? currentYear - 1 : currentYear;
      const daysInPrevMonth = new Date(prevYear, prevMonth, 0).getDate();
      const date = new Date(
        prevYear,
        prevMonth - 1,
        daysInPrevMonth - startingDayOfWeek + i + 1,
      );
      currentWeek.push(date);
    }

    for (let day = 1; day <= daysInMonth; day++) {
      const date = new Date(currentYear, currentMonth - 1, day);
      currentWeek.push(date);

      if (currentWeek.length === 7) {
        grid.push(currentWeek);
        currentWeek = [];
      }
    }

    const nextMonth = currentMonth === 12 ? 1 : currentMonth + 1;
    const nextYear = currentMonth === 12 ? currentYear + 1 : currentYear;
    let nextMonthDay = 1;

    while (currentWeek.length < 7) {
      const date = new Date(nextYear, nextMonth - 1, nextMonthDay);
      currentWeek.push(date);
      nextMonthDay++;
    }

    if (currentWeek.length > 0) {
      grid.push(currentWeek);
    }

    return grid;
  }, [currentYear, currentMonth]);

  const handlePreviousMonth = () => {
    setSelectedDate(null);
    if (currentMonth === 1) {
      setCurrentMonth(12);
      setCurrentYear(currentYear - 1);
    } else {
      setCurrentMonth(currentMonth - 1);
    }
  };

  const handleNextMonth = () => {
    setSelectedDate(null);
    if (currentMonth === 12) {
      setCurrentMonth(1);
      setCurrentYear(currentYear + 1);
    } else {
      setCurrentMonth(currentMonth + 1);
    }
  };

  const handleGoToToday = () => {
    setCurrentMonth(today.getMonth() + 1);
    setCurrentYear(today.getFullYear());
    setSelectedDate(today);
  };

  const handleDayClick = (date: Date) => {
    if (sameDay(date, selectedDate)) {
      setSelectedDate(null);
      return;
    }
    setSelectedDate(date);
  };

  const getDayReleases = (date: Date): DashboardUpcomingItem[] => {
    const k = localDateKey(date);
    return releasesByDate.get(k) ?? [];
  };

  const selectedDayReleases = selectedDate ? getDayReleases(selectedDate) : [];

  // Check if viewing the current month
  const isViewingCurrentMonth =
    currentMonth === today.getMonth() + 1 &&
    currentYear === today.getFullYear();

  return (
    <PageLayout>
      <div className="mb-6 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
        <PageHeader
          icon={CalendarIcon}
          iconColor="text-primary-400"
          title={t("calendar.title")}
          subtitle={t("calendar.subtitle")}
        />
      </div>

      <div className="flex flex-col lg:flex-row gap-5">
        <CalendarGrid
          currentYear={currentYear}
          currentMonth={currentMonth}
          today={today}
          selectedDate={selectedDate}
          calendarGrid={calendarGrid}
          isViewingCurrentMonth={isViewingCurrentMonth}
          getDayReleases={getDayReleases}
          onDayClick={handleDayClick}
          onPreviousMonth={handlePreviousMonth}
          onNextMonth={handleNextMonth}
          onGoToToday={handleGoToToday}
        />

        <CalendarDayPanel
          selectedDate={selectedDate}
          selectedDayReleases={selectedDayReleases}
          upcomingLoading={upcomingLoading}
          onClearSelectedDate={() => setSelectedDate(null)}
          onReleaseClick={handleReleaseClick}
        />
      </div>

      {releaseDialogItem && (
        <ExploreCardDetailDialog
          item={releaseDialogItem}
          isOpen={true}
          onClose={() => setReleaseDialogItem(null)}
          onAdded={() => setReleaseDialogItem(null)}
        />
      )}
    </PageLayout>
  );
}

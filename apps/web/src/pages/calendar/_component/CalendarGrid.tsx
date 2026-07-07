import { useTranslation } from "react-i18next";
import { ChevronLeft, ChevronRight, Film } from "lucide-react";
import type { DashboardUpcomingItem } from "@rawkoon/shared/types";
import { sameDay, sameMonth } from "@rawkoon/shared/utils";
import { cn } from "@/lib/utils";
import { getDayName, getMonthName } from "@/pages/calendar/_component/utils";

interface CalendarGridProps {
  currentYear: number;
  currentMonth: number;
  today: Date;
  selectedDate: Date | null;
  calendarGrid: Date[][];
  isViewingCurrentMonth: boolean;
  getDayReleases: (date: Date) => DashboardUpcomingItem[];
  onDayClick: (date: Date) => void;
  onPreviousMonth: () => void;
  onNextMonth: () => void;
  onGoToToday: () => void;
}

export function CalendarGrid({
  currentYear,
  currentMonth,
  today,
  selectedDate,
  calendarGrid,
  isViewingCurrentMonth,
  getDayReleases,
  onDayClick,
  onPreviousMonth,
  onNextMonth,
  onGoToToday,
}: CalendarGridProps) {
  const { t } = useTranslation("common");

  const isCurrentMonth = (date: Date): boolean => {
    return sameMonth(date, new Date(currentYear, currentMonth - 1, 1));
  };

  return (
    <div className="flex-1 min-w-0">
      <div className="bg-neutral-800/80 backdrop-blur-sm rounded-2xl shadow-sm border border-neutral-700/50 overflow-hidden">
        {/* Month Navigation */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-neutral-700/60">
          <button
            onClick={onPreviousMonth}
            className="p-2 rounded-xl hover:bg-neutral-700/60 transition-all duration-200 active:scale-95"
            aria-label="Previous month"
          >
            <ChevronLeft className="w-5 h-5 text-neutral-400" />
          </button>

          <div className="flex items-center gap-3">
            <h2 className="font-display text-lg font-semibold text-neutral-50 tracking-tight">
              {getMonthName(t, currentMonth - 1)} {currentYear}
            </h2>
            {!isViewingCurrentMonth && (
              <button
                onClick={onGoToToday}
                className="text-xs font-medium text-primary-400 hover:text-primary-300 px-2.5 py-1 rounded-lg bg-primary-900/20 hover:bg-primary-900/30 transition-colors"
              >
                {t("calendar.today") || "Today"}
              </button>
            )}
          </div>

          <button
            onClick={onNextMonth}
            className="p-2 rounded-xl hover:bg-neutral-700/60 transition-all duration-200 active:scale-95"
            aria-label="Next month"
          >
            <ChevronRight className="w-5 h-5 text-neutral-400" />
          </button>
        </div>

        {/* Day headers */}
        <div className="grid grid-cols-7 border-b border-neutral-700/60">
          {new Array(7).fill(0).map((_, day) => (
            <div
              key={day}
              className="py-2.5 text-center text-xs font-semibold uppercase tracking-wider text-neutral-500"
            >
              {getDayName(t, day)}
            </div>
          ))}
        </div>

        {/* Calendar Days */}
        <div className="grid grid-cols-7">
          {calendarGrid.flat().map((date, index) => {
            const dayReleases = getDayReleases(date);
            const isCurrentMonthDay = isCurrentMonth(date);
            const isTodayDay = sameDay(date, today);
            const isSelectedDate = sameDay(date, selectedDate);

            return (
              <button
                key={index}
                onClick={() => onDayClick(date)}
                className={cn(
                  "relative aspect-square min-h-0 p-1 sm:p-1.5 flex flex-col items-stretch transition-all duration-150 border-b border-r border-neutral-700/60",
                  !isCurrentMonthDay && "opacity-30",
                  isCurrentMonthDay && "hover:bg-primary-900/10",
                  isSelectedDate && "bg-primary-900/20",
                )}
              >
                <div className="flex flex-col items-center flex-1 min-h-0 w-full h-full">
                  {/* Day number */}
                  <span
                    className={cn(
                      "relative z-10 shrink-0 text-sm font-medium w-7 h-7 flex items-center justify-center rounded-full transition-all duration-200",
                      isTodayDay &&
                        "bg-primary-600 text-neutral-950 font-semibold shadow-sm shadow-primary-600/30",
                      isSelectedDate &&
                        !isTodayDay &&
                        "bg-primary-900/30 text-primary-300 ring-2 ring-primary-500/40 font-semibold",
                      !isTodayDay &&
                        !isSelectedDate &&
                        isCurrentMonthDay &&
                        "text-neutral-300",
                      !isCurrentMonthDay && "text-neutral-600",
                    )}
                  >
                    {date?.getDate()}
                  </span>

                  {/* Spacer so release posters sit at the bottom of the cell */}
                  <div
                    className="flex-1 min-h-[2px] w-full shrink"
                    aria-hidden
                  />

                  {/* Release posters — bottom of square */}
                  {dayReleases.length > 0 && (
                    <div className="flex w-full shrink-0 items-end justify-center gap-0.5 px-0.5 pb-0.5 overflow-hidden">
                      {dayReleases.slice(0, 2).map((item) =>
                        item.poster_url ? (
                          <img
                            key={item.id}
                            src={item.poster_url}
                            alt=""
                            className="h-7 w-[18px] sm:h-8 sm:w-[22px] shrink-0 rounded-[3px] object-cover ring-1 ring-black/50"
                          />
                        ) : (
                          <div
                            key={item.id}
                            className="flex h-7 w-[18px] sm:h-8 sm:w-[22px] shrink-0 items-center justify-center rounded-[3px] bg-neutral-700/80"
                            aria-hidden
                          >
                            <Film className="w-2.5 h-2.5 text-neutral-400" />
                          </div>
                        ),
                      )}
                      {dayReleases.length > 2 && (
                        <div className="flex h-7 w-[18px] sm:h-8 sm:w-[22px] shrink-0 items-center justify-center rounded-[3px] bg-neutral-800/90 ring-1 ring-neutral-600/80">
                          <span className="text-[8px] font-bold text-neutral-400 tabular-nums">
                            +{dayReleases.length - 2}
                          </span>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

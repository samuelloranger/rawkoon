import { TFunction } from "i18next";

export const getMonthName = (t: TFunction, month: number) => {
  return [
    t("calendar.january"),
    t("calendar.february"),
    t("calendar.march"),
    t("calendar.april"),
    t("calendar.may"),
    t("calendar.june"),
    t("calendar.july"),
    t("calendar.august"),
    t("calendar.september"),
    t("calendar.october"),
    t("calendar.november"),
    t("calendar.december"),
  ][month];
};

export const getDayName = (t: TFunction, day: number) => {
  return [
    t("calendar.sunday"),
    t("calendar.monday"),
    t("calendar.tuesday"),
    t("calendar.wednesday"),
    t("calendar.thursday"),
    t("calendar.friday"),
    t("calendar.saturday"),
  ][day];
};

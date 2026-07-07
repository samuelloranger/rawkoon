export const formatGo = (value: number | null | undefined): string => {
  if (value == null || !Number.isFinite(value)) return "--";
  if (value >= 1000) {
    const to = value / 1000;
    const digits = to >= 100 ? 0 : to >= 10 ? 1 : 2;
    return `${to.toFixed(digits)} To`;
  }
  const digits = value >= 100 ? 0 : value >= 10 ? 1 : 2;
  return `${value.toFixed(digits)} Go`;
};

export const formatRatio = (value: number | null | undefined): string => {
  if (value == null || !Number.isFinite(value)) return "--";
  const digits = value >= 100 ? 0 : value >= 10 ? 1 : 2;
  return value.toFixed(digits);
};

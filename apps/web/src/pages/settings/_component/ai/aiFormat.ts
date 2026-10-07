export function formatCost(value: number | null): string {
  if (value == null) return "—";
  if (value === 0) return "$0.00";
  return value < 0.01 ? `$${value.toFixed(4)}` : `$${value.toFixed(2)}`;
}

export function formatTokens(value: number | null): string {
  if (value == null) return "—";
  return new Intl.NumberFormat(undefined, {
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(value);
}

export function formatMs(value: number | null): string {
  if (value == null) return "—";
  return value >= 1000
    ? `${(value / 1000).toFixed(1)} s`
    : `${Math.round(value)} ms`;
}

export function formatPercent(rate: number): string {
  return `${Number((rate * 100).toFixed(1))}%`;
}

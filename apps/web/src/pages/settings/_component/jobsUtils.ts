// ---------------------------------------------------------------------------
// Helpers (pure, no React)
// ---------------------------------------------------------------------------

export const getStatusColor = (status: string | null) => {
  switch (status) {
    case "active":
      return "text-blue-400 bg-blue-900/30";
    case "waiting":
      return "text-amber-400 bg-amber-900/30";
    case "failed":
      return "text-red-400 bg-red-900/30";
    case "completed":
      return "text-green-400 bg-green-900/30";
    default:
      return "text-gray-400 bg-gray-900/30";
  }
};

export function getLibraryHealthRunStatusColor(status: string) {
  switch (status) {
    case "success":
      return "text-green-400 bg-green-900/30";
    case "failed":
      return "text-red-400 bg-red-900/30";
    case "skipped":
      return "text-amber-400 bg-amber-900/30";
    default:
      return "text-gray-400 bg-gray-900/30";
  }
}

export function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  return `${(ms / 60_000).toFixed(1)}m`;
}

export function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const seconds = Math.floor(diff / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

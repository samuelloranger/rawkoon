import { formatDurationClockSeconds } from "@rawkoon/shared/utils";

export function formatClock(secs: number): string {
  return formatDurationClockSeconds(secs);
}

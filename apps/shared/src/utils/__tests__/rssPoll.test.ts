import { describe, expect, it } from "bun:test";
import {
  cronMinIntervalMinutes,
  DEFAULT_RSS_POLL_INTERVAL_MINUTES,
  isRssPollInterval,
  RSS_POLL_INTERVAL_MINUTES,
  rssPollCron,
} from "@rawkoon/shared/utils";

describe("rssPollCron", () => {
  it("keeps the default on the historical :07/:22/:37/:52 ticks", () => {
    expect(rssPollCron(DEFAULT_RSS_POLL_INTERVAL_MINUTES)).toBe(
      "7-59/15 * * * *",
    );
  });

  it.each([
    [5, "2-59/5 * * * *"],
    [10, "7-59/10 * * * *"],
    [30, "7-59/30 * * * *"],
    [60, "7 * * * *"],
  ] as const)("every %i minutes → %s", (minutes, cron) => {
    expect(rssPollCron(minutes)).toBe(cron);
  });

  it.each([...RSS_POLL_INTERVAL_MINUTES])(
    "fires exactly every %i minutes, including at :07",
    (minutes) => {
      const cron = rssPollCron(minutes);
      expect(cronMinIntervalMinutes(cron)).toBe(minutes);
      const start = Number(cron.split(/[- ]/)[0]);
      expect((7 - start) % minutes).toBe(0);
    },
  );
});

describe("isRssPollInterval", () => {
  it("accepts only the offered intervals", () => {
    expect(isRssPollInterval(5)).toBe(true);
    expect(isRssPollInterval(60)).toBe(true);
    expect(isRssPollInterval(7)).toBe(false);
    expect(isRssPollInterval("15")).toBe(false);
  });
});

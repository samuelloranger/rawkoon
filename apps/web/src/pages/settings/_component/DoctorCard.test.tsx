import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import type { DoctorReport } from "@rawkoon/shared/types";

const refetch = vi.fn();
let report: DoctorReport | undefined;

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}));
vi.mock("@/pages/settings/useDoctor", () => ({
  useDoctor: () => ({
    data: report,
    isFetching: false,
    isError: false,
    refetch,
  }),
}));

import { DoctorCard } from "./DoctorCard";

const check = (
  id: string,
  status: "ok" | "warn" | "fail",
  fix: string | null,
) => ({ id, title: id, status, summary: `${id} summary`, fix, duration_ms: 1 });

describe("DoctorCard", () => {
  it("runs on demand, not on mount", () => {
    report = undefined;
    render(<DoctorCard />);
    expect(refetch).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText("settings.health.doctor.run"));
    expect(refetch).toHaveBeenCalledOnce();
  });

  it("renders ok/warn/fail rows and the fix text only for non-ok rows", () => {
    report = {
      status: "fail",
      version: "1.0.0",
      checked_at: "2026-01-01T00:00:00.000Z",
      checks: [
        check("database", "ok", null),
        check("tmdb", "warn", "Set the TMDB key."),
        check("valkey", "fail", "Check the host."),
      ],
    };
    const { container } = render(<DoctorCard />);
    const statusOf = (id: string) =>
      container
        .querySelector(`[data-check="${id}"]`)
        ?.getAttribute("data-status");
    expect(statusOf("database")).toBe("ok");
    expect(statusOf("tmdb")).toBe("warn");
    expect(statusOf("valkey")).toBe("fail");
    expect(screen.getByText("Set the TMDB key.")).toBeTruthy();
    expect(screen.getByText("Check the host.")).toBeTruthy();
    expect(
      screen.getByText("settings.health.doctor.overall.fail"),
    ).toBeTruthy();
  });
});

import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { RequestButton } from "@/pages/medias/_component/RequestButton";

const mutate = vi.fn();
vi.mock("@/pages/requests/_hooks/useRequests", () => ({
  useCreateRequest: () => ({ mutate, isPending: false, isSuccess: false }),
}));

describe("RequestButton", () => {
  it("calls useCreateRequest with the media payload on click", () => {
    render(
      <RequestButton
        media={{
          tmdb_id: 9,
          type: "movie",
          title: "X",
          poster_url: null,
          year: 2020,
        }}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /request/i }));
    expect(mutate).toHaveBeenCalledWith({
      tmdb_id: 9,
      type: "movie",
      title: "X",
      poster_url: null,
      year: 2020,
    });
  });
});

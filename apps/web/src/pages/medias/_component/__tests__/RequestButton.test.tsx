import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { RequestButton } from "@/pages/medias/_component/RequestButton";

const request = vi.hoisted(() => vi.fn().mockResolvedValue(true));
vi.mock("@/features/add/useAddFlow", () => ({
  useAddFlow: () => ({ request }),
}));

const media = {
  tmdb_id: 9,
  type: "movie" as const,
  title: "X",
  poster_url: null,
  year: 2020,
};

describe("RequestButton", () => {
  it("hands the media payload to the add flow on click and shows Requested", async () => {
    render(<RequestButton media={media} />);
    fireEvent.click(screen.getByRole("button", { name: /request/i }));
    expect(request).toHaveBeenCalledWith(media);
    await waitFor(() =>
      expect(screen.getByRole("button")).toHaveTextContent(
        "requests.requested",
      ),
    );
    expect(screen.getByRole("button")).toBeDisabled();
  });

  it("stays requestable when the sheet is dismissed", async () => {
    request.mockResolvedValueOnce(false);
    render(<RequestButton media={media} />);
    fireEvent.click(screen.getByRole("button", { name: /request/i }));
    await waitFor(() => expect(request).toHaveBeenCalled());
    await waitFor(() => expect(screen.getByRole("button")).toBeEnabled());
  });
});

import { describe, it, expect } from "bun:test";
import {
  installMediaRequestMocks,
  state,
  useMediaRequestHooks,
} from "./mediaRequestsHarness";

installMediaRequestMocks();
const { approveRequest, createRequest } = await import(
  "@rawkoon/api/services/mediaRequests"
);

useMediaRequestHooks();

const showRequest = (over: Record<string, unknown> = {}) => ({
  id: 1,
  tmdbId: 10,
  type: "show",
  status: "pending",
  requestedById: "u1",
  libraryMediaId: null,
  title: "S",
  seasonMode: null,
  seasons: [] as number[],
  ...over,
});

const lastChoice = () =>
  state.addOpts.at(-1)?.seasonChoice as
    | {
        choice: { seasonMode: string; seasons?: number[] };
        monitorNewSeasons: boolean;
      }
    | undefined;

describe("createRequest season choice", () => {
  it("stores the requester's choice on the request", async () => {
    await createRequest({
      type: "show",
      tmdbId: 10,
      title: "S",
      posterUrl: null,
      year: null,
      userId: "u1",
      seasonMode: "pick",
      seasons: [2, 3],
    });
    expect(state.created[0]).toMatchObject({
      seasonMode: "pick",
      seasons: [2, 3],
    });
  });

  it("stores no choice when none is sent", async () => {
    await createRequest({
      type: "show",
      tmdbId: 10,
      title: "S",
      posterUrl: null,
      year: null,
      userId: "u1",
    });
    expect(state.created[0]).toMatchObject({ seasonMode: null, seasons: [] });
  });

  it("applies the stored choice when an admin's request is auto-approved", async () => {
    state.defaultProfiles = { movie: null, show: 1 };
    const r = await createRequest({
      type: "show",
      tmdbId: 10,
      title: "S",
      posterUrl: null,
      year: null,
      userId: "admin-1",
      autoApprove: true,
      seasonMode: "latest",
    });
    expect(r).toMatchObject({ ok: true, status: "approved" });
    expect(lastChoice()).toEqual({
      choice: { seasonMode: "latest", seasons: undefined },
      monitorNewSeasons: true,
    });
  });
});

describe("approveRequest season choice", () => {
  it("uses the request's stored choice when the admin sends none", async () => {
    state.requests = [showRequest({ seasonMode: "pick", seasons: [2] })];
    expect(await approveRequest(1, 1, "admin-1")).toMatchObject({ ok: true });
    expect(lastChoice()).toEqual({
      choice: { seasonMode: "pick", seasons: [2] },
      monitorNewSeasons: true,
    });
  });

  it("approves every season when nothing was chosen, whatever the default mode", async () => {
    state.settingsExtra = {
      defaultSeasonMode: "future",
      defaultMonitorNewSeasons: false,
    };
    state.requests = [showRequest()];
    await approveRequest(1, 1, "admin-1");
    expect(lastChoice()).toEqual({
      choice: { seasonMode: "all", seasons: undefined },
      monitorNewSeasons: false,
    });
  });

  it("lets the admin's own choice replace the stored one", async () => {
    state.requests = [showRequest({ seasonMode: "pick", seasons: [2] })];
    await approveRequest(1, 1, "admin-1", {
      seasonMode: "all",
      monitorNewSeasons: false,
    });
    expect(lastChoice()).toEqual({
      choice: { seasonMode: "all", seasons: undefined },
      monitorNewSeasons: false,
    });
  });

  it("rejects pick without seasons before adding anything", async () => {
    state.requests = [showRequest()];
    const r = await approveRequest(1, 1, "admin-1", { seasonMode: "pick" });
    expect(r).toMatchObject({ ok: false, reason: "invalid_seasons" });
    expect(state.addOpts).toHaveLength(0);
  });

  it("rejects season options on a movie request", async () => {
    state.requests = [showRequest({ type: "movie" })];
    const r = await approveRequest(1, 1, "admin-1", { seasonMode: "all" });
    expect(r).toMatchObject({ ok: false, reason: "invalid_seasons" });
  });

  it("passes no season choice for a movie approved the old way", async () => {
    state.requests = [showRequest({ type: "movie" })];
    expect(await approveRequest(1, 1, "admin-1")).toMatchObject({ ok: true });
    expect(lastChoice()).toBeUndefined();
  });
});

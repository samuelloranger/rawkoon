import { Hono } from "hono";
import { resolveActiveAdapter } from "@rawkoon/api/services/downloadClient/registry";
import { ok } from "@rawkoon/api/errors";
import type { Env } from "@rawkoon/api/honoEnv";
import { requireUser } from "@rawkoon/api/middleware/hono/auth";

export const dashboardDownloadsRoutes = new Hono<Env>()
  .use("*", requireUser)
  .get("/downloads/speed", async () => {
    const active = await resolveActiveAdapter();
    if (!active) {
      return ok({ enabled: false, connected: false, dl_speed: 0, ul_speed: 0 });
    }

    try {
      const torrents = await active.adapter.listTorrents();
      return ok({
        enabled: true,
        connected: true,
        dl_speed: torrents.reduce(
          (total, torrent) => total + Math.max(0, torrent.dlSpeed),
          0,
        ),
        ul_speed: 0,
      });
    } catch {
      return ok({ enabled: true, connected: false, dl_speed: 0, ul_speed: 0 });
    }
  });

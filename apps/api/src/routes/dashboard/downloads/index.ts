import { Elysia } from "elysia";
import { resolveActiveAdapter } from "@rawkoon/api/services/downloadClient/registry";
import { auth } from "@rawkoon/api/auth";
import { requireUser } from "@rawkoon/api/middleware/auth";

export const dashboardDownloadsRoutes = new Elysia()
  .use(auth)
  .use(requireUser)
  .get("/downloads/speed", async () => {
    const active = await resolveActiveAdapter();
    if (!active) {
      return { enabled: false, connected: false, dl_speed: 0, ul_speed: 0 };
    }

    try {
      const torrents = await active.adapter.listTorrents();
      return {
        enabled: true,
        connected: true,
        dl_speed: torrents.reduce(
          (total, torrent) => total + Math.max(0, torrent.dlSpeed),
          0,
        ),
        ul_speed: 0,
      };
    } catch {
      return { enabled: true, connected: false, dl_speed: 0, ul_speed: 0 };
    }
  });

import { Elysia } from "elysia";
import { getAppVersion } from "@rawkoon/api/services/versionService";

export const systemRoutes = new Elysia({ prefix: "/api/system" }).get(
  "/version",
  () => ({
    version: getAppVersion(),
  }),
);

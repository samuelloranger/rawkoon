import { Hono } from "hono";
import { z } from "zod";
import type { TranscodeJobStatus } from "@rawkoon/shared/types";
import { badRequest, notFound, ok, serverError } from "@rawkoon/api/errors";
import type { Env } from "@rawkoon/api/honoEnv";
import { requireAdmin } from "@rawkoon/api/middleware/hono/auth";
import { jsonV } from "@rawkoon/api/middleware/validate";
import { detectCapabilities } from "@rawkoon/api/services/transcode/capabilities";
import { estimateSelection } from "@rawkoon/api/services/transcode/estimateService";
import {
  buildSummary,
  cancelOrRemove,
  clearHistory,
  enqueueSelection,
  listJobs,
  moveBatchTop,
  moveJob,
  removeBatch,
  retryJob,
  updateQueueSettings,
} from "@rawkoon/api/services/transcode/queueApi";
import { loadQueueSettings } from "@rawkoon/api/services/transcode/repo";
import {
  enqueueBodySchema,
  estimateBodySchema,
  moveBodySchema,
  queueSettingsPatchSchema,
} from "@rawkoon/api/services/transcode/settingsSchema";

const STATUSES = new Set<TranscodeJobStatus>([
  "queued",
  "running",
  "done",
  "failed",
  "cancelled",
]);

function idParam(raw: string): number | null {
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/**
 * GET /capabilities · POST /estimate · POST|GET /jobs · DELETE /jobs/:id
 * POST /jobs/:id/move · POST /jobs/:id/retry · DELETE /batches/:id · POST /batches/:id/move
 * DELETE /history · GET|PATCH /settings · GET /summary
 */
export const transcodeRoutes = new Hono<Env>()
  .use("*", requireAdmin)

  .get("/capabilities", async () => {
    const c = await detectCapabilities();
    return ok({
      combos: c.combos,
      device_label: c.deviceLabel,
      vaapi_unavailable_reason: c.vaapiUnavailableReason,
    });
  })

  .post("/estimate", jsonV(estimateBodySchema), async (c) => {
    const b = c.req.valid("json");
    try {
      return ok(
        await estimateSelection(b.selection, b.settings, b.refine === true),
      );
    } catch (e) {
      console.error("[transcode] estimate failed:", e);
      return serverError("Estimate failed");
    }
  })

  .post("/jobs", jsonV(enqueueBodySchema), async (c) => {
    const b = c.req.valid("json");
    return ok(await enqueueSelection(b.selection, b.settings));
  })

  .get("/jobs", async (c) => {
    const raw = (c.req.query("status") ?? "queued,running").split(",");
    const statuses = raw.filter((s): s is TranscodeJobStatus =>
      STATUSES.has(s as TranscodeJobStatus),
    );
    if (!statuses.length) return badRequest("Invalid status filter");
    const since = c.req.query("since");
    return ok({
      jobs: await listJobs(statuses, since ? new Date(since) : undefined),
    });
  })

  .delete("/jobs/:id", async (c) => {
    const id = idParam(c.req.param("id"));
    if (!id) return badRequest("Invalid job id");
    const r = await cancelOrRemove(id);
    if (r === "not_found") return notFound("Job not found");
    if (r === "finished") return badRequest("Job already finished");
    return ok({ result: r });
  })

  .post("/jobs/:id/move", jsonV(moveBodySchema), async (c) => {
    const id = idParam(c.req.param("id"));
    if (!id) return badRequest("Invalid job id");
    return (await moveJob(id, c.req.valid("json")))
      ? ok({ moved: true })
      : notFound("Queued job not found");
  })

  .post("/jobs/:id/retry", async (c) => {
    const id = idParam(c.req.param("id"));
    if (!id) return badRequest("Invalid job id");
    return (await retryJob(id))
      ? ok({ retried: true })
      : notFound("Failed or cancelled job not found");
  })

  .delete("/batches/:batchId", async (c) =>
    ok({ removed: await removeBatch(c.req.param("batchId")) }),
  )

  .post(
    "/batches/:batchId/move",
    jsonV(z.object({ top: z.literal(true) })),
    async (c) => ok({ moved: await moveBatchTop(c.req.param("batchId")) }),
  )

  .delete("/history", async () => ok({ removed: await clearHistory() }))

  .get("/settings", async () => ok(await loadQueueSettings()))

  .patch("/settings", jsonV(queueSettingsPatchSchema), async (c) =>
    ok(await updateQueueSettings(c.req.valid("json"))),
  )

  .get("/summary", async () => ok(await buildSummary()));

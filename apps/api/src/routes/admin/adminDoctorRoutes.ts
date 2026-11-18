import { Hono } from "hono";
import { ok, serverError } from "@rawkoon/api/errors";
import type { Env } from "@rawkoon/api/honoEnv";
import { runDoctor } from "@rawkoon/api/services/doctor/runDoctor";

// Mounted under /api/admin; requireAdmin is applied at the admin parent.
// The DoctorReport is returned unwrapped — an MCP server re-exposes this
// exact JSON shape, so it is the contract.
export const adminDoctorRoutes = new Hono<Env>().get("/doctor", async () => {
  try {
    return ok(await runDoctor());
  } catch (error) {
    console.error("Error running doctor:", error);
    return serverError("Failed to run doctor");
  }
});

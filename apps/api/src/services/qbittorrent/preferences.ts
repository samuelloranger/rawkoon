import { qbFetchJson, qbFetchText } from "./clientFetch";
import type { QbittorrentIntegrationConfig } from "./clientTypes";
import { toStringOrNull } from "./clientNormalizers";

// Verified against live GET /api/v2/app/preferences on qBittorrent v4.6.7 and
// v5.0.4: both expose exactly these two keys for the on-finished hook.
//
// Both versions also expose autorun_on_torrent_added_enabled /
// autorun_on_torrent_added_program — a separate on-*added* hook. Do not touch
// those: firing on add would call Rawkoon before a single byte has landed.
const AUTORUN_ENABLED_KEY = "autorun_enabled";
const AUTORUN_PROGRAM_KEY = "autorun_program";

export type AutorunDecision = {
  action: "write" | "skip-foreign" | "noop";
  program: string;
};

/**
 * Decide whether we may write our autorun command.
 *
 * Ownership is detected by our hook path appearing in the existing string. That
 * doubles as the idempotency marker: our own stale command (say, after a token
 * rotation) is ours to replace, but anything else belongs to the user and is
 * left alone.
 */
export function decideAutorunUpdate(input: {
  current: string | null;
  desired: string;
  hookPath: string;
}): AutorunDecision {
  const current = input.current?.trim() ?? "";
  if (!current) return { action: "write", program: input.desired };
  if (current === input.desired.trim())
    return { action: "noop", program: current };
  if (current.includes(input.hookPath))
    return { action: "write", program: input.desired };
  return { action: "skip-foreign", program: current };
}

export async function getQbittorrentPreferences(
  config: QbittorrentIntegrationConfig,
): Promise<Record<string, unknown>> {
  return await qbFetchJson<Record<string, unknown>>(
    config,
    "/api/v2/app/preferences",
  );
}

/**
 * Read-only: does qBittorrent's autorun program belong to the user?
 *
 * Needed because a GET of the hook config must be able to report
 * `foreign-program` too. Without this the warning would surface only in the
 * response to a PUT and vanish on the next page load, while qBittorrent still
 * held the user's own command — the settings page would read as healthy.
 */
export async function isAutorunProgramForeign(
  config: QbittorrentIntegrationConfig,
  desiredCommand: string,
  hookPath: string,
): Promise<boolean> {
  const prefs = await getQbittorrentPreferences(config);
  return (
    decideAutorunUpdate({
      current: toStringOrNull(prefs[AUTORUN_PROGRAM_KEY]),
      desired: desiredCommand,
      hookPath,
    }).action === "skip-foreign"
  );
}

/**
 * Reconcile qBittorrent's autorun command with ours.
 *
 * The payload goes in the request body, never the query string: request bodies
 * are never logged, but `requestPath` and `meta.query` are persisted to
 * qbittorrent_request_logs, and the command contains the hook token.
 */
export async function applyQbittorrentAutorun(
  config: QbittorrentIntegrationConfig,
  desiredCommand: string,
  hookPath: string,
): Promise<{ action: AutorunDecision["action"] }> {
  const prefs = await getQbittorrentPreferences(config);
  const decision = decideAutorunUpdate({
    current: toStringOrNull(prefs[AUTORUN_PROGRAM_KEY]),
    desired: desiredCommand,
    hookPath,
  });

  if (decision.action === "skip-foreign") return { action: decision.action };

  const alreadyEnabled = prefs[AUTORUN_ENABLED_KEY] === true;
  if (decision.action === "noop" && alreadyEnabled) return { action: "noop" };

  const body = new URLSearchParams({
    json: JSON.stringify({
      [AUTORUN_ENABLED_KEY]: true,
      [AUTORUN_PROGRAM_KEY]: decision.program,
    }),
  });

  await qbFetchText(config, "/api/v2/app/setPreferences", {
    method: "POST",
    body,
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
  });

  return { action: "write" };
}

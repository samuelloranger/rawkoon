import { z } from "zod";
import { innerJson, innerRequest } from "./dispatcher";
import { capList } from "./shape";
import {
  asArray,
  asRecord,
  inner,
  num,
  str,
  ToolFailure,
  untrustedInline,
  type McpTool,
} from "./toolShared";

const requestTitleArgs = z
  .object({
    kind: z.enum(["movie", "show", "book"]),
    tmdb_id: z.number().int().positive().optional(),
    google_volume_id: z.string().min(1).optional(),
    title: z.string().min(1).optional(),
    year: z.number().int().optional(),
    quality_profile_id: z.number().int().positive().optional(),
    formats: z.array(z.enum(["ebook", "audiobook"])).optional(),
    seasons: z.array(z.number().int().positive()).optional(),
    season_mode: z.enum(["all", "future", "latest", "pick"]).optional(),
    confirm_token: z.string().optional(),
  })
  .superRefine((a, ctx) => {
    if (a.kind === "book" && !a.google_volume_id) {
      ctx.addIssue({
        code: "custom",
        message: "google_volume_id is required for books",
      });
    }
    if (a.kind !== "book" && !a.tmdb_id) {
      ctx.addIssue({
        code: "custom",
        message: "tmdb_id is required for movies and shows",
      });
    }
    if (a.kind !== "show" && a.seasons !== undefined) {
      ctx.addIssue({
        code: "custom",
        message: "seasons are only valid for shows",
      });
    }
  });

type RequestTitleArgs = z.infer<typeof requestTitleArgs>;

const CONFIRM_TOKEN_PROPERTY = {
  type: "string",
  description: "From the first call; performs the action.",
};

const requestTitleTool: McpTool = {
  name: "request_title",
  scope: "request",
  action: true,
  description:
    "Adds a title to Rawkoon or creates a request for it. An admin owner adds the title " +
    "directly to the library (optionally with a quality profile); any other owner creates a " +
    "request that an admin approves later. Pass tmdb_id for movies/shows (from search), " +
    "google_volume_id for books. This is a two-step ACTION tool: the first call returns a " +
    "confirm_token to show the person; call again with it to perform.",
  inputSchema: {
    type: "object",
    properties: {
      kind: { type: "string", enum: ["movie", "show", "book"] },
      tmdb_id: {
        type: "integer",
        description: "TMDB id (movies and shows), from the search tool.",
      },
      google_volume_id: {
        type: "string",
        description: "Google Books volume id (books), from the search tool.",
      },
      title: {
        type: "string",
        description:
          "Title as shown in search. Required for non-admin owners; always improves the confirmation summary.",
      },
      year: { type: "integer", description: "Release year, optional." },
      quality_profile_id: {
        type: "integer",
        description:
          "Quality profile id for the admin add path, from the quality_profiles tool (ignored for non-admin requests, where the approver picks it).",
      },
      formats: {
        type: "array",
        items: { type: "string", enum: ["ebook", "audiobook"] },
        description: "Book formats to add (admin path; default ebook).",
      },
      seasons: {
        type: "array",
        items: { type: "integer" },
        description:
          'Season numbers to request (shows with season_mode "pick").',
      },
      season_mode: {
        type: "string",
        enum: ["all", "future", "latest", "pick"],
        description:
          "Which seasons a show request covers (default: Rawkoon's add-dialog setting).",
      },
      confirm_token: CONFIRM_TOKEN_PROPERTY,
    },
    required: ["kind"],
  },
  args: requestTitleArgs,
  preflight(raw, ctx) {
    const args = raw as RequestTitleArgs;
    if (!ctx.owner.is_admin && !args.title) {
      return "A non-admin owner needs the title to create a request. Run search and pass the title.";
    }
    return null;
  },
  summarize(raw, ctx) {
    const args = raw as RequestTitleArgs;
    const quoted = args.title ? ` "${untrustedInline(args.title)}"` : "";
    const label =
      args.kind === "book" ? "book" : args.kind === "movie" ? "movie" : "show";
    const id =
      args.kind === "book"
        ? `Google volume ${args.google_volume_id}`
        : `TMDB id ${args.tmdb_id}`;
    const seasons =
      args.kind === "show" && args.seasons?.length
        ? ` for seasons ${args.seasons.join(", ")}`
        : "";
    const profile =
      args.quality_profile_id != null
        ? ` with quality profile ${args.quality_profile_id}`
        : "";
    // The two owner kinds cause different outcomes, and the person confirming
    // should know which one will happen.
    const adminSearch =
      args.kind === "book" ? "" : " and start a release search";
    return ctx.owner.is_admin
      ? `Add the ${label}${quoted} (${id}) to the Rawkoon library${seasons}${profile}${adminSearch}.`
      : `Create a request for the ${label}${quoted} (${id})${seasons}, pending an admin's approval.`;
  },
  async run(raw, ctx) {
    const args = requestTitleArgs.parse(raw) as RequestTitleArgs;

    if (args.kind === "book") {
      if (ctx.owner.is_admin) {
        const res = await inner(
          innerJson("/api/books", {
            google_volume_id: args.google_volume_id,
            ...(args.formats?.length ? { kinds: args.formats } : {}),
            ...(args.quality_profile_id != null
              ? { book_quality_profile_id: args.quality_profile_id }
              : {}),
          }),
          ctx.owner,
        );
        if (!res.ok) throw new ToolFailure(res.text);
        const item = asRecord(asRecord(res.body).item);
        return {
          added: true,
          book_id: num(item.id),
          title: str(item.title),
          formats: args.formats?.length ? args.formats : ["ebook"],
        };
      }
      if (!args.title) {
        throw new ToolFailure(
          "A non-admin owner needs the book's title to create a request. Run search and pass the title.",
        );
      }
      const res = await inner(
        innerJson("/api/requests", {
          type: "book",
          google_volume_id: args.google_volume_id,
          title: args.title,
          ...(args.year != null ? { year: args.year } : {}),
        }),
        ctx.owner,
      );
      if (!res.ok) throw new ToolFailure(res.text);
      return { requested: true, request_id: asRecord(res.body).id };
    }

    if (ctx.owner.is_admin) {
      const res = await inner(
        innerJson("/api/library", {
          tmdb_id: args.tmdb_id,
          type: args.kind,
          search_on_add: true,
          ...(args.quality_profile_id != null
            ? { quality_profile_id: args.quality_profile_id }
            : {}),
          ...(args.kind === "show"
            ? {
                ...(args.seasons !== undefined
                  ? { seasons: args.seasons }
                  : {}),
                ...(args.season_mode !== undefined
                  ? { season_mode: args.season_mode }
                  : {}),
              }
            : {}),
        }),
        ctx.owner,
      );
      if (!res.ok) throw new ToolFailure(res.text);
      const body = asRecord(res.body);
      const item = asRecord(body.item);
      return {
        added: true,
        library_id: num(item.id),
        title: str(item.title),
        status: str(item.status),
        search_queued: body.search_queued === true,
      };
    }

    if (!args.title) {
      throw new ToolFailure(
        "A non-admin owner needs the title to create a request. Run search and pass the title.",
      );
    }
    const res = await inner(
      innerJson("/api/requests", {
        type: args.kind,
        tmdb_id: args.tmdb_id,
        title: args.title,
        ...(args.year != null ? { year: args.year } : {}),
        ...(args.kind === "show"
          ? {
              ...(args.seasons !== undefined ? { seasons: args.seasons } : {}),
              ...(args.season_mode !== undefined
                ? { season_mode: args.season_mode }
                : {}),
            }
          : {}),
      }),
      ctx.owner,
    );
    if (!res.ok) throw new ToolFailure(res.text);
    return { requested: true, request_id: asRecord(res.body).id };
  },
};

const pendingRequestsTool: McpTool = {
  name: "pending_requests",
  scope: "approve",
  action: false,
  description:
    "Lists title requests awaiting approval, with who requested them and which " +
    "seasons they want. Use it before decide_request. Seeing everyone's requests " +
    "requires an admin owner (a non-admin owner only sees their own).",
  inputSchema: { type: "object", properties: {} },
  args: z.object({}),
  async run(_raw, ctx) {
    const res = await inner(innerRequest("/api/requests"), ctx.owner);
    if (!res.ok) throw new ToolFailure(res.text);
    const requests = asArray(asRecord(res.body).requests);
    const pending = requests
      .filter((item) => asRecord(item).status === "pending")
      .map((item) => {
        const r = asRecord(item);
        return {
          id: num(r.id),
          title: str(r.title),
          kind: str(r.type),
          year: num(r.year),
          tmdb_id: num(r.tmdb_id),
          google_volume_id: str(r.google_volume_id),
          author: str(r.author),
          requested_by: asRecord(r.requested_by).name,
          seasons: r.seasons,
          season_mode: str(r.season_mode),
          quality_profile_id: num(r.quality_profile_id),
          created_at: str(r.created_at),
        };
      });
    return capList(pending);
  },
};

const decideRequestArgs = z
  .object({
    request_id: z.number().int().positive(),
    decision: z.enum(["approve", "deny"]),
    quality_profile_id: z.number().int().positive().optional(),
    reason: z.string().optional(),
    confirm_token: z.string().optional(),
  })
  .refine((a) => a.decision === "deny" || a.quality_profile_id != null, {
    message: "quality_profile_id is required to approve",
  });

type DecideRequestArgs = z.infer<typeof decideRequestArgs>;

const decideRequestTool: McpTool = {
  name: "decide_request",
  scope: "approve",
  action: true,
  description:
    "Approves or denies one pending title request (by its id from pending_requests). " +
    "Approving needs a quality profile id (list them with quality_profiles); denying accepts a reason. Requires an admin owner. " +
    "This is a two-step ACTION tool: the first call returns a confirm_token to show the person; " +
    "call again with it to perform.",
  inputSchema: {
    type: "object",
    properties: {
      request_id: { type: "integer", description: "The pending request's id." },
      decision: { type: "string", enum: ["approve", "deny"] },
      quality_profile_id: {
        type: "integer",
        description:
          "Quality profile id to add the title with (approvals), from the quality_profiles tool.",
      },
      reason: { type: "string", description: "Why it was denied (optional)." },
      confirm_token: CONFIRM_TOKEN_PROPERTY,
    },
    required: ["request_id", "decision"],
  },
  args: decideRequestArgs,
  preflight(_raw, ctx) {
    return ctx.owner.is_admin
      ? null
      : "Approving or denying requests needs an admin owner; this API key's owner is not an admin.";
  },
  async summarize(raw, ctx) {
    const args = raw as DecideRequestArgs;
    // Names are a best-effort nicety: a failed lookup falls back to ids.
    const [requests, profiles] = await Promise.all([
      inner(innerRequest("/api/requests"), ctx.owner),
      args.decision === "approve"
        ? inner(innerRequest("/api/quality-profiles"), ctx.owner)
        : null,
    ]);
    const found = requests.ok
      ? asArray(asRecord(requests.body).requests).find(
          (r) => asRecord(r).id === args.request_id,
        )
      : undefined;
    // Approve/deny only accept pending requests; don't issue a token that can only fail.
    if (requests.ok) {
      if (!found) {
        throw new ToolFailure(
          `Request ${args.request_id} doesn't exist (see pending_requests).`,
        );
      }
      const status = str(asRecord(found).status);
      if (status !== "pending") {
        throw new ToolFailure(
          `Request ${args.request_id} is ${status ?? "not pending"}; only pending requests can be approved or denied.`,
        );
      }
    }
    const rawTitle = str(asRecord(found).title);
    // The requester wrote this title; keep it from steering the approver's agent.
    const title = rawTitle ? untrustedInline(rawTitle) : null;
    const subject = title
      ? `request ${args.request_id} ("${title}")`
      : `request ${args.request_id}`;
    if (args.decision === "approve") {
      const profile =
        profiles?.ok === true
          ? asArray(asRecord(profiles.body).profiles).find(
              (p) => asRecord(p).id === args.quality_profile_id,
            )
          : undefined;
      const rawName = str(asRecord(profile).name);
      const profileName = rawName ? untrustedInline(rawName) : null;
      return `Approve ${subject} and add the title to the library with quality profile ${args.quality_profile_id}${profileName ? ` ("${profileName}")` : ""}.`;
    }
    return args.reason
      ? `Deny ${subject} with the reason "${args.reason}".`
      : `Deny ${subject}.`;
  },
  async run(raw, ctx) {
    const args = decideRequestArgs.parse(raw) as DecideRequestArgs;
    const id = String(args.request_id);

    if (args.decision === "approve") {
      const res = await inner(
        innerJson(`/api/requests/${id}/approve`, {
          quality_profile_id: args.quality_profile_id,
        }),
        ctx.owner,
      );
      if (!res.ok) throw new ToolFailure(res.text);
      return {
        decided: "approved",
        request_id: args.request_id,
        ...asRecord(res.body),
      };
    }

    const res = await inner(
      innerJson(`/api/requests/${id}/deny`, {
        ...(args.reason ? { deny_reason: args.reason } : {}),
      }),
      ctx.owner,
    );
    if (!res.ok) throw new ToolFailure(res.text);
    return {
      decided: "denied",
      request_id: args.request_id,
      ...(args.reason ? { reason: args.reason } : {}),
    };
  },
};

const cancelRequestArgs = z.object({
  request_id: z.number().int().positive(),
  confirm_token: z.string().optional(),
});

type CancelRequestArgs = z.infer<typeof cancelRequestArgs>;

/**
 * The owner's own pending or denied request, or a ToolFailure. Kept to the
 * owner's requests even for admins: removing someone else's is decide_request's
 * job, which sits behind the approve scope.
 */
async function ownWithdrawableRequest(
  requestId: number,
  ctx: Parameters<NonNullable<McpTool["summarize"]>>[1],
): Promise<Record<string, unknown>> {
  const res = await inner(innerRequest("/api/requests"), ctx.owner);
  if (!res.ok) throw new ToolFailure(res.text);
  const found = asArray(asRecord(res.body).requests)
    .map(asRecord)
    .find(
      (r) => r.id === requestId && asRecord(r.requested_by).id === ctx.owner.id,
    );
  if (!found) {
    throw new ToolFailure(
      `Request ${requestId} isn't one of your requests (see my_requests).`,
    );
  }
  if (found.status !== "pending" && found.status !== "denied") {
    throw new ToolFailure(
      `Request ${requestId} is ${String(found.status)}; only pending or denied requests can be withdrawn.`,
    );
  }
  return found;
}

const cancelRequestTool: McpTool = {
  name: "cancel_request",
  scope: "request",
  action: true,
  description:
    "Withdraws (deletes) one of the API key owner's own title requests, by its id from my_requests. " +
    "Only pending or denied requests can be withdrawn; to turn down someone else's request use decide_request. " +
    "This is a two-step ACTION tool: the first call returns a confirm_token to show the person; " +
    "call again with it to perform.",
  inputSchema: {
    type: "object",
    properties: {
      request_id: {
        type: "integer",
        description: "The request's id, from my_requests.",
      },
      confirm_token: CONFIRM_TOKEN_PROPERTY,
    },
    required: ["request_id"],
  },
  args: cancelRequestArgs,
  async summarize(raw, ctx) {
    const args = raw as CancelRequestArgs;
    const found = await ownWithdrawableRequest(args.request_id, ctx);
    const rawTitle = str(found.title);
    const title = rawTitle ? untrustedInline(rawTitle) : null;
    return title
      ? `Withdraw request ${args.request_id} ("${title}").`
      : `Withdraw request ${args.request_id}.`;
  },
  async run(raw, ctx) {
    const args = cancelRequestArgs.parse(raw) as CancelRequestArgs;
    await ownWithdrawableRequest(args.request_id, ctx);
    const res = await inner(
      innerRequest(`/api/requests/${args.request_id}`, { method: "DELETE" }),
      ctx.owner,
    );
    if (!res.ok) throw new ToolFailure(res.text);
    return { cancelled: true, request_id: args.request_id };
  },
};

export const actionTools: McpTool[] = [
  requestTitleTool,
  cancelRequestTool,
  pendingRequestsTool,
  decideRequestTool,
];

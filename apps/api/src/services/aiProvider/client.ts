import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { APICallError, generateObject } from "ai";
import { z } from "zod";
import { getIntegrationConfigRecord } from "@rawkoon/api/services/integrationConfigCache";
import { normalizeAiProviderConfig } from "@rawkoon/api/utils/integrations/normalizers";
import type { AiProviderConfig } from "@rawkoon/api/utils/integrations/types";
import {
  AI_SYSTEM_PROMPT,
  buildAiPickPrompt,
  type AiPickMediaContext,
  type AiPickRelease,
} from "@rawkoon/api/utils/medias/buildAiPickPrompt";
import {
  gateAiCall,
  noteAiSpend,
} from "@rawkoon/api/services/aiProvider/aiGate";
import {
  AI_BOOK_SYSTEM_PROMPT,
  buildAiBookPickPrompt,
  type AiBookPickContext,
  type AiBookPickRelease,
} from "@rawkoon/api/utils/books/buildAiBookPickPrompt";
import {
  isRateLimited,
  recordAiCall,
  sanitizeAiError,
  type AiCallContext,
} from "@rawkoon/api/services/aiProvider/usageLedger";

export type AiPickResult = {
  release_key: string;
  reasoning: string;
};

/** What differs per domain; everything else in this file is shared. */
type PickPrompt<R extends AiPickRelease> = {
  system: string;
  build: (releases: R[]) => string;
};

const pickSchema = z.object({
  release_key: z.string(),
  reasoning: z.string(),
});

type RawPick = z.infer<typeof pickSchema>;

export async function loadEnabledAiProviderConfig(): Promise<AiProviderConfig | null> {
  const record = await getIntegrationConfigRecord("ai-provider");
  if (!record?.enabled) return null;
  return normalizeAiProviderConfig(record?.config);
}

function truncateAtWord(str: string, max: number): string {
  if (str.length <= max) return str;
  const cut = str.slice(0, max);
  const lastSpace = cut.lastIndexOf(" ");
  return lastSpace > 0 ? cut.slice(0, lastSpace) : cut;
}

/** The schema guarantees shape, not truth: a local model can invent a release_key, so check membership. */
export function validateAiPick(
  pick: RawPick,
  candidates: Pick<AiPickRelease, "key">[],
): AiPickResult | null {
  if (!candidates.some((r) => r.key === pick.release_key)) return null;

  return {
    release_key: pick.release_key,
    reasoning: truncateAtWord(pick.reasoning, 150),
  };
}

/** Cap on releases shown to the judge; a long indexer list overflows a small model's context and the tail can't change the answer. */
const AI_MAX_CANDIDATES = 10;

type Shortlist<R extends AiPickRelease> = {
  releases: R[];
  /** Opaque id -> the real release key, which never leaves this process. */
  keyById: Map<string, string>;
};

/** Anonymises keys as `r0`..`rN` (the download URL carries tracker credentials) and drops zero-seeder releases, which small models wrongly kept; null seeders means unknown. */
function buildShortlist<R extends AiPickRelease>(releases: R[]): Shortlist<R> {
  const viable = releases.filter((r) => r.seeders == null || r.seeders > 0);
  const keyById = new Map<string, string>();

  const anonymised = [...viable]
    .sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
    .slice(0, AI_MAX_CANDIDATES)
    .map((release, i) => {
      const id = `r${i}`;
      keyById.set(id, release.key);
      return { ...release, key: id };
    });

  return { releases: anonymised, keyById };
}

const FENCE_RE = /^\s*```(?:json)?\s*([\s\S]*?)\s*```\s*$/i;

type ChatCompletionPayload = {
  choices?: Array<{ message?: { content?: string } }>;
};

/** The SDK types fetch as `typeof globalThis.fetch`, which under Bun has a `preconnect` no plain function supplies, hence the cast. */
type ProviderFetch = NonNullable<
  Parameters<typeof createOpenAICompatible>[0]["fetch"]
>;

/** Servers that ignore response_format still wrap JSON in a markdown fence, which the SDK parser rejects. */
const stripFencedContent = async (
  input: Parameters<typeof fetch>[0],
  init?: Parameters<typeof fetch>[1],
): Promise<Response> => {
  const res = await fetch(input, init);
  if (!res.ok) return res;

  // Cheap substring test first: fences are rare, so avoid parsing every body twice.
  const raw = await res.clone().text();
  if (!raw.includes("```")) return res;

  const payload = JSON.parse(raw) as ChatCompletionPayload;
  const message = payload.choices?.[0]?.message;
  if (typeof message?.content !== "string") return res;

  const unfenced = message.content.match(FENCE_RE)?.[1];
  if (unfenced === undefined) return res;

  message.content = unfenced;
  return new Response(JSON.stringify(payload), {
    status: res.status,
    headers: res.headers,
  });
};

/** Endpoints that reject json_schema, so the two-request probe is paid once. */
const schemaUnsupported = new Set<string>();

async function generatePick<R extends AiPickRelease>(
  config: AiProviderConfig,
  prompt: PickPrompt<R>,
  releases: R[],
  structured: boolean,
): Promise<{ object: RawPick; usage: GenerateUsage }> {
  const provider = createOpenAICompatible({
    name: "ai-provider",
    baseURL: `${config.base_url}/v1`,
    ...(config.api_key ? { apiKey: config.api_key } : {}),
    // true sends a json_schema response_format (a grammar on llama.cpp); false sends json_object.
    supportsStructuredOutputs: structured,
    fetch: stripFencedContent as ProviderFetch,
  });

  const { object, usage } = await generateObject({
    model: provider(config.model),
    schema: pickSchema,
    system: prompt.system,
    prompt: prompt.build(releases),
    temperature: 0.1,
    // Classic scoring covers failure and this runs in the grab path, so fail fast.
    maxRetries: 0,
    abortSignal: AbortSignal.timeout(30_000),
  });

  return { object, usage };
}

type GenerateUsage = {
  inputTokens: number | undefined;
  outputTokens: number | undefined;
  totalTokens: number | undefined;
};

/** One HTTP attempt, one ledger row, even on error; a throw is re-raised for the json_object fallback. */
async function attemptPick<R extends AiPickRelease>(
  config: AiProviderConfig,
  prompt: PickPrompt<R>,
  shortlist: Shortlist<R>,
  structured: boolean,
  ctx: AiCallContext,
): Promise<AiPickResult | null> {
  const started = performance.now();
  const base = { ctx, model: config.model, structured };

  let generated: Awaited<ReturnType<typeof generatePick>>;
  try {
    generated = await generatePick(
      config,
      prompt,
      shortlist.releases,
      structured,
    );
  } catch (error) {
    recordAiCall({
      ...base,
      status: isRateLimited(error) ? "rate_limited" : "error",
      error: sanitizeAiError(error, config.api_key),
      durationMs: performance.now() - started,
    });
    throw error;
  }

  const durationMs = performance.now() - started;
  const resolved = resolveKey(
    validateAiPick(generated.object, shortlist.releases),
    shortlist,
  );
  const pickedTitle = resolved
    ? shortlist.releases.find((r) => r.key === generated.object.release_key)
        ?.title
    : undefined;
  noteAiSpend(generated.usage);
  recordAiCall({
    ...base,
    status: resolved ? "ok" : "invalid_pick",
    agreedWithClassic:
      pickedTitle !== undefined && ctx.classicTitle !== undefined
        ? pickedTitle === ctx.classicTitle
        : undefined,
    usage: generated.usage,
    durationMs,
    ...(resolved
      ? {
          pickedTitle,
          reasoning: resolved.reasoning,
        }
      : { reasoning: truncateAtWord(generated.object.reasoning, 150) }),
  });
  return resolved;
}

/** Only "don't understand this request" statuses justify remembering a downgrade; auth and quota errors are about the caller. */
const SCHEMA_REJECTED_STATUSES = new Set([400, 404, 422, 501]);

function isSchemaRejection(error: unknown): boolean {
  if (!APICallError.isInstance(error)) return false;
  return SCHEMA_REJECTED_STATUSES.has(error.statusCode ?? 0);
}

/** Maps the opaque id back to the release key, including ids the model quoted in its user-visible reasoning. */
function resolveKey<R extends AiPickRelease>(
  pick: AiPickResult | null,
  shortlist: Shortlist<R>,
): AiPickResult | null {
  if (!pick) return null;
  const key = shortlist.keyById.get(pick.release_key);
  if (!key) return null;

  const reasoning = shortlist.releases.reduce(
    (text, r) => text.replaceAll(r.key, r.title),
    pick.reasoning,
  );

  return {
    release_key: key,
    reasoning: truncateAtWord(reasoning, 150),
  };
}

async function pickWithAi<R extends AiPickRelease>(
  config: AiProviderConfig,
  prompt: PickPrompt<R>,
  releases: R[],
  ctx: AiCallContext,
): Promise<AiPickResult | null> {
  if (releases.length === 0) return null;

  // Before any provider HTTP: disabled features and spent budgets fall back to classic.
  const gate = await gateAiCall(config, ctx).catch((error: unknown) => {
    console.warn("[aiProvider] gate check failed, using classic pick:", error);
    return { allowed: false as const };
  });
  if (!gate.allowed) return null;

  // Shortlist here, not per caller: the interactive-search route passes the raw indexer result.
  const shortlist = buildShortlist(releases);
  if (shortlist.releases.length === 0) return null;

  const endpoint = `${config.base_url}|${config.model}`;
  const structured = !schemaUnsupported.has(endpoint);

  try {
    return await attemptPick(config, prompt, shortlist, structured, ctx);
  } catch (error) {
    // Already on the weaker mode, so there is nothing left to downgrade to.
    if (!structured) return null;

    // Not every OpenAI-compatible server implements json_schema; retry once without it.
    try {
      const result = await attemptPick(config, prompt, shortlist, false, ctx);
      if (isSchemaRejection(error)) schemaUnsupported.add(endpoint);
      return result;
    } catch {
      return null;
    }
  }
}

export function pickReleaseWithAi(
  config: AiProviderConfig,
  media: AiPickMediaContext,
  releases: AiPickRelease[],
  ctx: AiCallContext,
): Promise<AiPickResult | null> {
  return pickWithAi(
    config,
    {
      system: AI_SYSTEM_PROMPT,
      build: (shortlisted) => buildAiPickPrompt(media, shortlisted),
    },
    releases,
    ctx,
  );
}

export function pickBookReleaseWithAi(
  config: AiProviderConfig,
  book: AiBookPickContext,
  releases: AiBookPickRelease[],
  ctx: AiCallContext,
): Promise<AiPickResult | null> {
  return pickWithAi(
    config,
    {
      system: AI_BOOK_SYSTEM_PROMPT,
      build: (shortlisted) => buildAiBookPickPrompt(book, shortlisted),
    },
    releases,
    ctx,
  );
}

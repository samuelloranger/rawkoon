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

export type AiPickResult = {
  release_key: string;
  reasoning: string;
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

/**
 * The schema guarantees shape, not truth: a local model will happily invent a
 * release_key, so membership in the candidate set is still checked here.
 */
export function validateAiPick(
  pick: RawPick,
  candidates: AiPickRelease[],
): AiPickResult | null {
  if (!candidates.some((r) => r.key === pick.release_key)) return null;

  return {
    release_key: pick.release_key,
    reasoning: truncateAtWord(pick.reasoning, 150),
  };
}

/**
 * Releases shown to the judge. An unfiltered indexer result set runs to
 * thousands of tokens, which is enough to overflow a small model's context
 * outright and slow even when it fits, since prompt processing dominates the
 * call. The prompt ranks on score anyway, so the tail of the list can only
 * spend budget, never change the answer.
 */
const AI_MAX_CANDIDATES = 10;

type Shortlist = {
  releases: AiPickRelease[];
  /** Opaque id -> the real release key, which never leaves this process. */
  keyById: Map<string, string>;
};

/**
 * Picks the releases worth asking about and strips their identity.
 *
 * A release key is the indexer download URL, which carries tracker apikey and
 * token query params — 79% of the prompt by size on a measured search, and
 * credentials we will not hand to a model that may be hosted. The judge only
 * needs to name a choice, so it gets `r0`..`rN` and we map back here.
 *
 * Zero-seeder releases are dropped rather than described: rule (1) of the
 * prompt is a mechanical filter, and a small model reliably violated it when the
 * dead release also held the top score. `null` seeders means unknown (usenet),
 * which the classic scorer never rejects either.
 */
function buildShortlist(releases: AiPickRelease[]): Shortlist {
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

/**
 * The SDK types its fetch slot as `typeof globalThis.fetch`, which under Bun
 * carries a `preconnect` property no plain function can supply — hence the cast
 * where this is handed to the provider.
 */
type ProviderFetch = NonNullable<
  Parameters<typeof createOpenAICompatible>[0]["fetch"]
>;

/**
 * base_url can point at any OpenAI-compatible server, and the ones that ignore
 * response_format still wrap their JSON in a markdown fence. The SDK's parser
 * rejects that, so unwrap it before it gets there.
 */
const stripFencedContent = async (
  input: Parameters<typeof fetch>[0],
  init?: Parameters<typeof fetch>[1],
): Promise<Response> => {
  const res = await fetch(input, init);
  if (!res.ok) return res;

  // Cheap substring test first: fences are rare, and this avoids parsing every
  // response body a second time just to find there was nothing to unwrap.
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

/**
 * Backends that reject json_schema, remembered per endpoint so the two-request
 * probe is paid once rather than on every grab.
 */
const schemaUnsupported = new Set<string>();

async function generatePick(
  config: AiProviderConfig,
  media: AiPickMediaContext,
  releases: AiPickRelease[],
  structured: boolean,
): Promise<RawPick> {
  const provider = createOpenAICompatible({
    name: "ai-provider",
    baseURL: `${config.base_url}/v1`,
    ...(config.api_key ? { apiKey: config.api_key } : {}),
    // true sends the schema as a json_schema response_format, which llama.cpp
    // turns into a grammar constraint; false sends a plain json_object.
    supportsStructuredOutputs: structured,
    fetch: stripFencedContent as ProviderFetch,
  });

  const { object } = await generateObject({
    model: provider(config.model),
    schema: pickSchema,
    system: AI_SYSTEM_PROMPT,
    prompt: buildAiPickPrompt(media, releases),
    temperature: 0.1,
    // This runs inside the grab path and classic scoring already covers
    // failure, so fail fast rather than retry with the SDK's default backoff.
    maxRetries: 0,
    abortSignal: AbortSignal.timeout(30_000),
  });

  return object;
}

/**
 * Only statuses meaning "I don't understand this request" justify remembering a
 * downgrade. Auth and quota failures (401/403/429) are about the caller, not the
 * schema, and must not strip a capable endpoint of structured output for good.
 */
const SCHEMA_REJECTED_STATUSES = new Set([400, 404, 422, 501]);

function isSchemaRejection(error: unknown): boolean {
  if (!APICallError.isInstance(error)) return false;
  return SCHEMA_REJECTED_STATUSES.has(error.statusCode ?? 0);
}

/**
 * Swaps the opaque id back for the real release key, and rewrites any id the
 * model quoted in its reasoning — that text is shown to the user, and small
 * models keep saying "r2" however the prompt is worded.
 */
function resolveKey(
  pick: AiPickResult | null,
  shortlist: Shortlist,
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

export async function pickReleaseWithAi(
  config: AiProviderConfig,
  media: AiPickMediaContext,
  releases: AiPickRelease[],
): Promise<AiPickResult | null> {
  if (releases.length === 0) return null;

  // Every caller is shortlisted here rather than at its own call site: the
  // interactive-search route hands over whatever the indexer returned.
  const shortlist = buildShortlist(releases);
  if (shortlist.releases.length === 0) return null;

  const endpoint = `${config.base_url}|${config.model}`;
  const structured = !schemaUnsupported.has(endpoint);

  try {
    return resolveKey(
      validateAiPick(
        await generatePick(config, media, shortlist.releases, structured),
        shortlist.releases,
      ),
      shortlist,
    );
  } catch (error) {
    // Already on the weaker mode, so there is nothing left to downgrade to.
    if (!structured) return null;

    // base_url is user-supplied and not every OpenAI-compatible server
    // implements json_schema; retry once the way the pre-SDK client asked.
    try {
      const object = await generatePick(
        config,
        media,
        shortlist.releases,
        false,
      );
      if (isSchemaRejection(error)) schemaUnsupported.add(endpoint);
      return resolveKey(validateAiPick(object, shortlist.releases), shortlist);
    } catch {
      return null;
    }
  }
}

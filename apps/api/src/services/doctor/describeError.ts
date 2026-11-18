/**
 * One-line, credential-free causes for failed probes. Doctor summaries must
 * name the real problem, but never echo an API key, a password, or a URL with
 * credentials — `endpointLabel` and the redaction in the fallback keep that
 * guarantee even when an error message contains them.
 */

/** Thrown by doctor probes when an endpoint answered, but not with a 2xx. */
export class HttpStatusError extends Error {
  constructor(readonly status: number) {
    super(`HTTP ${status}`);
    this.name = "HttpStatusError";
  }
}

/** "host:port" of a configured URL — never credentials. */
export function endpointLabel(rawUrl: string): string {
  try {
    return new URL(rawUrl).host;
  } catch {
    return "the configured address";
  }
}

function httpSummary(status: number): string {
  if (status === 401 || status === 403) {
    return `the server rejected the request (HTTP ${status}) — the API key is likely invalid`;
  }
  if (status === 404) {
    return "the server answered 404 — the base URL or path is wrong";
  }
  if (status === 429) {
    return "the server rate-limited the request (HTTP 429)";
  }
  if (status >= 500) {
    return `the server errored (HTTP ${status})`;
  }
  return `the server answered HTTP ${status}`;
}

// fetch (and Prisma) wrap the interesting error in `cause`; walk the chain.
function causes(error: unknown, depth = 5): unknown[] {
  const chain: unknown[] = [];
  let current: unknown = error;
  while (current && chain.length <= depth) {
    chain.push(current);
    current = (current as { cause?: unknown }).cause;
  }
  return chain;
}

/** Strips user:pass@ and query-string secrets so a cause never echoes one. */
function redact(text: string): string {
  return text
    .replace(/([a-z][a-z0-9+.-]*:\/\/)[^\s@/:]+:[^\s@/]+@/gi, "$1***@")
    .replace(/\b(api_key|apikey|access_token|token)=([^&\s"']+)/gi, "$1=***");
}

function shortMessage(text: string, max = 120): string {
  const clean = redact(text).replace(/\s+/g, " ").trim();
  return clean.length <= max ? clean : `${clean.slice(0, max - 1)}…`;
}

/** Classifies a probe error into a plain-English cause (DNS, refused, timeout, TLS, HTTP…). */
export function describeError(error: unknown): string {
  for (const cause of causes(error)) {
    if (cause instanceof HttpStatusError) return httpSummary(cause.status);
    const e = cause as { name?: unknown; message?: unknown; code?: unknown };
    const name = typeof e.name === "string" ? e.name : "";
    const message = typeof e.message === "string" ? e.message : "";
    const code = typeof e.code === "string" ? e.code : "";

    if (
      name === "TimeoutError" ||
      code === "ETIMEDOUT" ||
      /\btimed out\b/i.test(message)
    ) {
      return "timed out";
    }
    if (code === "ENOTFOUND" || code === "EAI_AGAIN") {
      return "DNS lookup failed — the hostname does not resolve";
    }
    if (code === "ECONNREFUSED") {
      return "connection refused — nothing is listening on that host and port";
    }
    if (code === "ECONNRESET") {
      return "the connection was reset mid-request";
    }
    if (code === "ENETUNREACH" || code === "EHOSTUNREACH") {
      return "no route to that host from this container";
    }
    if (code === "EACCES" || code === "EPERM") {
      return "the OS denied permission";
    }
    if (
      code.startsWith("ERR_TLS") ||
      code.includes("CERT") ||
      /certificate/i.test(message)
    ) {
      return `TLS handshake failed (${shortMessage(message)})`;
    }
    if (name === "AbortError") {
      return "the request was aborted before it finished";
    }
  }
  const message = error instanceof Error ? error.message : String(error);
  return shortMessage(message) || "unknown error";
}

import type { ConnectionTestResult } from "@rawkoon/shared/types";
import { HttpError } from "@/lib/api/httpClient";

/**
 * Text for a failed "Test connection": a translated lead-in for the cause plus
 * the server's own message. Accepts a result body or an HttpError whose body
 * carries the same fields; falls back to `fallback` for servers that predate them.
 */
export function connectionFailureText(
  t: (key: string) => string,
  source: ConnectionTestResult | unknown,
  fallback: string,
): string {
  const body = (source instanceof HttpError ? source.data : source) as
    | ConnectionTestResult
    | null
    | undefined;
  if (!body?.cause || !body.message) {
    const legacy =
      source instanceof HttpError ? source.apiError() : body?.error;
    return legacy ?? fallback;
  }
  return `${t(`settings.integrations.cause.${body.cause}`)} — ${body.message}`;
}

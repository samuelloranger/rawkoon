/**
 * fetch() that times out unless the caller already passed a signal.
 */
export function fetchWithTimeout(
  input: string | URL | Request,
  init: RequestInit | undefined,
  timeoutMs: number,
): Promise<Response> {
  return fetch(input, {
    ...init,
    signal: init?.signal ?? AbortSignal.timeout(timeoutMs),
  });
}

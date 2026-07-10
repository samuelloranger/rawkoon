# Web API client

## Default: use the shared HTTP client

Web application data access goes through the shared client in
<code>apps/web/src/lib/api</code>, via <code>useFetcher</code>,
<code>webFetcher</code>, or <code>fetchApi</code>. Do not hand-roll
<code>fetch</code> in feature or page code.

The client centralizes cookie authentication, same-origin URLs, JSON
serialization, HTTP errors, empty responses, and useful network-error
messages. Requests should use root-relative <code>/api/...</code> paths.

This matters in production: a hard-coded origin or missing
<code>credentials: "include"</code> can appear to work locally but fail behind
a deployed proxy.

## Allowed bypasses

Raw <code>fetch</code> is allowed only where the service worker cannot import
the client, or for an intentional fire-and-forget background request that must
remain silent while offline or unauthenticated.

Real-time streams use <code>EventSource</code>, which the HTTP client does not
wrap.

## Rules for every bypass

Any raw request to <code>/api/*</code> must:

1. Send cookies: <code>credentials: "include"</code> for fetch or
   <code>{ withCredentials: true }</code> for EventSource.
2. Use a root-relative path. Never hard-code an origin or build one from an
   environment variable.

When adding a new bypass, document why the shared client cannot be used and
add focused coverage for its authentication behavior.

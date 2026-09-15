# Server-derived OpenAPI contract

Status: deferred (2026-09-15). Approved design, implementation not started
and not scheduled. The full server-derived OpenAPI contract only pays off with
multiple independent client teams and a repo split; today all clients live in
one workspace and web already shares TS types with the server. Revisit only if
the rawkoon-org repo split actually happens (a second, independent API consumer
is the trigger). Until then the per-endpoint quirks are fixed directly and the
existing endpoint e2e harness covers accidental-breaking-change detection at a
fraction of the cost.

## Decision

Rawkoon will publish one complete OpenAPI 3.1 contract derived from its Hono
server. It covers every externally reachable HTTP operation, not merely the
ones used by the current iOS app.

The server is the sole contract owner. Each Rawkoon-owned operation will have
one code-first route declaration that defines its method, path, documentation,
security, request schemas, and every intentional response. That declaration
both registers the runtime route and contributes to the generated OpenAPI
document. It is the seam between the server and all clients.

The initial contract is observational: it describes production behaviour as it
exists, including inconsistent payloads or status codes. Contract adoption must
not normalize, rename, or otherwise change an existing endpoint. Behaviour
cleanup is a later, explicitly approved breaking-change track.

## Goals

- Make every externally reachable endpoint discoverable and machine-readable.
- Make request validation, route registration, and contract generation share
  one source of truth for Rawkoon-owned operations.
- Publish stable operation identifiers and exact request/response schemas for
  web, iOS, scripts, and future clients.
- Declare authorization, errors, streaming, redirects, binary downloads, and
  range semantics rather than documenting JSON success responses only.
- Detect undocumented routes, stale documents, and accidental breaking changes
  in CI.
- Give native clients a stable compatibility signal before they use newer
  operations or fields.

## Non-goals

- Rewriting every client during the initial server-contract migration.
- Changing the current server's API behaviour to make it more uniform.
- Publishing an incomplete or hand-maintained parallel YAML document.
- Treating static assets, source maps, or the SPA catch-all as normal business
  operations.
- Splitting repositories. This contract makes a future split safer but does not
  require one.

## Contract architecture

```
Route declaration
  method + path + tags + operationId + security
  request schemas + response schemas
                 |
        +--------+---------+
        |                  |
runtime Hono route    OpenAPI 3.1 document
and request validation          |
                       +--------+---------+
                       |                  |
                 checked-in artifact   protected runtime endpoint
                       |                  |
             schema/diff/coverage CI  Scalar reference UI
                       |
              Swift and Kotlin generators
```

`apps/api` owns a focused `openapi` module. Its external interface is small:

- Register a Rawkoon operation from a route declaration and its handler.
- Assemble the deterministic complete document.
- Serve the document and reference UI under protected operational routes.
- Expose the normalized operation inventory used by completeness tests.

The module may contain internal schema helpers, document merging, route
inventory normalization, and validation wiring. Consumers do not need to know
those details. This gives clients leverage and maintainers locality: a route
cannot silently diverge from the interface it exposes.

### Rawkoon-owned routes

Use `OpenAPIHono` and the maintained Hono Zod OpenAPI integration. Route
modules remain independently mountable, but each module registers operations
through the contract module rather than calling untyped `.get`, `.post`, and
friends directly.

Each operation declares:

- An immutable, unique `operationId`; it must never be renamed after release.
- Tags, summary, description, and deprecation status.
- Path, query, header, and body schemas, including supported content types.
- A security classification: anonymous, authenticated user, or administrator.
- All intentional status codes and media types, including non-JSON bodies.
- Stable component-schema names for reusable data models.

Existing Zod schemas are reused where their runtime behavior is already
correct. Shared response schemas replace duplicated descriptions, not business
logic. Existing `jsonV`, `queryV`, and `paramV` behavior must remain intact:
invalid input still returns the current neutral `400 {"error": string}`
envelope unless the existing endpoint demonstrably behaves differently.

The root `app` changes to `OpenAPIHono`. Route modules that are mounted into it
also use the compatible OpenAPI-aware router type, preserving the existing
route composition in `apps/api/src/index.ts`.

### Better Auth

`/api/auth/*` is registered by Better Auth rather than Rawkoon route modules.
Rawkoon will enable Better Auth's OpenAPI plugin and call
`auth.api.generateOpenAPISchema()` during document assembly. The assembler
merges it with Rawkoon's document, rewrites only shared metadata/security where
necessary, and fails on path or component-name collisions.

Better Auth operations are included in the same contract, not excluded or
copied by hand. The merged output therefore represents the actual authentication
surface, including configured plugin endpoints. A schema validation test pins
the version of Better Auth's generated output and catches invalid output before
release.

### Special response classes

Completeness includes every response kind. The contract explicitly describes:

- JSON success and current JSON error envelopes.
- `204` responses with no body.
- Server-sent event streams with `text/event-stream`, event names, payload
  schemas, reconnect behavior, and terminal/error semantics.
- File and EPUB/audio downloads with binary media types, `Content-Disposition`,
  and `206` range semantics where supported.
- Signed or temporary download URLs and redirects, including expiry/error
  outcomes.
- Webhook/hook endpoints, their secret/authentication mechanism, and replay or
  idempotency behavior.
- HTML/static/SPA fallback routes as reviewed exclusions rather than business
  operations.

## Artifact and operational endpoints

The canonical generated artifact is
`apps/api/openapi/rawkoon.openapi.json`. It is formatted deterministically and
committed so review, client generation, and breaking-change diffing do not need
a running server.

The same bytes are exposed at `GET /api/openapi.json` in production, protected
by administrator authentication. A protected Scalar reference UI is served at
`GET /api/openapi`. The document and UI endpoints are intentionally excluded
from their own route-coverage comparison.

The document declares OpenAPI `3.1.1`, a Rawkoon server URL relative to the
instance origin, cookie and bearer security schemes, operation tags, and a
top-level `x-rawkoon-api-version` extension.

## Compatibility policy

Rawkoon has an API semantic version distinct from its application/Docker image
version. The existing anonymous `GET /api/system/version` response expands
additively to:

```json
{
  "version": "1.23.0",
  "api_version": "1.0.0",
  "min_supported_api_version": "1.0.0",
  "openapi_sha256": "sha256:..."
}
```

Native clients fetch this once during startup/sign-in. They use it to reject a
server that is too old or to show an upgrade message before invoking an
operation outside the server's supported range. They do not need to download
the full OpenAPI document at runtime.

Versioning rules:

- Patch: documentation corrections that do not change the serialized contract.
- Minor: new operations; optional request fields; optional response fields;
  new, documented enum values; additional non-breaking responses.
- Major: removed or renamed operations/fields; required new inputs; tightened
  validation; changed status code or media type; changed authorization;
  changed nullability; changed enum meaning or removal.

A major change needs a compatibility note, an explicit API-version bump, and
an approved migration or deprecation window. An endpoint can be deprecated in
the document before removal. The first rollout is API version `1.0.0`; it
records present behavior without retrospectively treating current inconsistencies
as breaking changes.

## Completeness and CI gates

The OpenAPI document is not considered complete because a team says it is. CI
must prove it.

1. Build the complete document from the production route tree and Better Auth.
2. Validate it against OpenAPI 3.1 and lint for unique `operationId`s, stable
   component names, tags, descriptions, declared security, and explicit media
   types for success and error responses.
3. Derive a normalized method/path inventory from the mounted Hono route tree.
   Compare it with the merged OpenAPI operations after normalizing Hono `:id`
   paths to OpenAPI `{id}` paths. Any unmatched business operation fails CI.
4. Keep a tiny reviewed exclusion registry limited to static asset wildcards,
   SPA fallback, the OpenAPI JSON/UI routes, and framework middleware that
   cannot be represented as an operation. It must never contain a business or
   authentication endpoint. Better Auth is covered by its generated schema,
   not an exclusion.
5. Regenerate the checked-in JSON and fail if it differs from the committed
   artifact.
6. Diff the artifact against the merge base. CI rejects breaking changes unless
   the API major version, migration note, and approval marker are present.
7. Run contract tests for representative anonymous, user, administrator,
   invalid-input, error, SSE, redirect, download, and range-response cases.
   Tests validate the actual status, headers, media type, and payload against
   the declared operation.

The existing endpoint-verification harness remains valuable. It becomes an
adapter that tests the generated contract rather than a separate inventory of
HTTP assumptions.

## Client generation

Generation is downstream of the complete, reviewed artifact:

- Swift: generate a transport/models package from the committed OpenAPI JSON;
  retain Rawkoon-specific authentication, retry, offline storage, playback,
  and UI logic as a thin adapter around it.
- Web TypeScript is not required to switch in the first migration because it
  already shares TypeScript types with the server. It may adopt generated types
  later only where that removes real duplication.

Generated code is never edited. The generator input, generator version, and
generation command are pinned. CI regenerates and verifies that no generated
file differs. Native migration happens endpoint/domain by endpoint/domain after
the server document has complete coverage; it does not block publishing the
server contract.

## Delivery sequence

1. Add the OpenAPI contract module, common schema conventions, document
   assembler, Better Auth plugin/schema merge, artifact command, and CI
   validators without exposing an incomplete document.
2. Convert every Rawkoon-owned route and all special response classes. Preserve
   exact existing runtime behavior while adding declarations and contract tests.
3. Enable the route-inventory completeness comparison. Resolve every mismatch;
   add only reviewed framework/static exclusions.
4. Commit the first complete `1.0.0` artifact. Enable the protected JSON and
   Scalar endpoints.
5. Add contract-diff/version gates to required CI.
6. Generate Swift and Kotlin transport packages from the artifact and migrate
   native call sites incrementally behind their existing client interfaces.
7. Only after successful native adoption, consider repository extraction. The
   OpenAPI contract, not co-location, then provides the stable cross-repository
   interface.

## Acceptance criteria

- The checked-in artifact and protected runtime document are byte-identical.
- Every non-static mounted HTTP operation appears exactly once in the merged
  document, or CI fails.
- Better Auth endpoints are generated and merged rather than copied manually.
- Every documented operation has an immutable `operationId`, declared
  authorization, and schemas for all intentional response classes.
- Existing endpoint behavior is preserved during the initial rollout.
- `GET /api/system/version` reports the API compatibility fields additively.
- CI validates, lints, coverage-checks, diffs, and contract-tests the document.
- Swift and Kotlin generation can reproduce transport/models packages from the
  committed artifact without edits to generated output.

## Risks and controls

| Risk | Control |
|---|---|
| Large migration lets runtime and contract drift | One route declaration drives registration and validation; coverage and live contract tests gate CI. |
| Better Auth output conflicts or is invalid | Generate at build time, merge deterministically, validate the merged document, and pin regression fixtures. |
| Hono OpenAPI library behavior changes | Pin versions; test generated document and production-bundle route import; upgrade deliberately. |
| Current endpoint quirks become visible | Record them faithfully in 1.0.0; make later normalization a reviewed breaking-change proposal. |
| Sensitive administrative capabilities become browsable | Restrict the runtime document and reference UI to administrators; repository artifact access follows repository access. |
| Generated clients obscure native behavior | Keep generated code at the HTTP/model layer; native concerns remain in explicit adapters. |

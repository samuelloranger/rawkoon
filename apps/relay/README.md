# Rawkoon push relay

APNs only accepts a push signed by the credential of the team that publishes
the app, so a self-hosted Rawkoon server can never talk to Apple directly. It
posts `{ token, title, body }` to this relay, which holds the APNs signing key
and forwards the notification to Apple.

The relay is a Cloudflare Worker. It's stateless: it stores nothing, logs no
content, and rate-limits per client IP and per device token with Cloudflare's
Rate Limiting binding.

## Endpoints

- `GET /health` → `200 { ok: true, signable: true }` while the key signs, `503` otherwise
- `POST /push` — body `{ token, title, body, collapseId?, data? }`
  - `200 { ok: true }` sent
  - `410 { error: "unregistered" }` the app was uninstalled — caller drops the token
  - `400 { error: "rejected", reason }` APNs rejected the request
  - `403` the request didn't come through Cloudflare's edge
  - `429` / `503` / `502` rate-limited / upstream busy / upstream unavailable

## Config

Set each value as a Worker secret (`wrangler secret put <NAME>`), so none of it
lives in the repo:

| Name | Meaning |
|---|---|
| `APNS_KEY_ID` | APNs auth key id |
| `APNS_TEAM_ID` | Apple team id |
| `APNS_BUNDLE_ID` | app topic, e.g. `com.example.rawkoon` |
| `APNS_PRIVATE_KEY` | contents of the `.p8` key |
| `APNS_ENV` | `production` (default) or `sandbox` |

Rate limits (`PER_IP` 60/min, `PER_TOKEN` 10/min) are bindings in `wrangler.jsonc`.

## Deploy your own

```bash
cd apps/relay
bunx wrangler login
bunx wrangler deploy
bunx wrangler secret put APNS_KEY_ID
bunx wrangler secret put APNS_TEAM_ID
bunx wrangler secret put APNS_BUNDLE_ID
bunx wrangler secret put APNS_PRIVATE_KEY < AuthKey_XXXXXXXXXX.p8
```

Then attach a hostname under **Workers & Pages → rawkoon-relay → Settings →
Domains & Routes → Add → Custom domain**, and point your servers at it with
`PUSH_RELAY_URL`. `wrangler.jsonc` deliberately has no account or routes, so a
deploy never needs them in the repo; a custom domain added in the dashboard
survives later deploys.

APNs accepts HTTP/2 only. Cloudflare's edge makes that connection for the
Worker, which `wrangler dev` can't reproduce, so pushes only reach Apple from a
deployed Worker. `bun test src/` covers everything up to the APNs request.

## Release

The project's relay deploys from `.github/workflows/relay-deploy.yml` when a
`relay-vX.Y.Z` tag is pushed (or on a manual dispatch). A bad deploy breaks push
for every instance at once, so it stays a deliberate act; `wrangler rollback`
restores the previous version.

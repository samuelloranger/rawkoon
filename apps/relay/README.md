# Rawkoon push relay

APNs only accepts a push signed by the credential of the team that publishes
the app, so a self-hosted Rawkoon server can never talk to Apple directly. It
posts `{ token, title, body }` to this relay, which holds the APNs signing key
and forwards the notification to Apple over HTTP/2.

Stateless: it stores nothing, logs no content, and rate-limits per token and
per IP.

## Endpoints

- `GET /health` → `{ ok: true }`
- `POST /push` — body `{ token, title, body, collapseId?, data? }`
  - `200 { ok: true }` sent
  - `410 { error: "unregistered" }` the app was uninstalled — caller drops the token
  - `400 { error: "rejected", reason }` APNs rejected the request
  - `429` / `503` / `502` rate-limited / upstream busy / upstream unavailable

## Config (env)

| Var | Meaning |
|---|---|
| `APNS_KEY_ID` | APNs auth key id |
| `APNS_TEAM_ID` | Apple team id |
| `APNS_BUNDLE_ID` | app topic, e.g. `cloud.samlo.rawkoon` |
| `APNS_KEY_PATH` | path to the mounted `.p8` |
| `APNS_ENV` | `production` (default) or `sandbox` |
| `PORT` | default `8090` |
| `TRUSTED_PROXY_HOPS` | reverse proxies in front (default `1`) |

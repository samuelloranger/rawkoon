> Operator notes — not published on the VitePress docs site. Canonical private copy lives with the relay deploy.

# Push notifications (APNs via relay)

The native iOS app receives Apple Push Notifications. APNs only accepts a push
signed by the credential of the team that publishes the app, so a self-hosted
Rawkoon server can never talk to Apple directly. Instead it posts
`{ token, title, body }` to the **Rawkoon push relay**, which holds the APNs
signing key and forwards to Apple.

```
iOS app ──register token──▶ Rawkoon API ──POST /push──▶ rawkoon-relay ──HTTP/2──▶ APNs
```

## Components

- **`apps/relay`** — the relay service (Hono + `node:http2`). Stateless, holds
  the APNs key, rate-limited per token and per IP. `GET /health`, `POST /push`.
- **API** — `utils/apns.ts` posts to the relay; `notificationWorker` fans out to
  APNs devices alongside web push. Device tokens live in the `apns_devices`
  table (`POST/GET/DELETE /api/notifications/apns/*`).
- **iOS** — asks permission after login, registers for remote notifications,
  posts the token. Ships the `aps-environment: production` entitlement.

## Relay deployment (`~/servers/rawkoon-relay`)

Runs `rawkoon-relay:local` (built from `apps/relay`) on `homelab_network`,
fronted by Caddy at `https://rawkoon-relay.samlo.cloud`.

Env (`.env`):

| Var | Value |
|---|---|
| `APNS_KEY_ID` | the APNs auth key id (team-wide key) |
| `APNS_TEAM_ID` | `SSU33B2E5B` |
| `APNS_BUNDLE_ID` | `cloud.samlo.rawkoon` |
| `APNS_ENV` | `production` |

The `.p8` is mounted read-only at `/run/secrets/apns_key.p8` — never baked into
the image, never in git. An APNs auth key is team-wide: one key signs pushes for
any bundle id in the team (the topic is set per request).

Rebuild + redeploy:

```
docker build -t rawkoon-relay:local ~/sites/rawkoon/apps/relay
cd ~/servers/rawkoon-relay && docker compose up -d
```

## API config

The API defaults to `https://rawkoon-relay.samlo.cloud`; override with
`PUSH_RELAY_URL` to run your own relay. The `apns_devices` table is created by
migration `20260831120000_add_apns_devices` (auto-applied on start).

## Health check

```
curl https://rawkoon-relay.samlo.cloud/health         # {"ok":true}
# a dummy token returns {"error":"rejected","reason":"BadDeviceToken"} — proves
# the relay signs + reaches APNs for the topic; only the token is invalid.
```

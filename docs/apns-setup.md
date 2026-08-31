# Enabling APNs push notifications

The native iOS app registers its device token with the server; the server sends
Apple Push Notifications on the same events as web push. The channel is a no-op
until these env vars are set on the API container, so it ships dark.

## 1. Create an APNs Auth Key (once)

Apple Developer → **Certificates, Identifiers & Profiles → Keys → +**

- Enable **Apple Push Notifications service (APNs)**.
- Download the `.p8` (you can only download it once). Note its **Key ID**.
- Your **Team ID** is `SSU33B2E5B`.

Also make sure the App ID `cloud.samlo.rawkoon` has the **Push Notifications**
capability enabled (the app ships the `aps-environment: production` entitlement,
so the signing/archive step enables it via `-allowProvisioningUpdates`).

## 2. Configure the API

Set these on the production API container (e.g. `~/servers/rawkoon` env):

| Var | Value |
|---|---|
| `APNS_KEY_ID` | the Key ID of the .p8 |
| `APNS_TEAM_ID` | `SSU33B2E5B` |
| `APNS_BUNDLE_ID` | `cloud.samlo.rawkoon` |
| `APNS_AUTH_KEY` | the .p8 contents (PEM), or its base64 encoding |
| `APNS_PRODUCTION` | `true` (TestFlight/App Store builds use the production APNs host) |

`APNS_AUTH_KEY` accepts either the raw PEM (`-----BEGIN PRIVATE KEY----- …`) or a
base64-encoded PEM (handy for a single-line env var):
`base64 -w0 AuthKey_XXXX.p8`.

## 3. Deploy + migrate

The `apns_devices` table is created by migration
`20260831120000_add_apns_devices`, applied automatically by `prisma migrate
deploy` on container start.

## How it works

- iOS asks for notification permission after login, registers for remote
  notifications, and `POST`s the hex token to
  `POST /api/notifications/apns/register`.
- On each notification event, `notificationWorker` fans out to web-push
  subscriptions **and** APNs devices (`utils/apns.ts`), honouring the same
  quiet-hours suppression and notification-preference gate.
- A `410 / BadDeviceToken / Unregistered` response deletes the dead token
  (self-healing), exactly like web push.

## Endpoints

- `POST /api/notifications/apns/register` — body `{ device_token, device_info? }`
- `GET  /api/notifications/apns/devices`
- `DELETE /api/notifications/apns/devices/:id`

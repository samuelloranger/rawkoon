# Sign in with Jellyfin

## Why

Most people in a Rawkoon household already have a Jellyfin account and know its password. Today an admin creates a second account for each of them in Rawkoon, with a second password, and links the two by hand in Settings → Users so the TV app can trade a Jellyfin token for a session.

The moment this serves: someone opens Rawkoon for the first time, presses **Sign in with Jellyfin**, types the username and password they already watch with, and is in.

Rawkoon already trusts Jellyfin for identity in one place: `POST /api/jellyfin/session` (`routes/jellyfin/index.ts`) exchanges a Jellyfin token for a Rawkoon session for a linked user. This design adds the same trust to the login page, plus the admin tools to decide who gets in.

## Goals

- A **Sign in with Jellyfin** option on the web login page and the iOS login screen.
- An admin decides who can sign in, from Rawkoon, by importing Jellyfin users or linking existing accounts.
- An optional switch lets any enabled Jellyfin user sign in. Their Rawkoon account is created on first sign-in.
- A signed-in user can link and unlink their own Jellyfin account.
- A user who is disabled or deleted in Jellyfin loses their Jellyfin-based Rawkoon sessions within 15 minutes.
- An account created from Jellyfin, or linked to it without an avatar, gets the Jellyfin profile picture once.

## Non-goals

- A Jellyfin server plugin. Access is managed entirely in Rawkoon (see "Decisions").
- Quick Connect sign-in (parked).
- Keeping names or avatars in sync with Jellyfin after the first copy, and importing watch history (parked).
- Admin sign-in settings in the iOS app. They are web-only for v1.
- Signing in to Jellyfin *with* Rawkoon (parked hard).

## Anti-goals

- **Matching accounts by name or email.** A Rawkoon account is tied to a Jellyfin user only by `User.jellyfinUserId`, set by an admin (link or import), by the user themselves while signed in, or by automatic creation. Never by comparing names: a Jellyfin user named `admin` must not become the Rawkoon admin.
- **Copying Jellyfin admin into Rawkoon admin.** Accounts created by import or automatic creation are regular users unless the admin picks the role at import.
- **Contacting a Jellyfin server the client names.** Only the configured integration URL is ever contacted (same rule as `resolveJellyfinTokenUser`).
- **Storing the Jellyfin password or token.** Rawkoon checks the credentials with Jellyfin, then ends the Jellyfin session it just opened.
- **Mass revocation on a bad sync.** If the Jellyfin user list can't be read, the sync does nothing.

## Decisions

- **No plugin.** The plugin's only gain for this feature is instant revocation instead of within 15 minutes, against a second repo, a C# release lane, a rebuild for each Jellyfin major version, and a Jellyfin restart per update. User-facing screens are identical either way, so a plugin can be added later without redesign. Revisit when a feature needs to live inside Jellyfin (a "Requests" sidebar entry, a "request it" search result).
- **The access list is the set of linked users.** A Jellyfin user can sign in if a Rawkoon user has their `jellyfinUserId`. No new table.
- **"Any Jellyfin user can sign in" is off by default.** So a newly created Jellyfin account (a child, a guest) doesn't get Rawkoon by surprise.
- **Username and password form.** Quick Connect comes later.
- **15-minute revocation check.**

## Settings

Three new fields in the Jellyfin integration config (the JSON in `IntegrationConfig`, read through `normalizeJellyfinConfig` / `JellyfinIntegrationConfig`):

| Field | Default | Meaning |
|---|---|---|
| `sign_in_enabled` | `false` | Shows the Jellyfin option on login, and turns on the sign-in endpoint and the sync job |
| `open_sign_in` | `false` | Any enabled Jellyfin user can sign in, and an account is created on first sign-in |

`open_sign_in` takes effect only while `sign_in_enabled` is on. A stored `true` is kept but ignored when sign-in is off, so turning sign-in back on restores the admin's earlier choice. The resolver checks both flags; it never reads `open_sign_in` alone. *(Claude's call.)*

The check interval is fixed at 15 minutes. *(Claude's call: the mockup showed an interval picker, but one interval is enough and it saves a setting.)*

`GET`/`PUT /api/integrations/jellyfin` read and write the two flags. The existing "empty API key keeps the stored one" behaviour must stay.

A public endpoint tells the login page whether to show the button: add `jellyfin_sign_in: boolean` to the response the login page already fetches for SSO providers (`useSSOProviders`). It is true only when the integration is enabled, configured, and `sign_in_enabled` is on. *(Claude's call: reuse the existing public call rather than add one.)*

## API

### Jellyfin client (`services/jellyfinUsers.ts`)

- `authenticateJellyfinUser(config, username, password)` → `POST {website_url}/Users/AuthenticateByName` with body `{ Username, Pw }` and a `MediaBrowser Client="Rawkoon", Device="Rawkoon", DeviceId=…, Version=…` authorization header (Jellyfin requires those fields on this call). Returns `{ id, name, disabled }` on success, `null` on 401, and throws on any other failure. Immediately after success, call `POST /Sessions/Logout` with the returned access token, best-effort, so no Jellyfin device entry is left behind.
- `toJellyfinUser` / `JellyfinUser` gain `disabled: boolean` (from `Policy.IsDisabled`) so `listJellyfinUsers` can drive both the import list and the sync.

### Resolving the Rawkoon user (one shared function)

`resolveOrCreateJellyfinRawkoonUser(jellyfinUser, config)` in a new `services/jellyfinSignIn.ts`:

1. Jellyfin user is disabled → `no_access`.
2. A Rawkoon user has that `jellyfinUserId` → return it.
3. `sign_in_enabled` and `open_sign_in` are both on → create one with a direct Prisma write (as admin-created users are created, so better-auth's first-signup hook in `lib/firstSignup.ts` is never reached): `name` = Jellyfin name, `isAdmin = false`, `jellyfinUserId` set, no password, and a placeholder email `<jellyfinUserId>@jellyfin.invalid` (better-auth requires a unique email; `.invalid` can never be delivered to). A unique-constraint race on `jellyfinUserId` re-reads and returns the winner.
4. Otherwise → `no_access`.

The TV exchange `POST /api/jellyfin/session` switches to this function, so with open sign-in in effect a TV can sign in a Jellyfin user who has never opened Rawkoon. Otherwise behaviour is unchanged (linked users only). The one new restriction: a linked user who is disabled in Jellyfin now gets 403 there. Today Jellyfin itself rejects a disabled user's token, so in practice nothing changes. *(Claude's call.)*

### Sign-in endpoint

A small better-auth plugin (`lib/jellyfinSignInPlugin.ts`, registered in `lib/auth.ts` next to `passkey` and `genericOAuth`) exposing `POST /api/auth/sign-in/jellyfin`, body `{ username, password }` (Zod, max lengths). Building it as a better-auth endpoint means its session cookie works for the web and the bearer plugin's `set-auth-token` header works for iOS, exactly like `/sign-in/email`. Steps:

1. Sign-in disabled or Jellyfin not configured → **404**.
2. `authenticateJellyfinUser`: throws → **502** ("Can't reach Jellyfin"); `null` → **401**.
3. `resolveOrCreateJellyfinRawkoonUser` → `no_access` → **403**.
4. Create the session, set the session cookie, update `lastLogin`, return the user like `/sign-in/email` does.

Clients pick their message from the status code, because the global error handler doesn't promise messages reach the client: 401 = wrong username or password, 403 = no access, 502 = Jellyfin unreachable.

The path starts with `/api/auth/sign-in`, so the strict per-IP auth rate limiter in `middleware/rateLimitCore.ts` already covers it. Add a test that proves it.

**Marking sessions:** in the `session.create.after` hook in `lib/auth.ts`, path `/sign-in/jellyfin` → `providerId = "jellyfin"`. TV-exchange sessions keep their `JELLYFIN_SESSION_AGENT_PREFIX` user agent. **"Jellyfin-based sessions"** throughout this document means both: `providerId = "jellyfin"` OR `userAgent` starting with that prefix. Write one helper for this `where` clause and use it everywhere sessions are revoked, including the existing relink in `PATCH /api/admin/users/:id/jellyfin`.

### Self-service link and unlink

Under `requireUser`:

- `POST /api/profile/jellyfin` `{ username, password }` → authenticate as above (same status mapping) → **409** if that Jellyfin user is linked to another account → set the caller's `jellyfinUserId`, revoke the caller's Jellyfin-based sessions, return the linked Jellyfin name.
- `DELETE /api/profile/jellyfin` → **400** unless the caller has a password or at least one passkey (otherwise they'd be locked out) → clear the link and revoke their Jellyfin-based sessions.
- `GET /api/profile/jellyfin` → `{ linked: boolean, jellyfin_name: string | null, can_unlink: boolean }`. The name comes from Jellyfin. If Jellyfin is unreachable, the name is `null` and the link status still returns.

Rate-limit `POST` like sign-in: it takes a password.

### Admin import

`POST /api/admin/users/import-jellyfin` `{ users: [{ jellyfin_user_id, is_admin }] }` under `requireAdmin`:

- Re-read the Jellyfin user list server-side. Reject ids that don't exist, are disabled, or are already linked: skip them and report them in the response, don't fail the whole batch.
- Create each account like step 3 above, with the chosen role.
- Return `{ created: [...], skipped: [{ jellyfin_user_id, reason }] }`.

`GET /api/admin/jellyfin-users` gains `disabled` and `linked_user_id` per user, so the import dialog can grey out disabled and already-linked users without a second call.

### Avatar copy

`copyJellyfinAvatar(config, jellyfinUserId, rawkoonUserId)` in `services/jellyfinSignIn.ts`, called:

- after an account is created (automatic creation in the resolver, and admin import),
- after a self-service link, only if the user has no `avatarUrl`.

Steps:

1. `GET {website_url}/Users/{jellyfinUserId}/Images/Primary` with the integration API key (`jellyfinAuthHeader`) and the same timeout as the other Jellyfin calls. 404 → no picture, done.
2. Validate the bytes like a profile upload: `validateImageMimeAndSize` from the response `Content-Type`, 5 MB cap (same as `updateUserAvatarFromUpload`).
3. Wrap them in a `File` named from the content type (`jellyfin.jpg` / `.png` / `.webp`) and save through `saveImageAndCreateThumbnail`. Set `avatarUrl` with `getAvatarUrl`, but only `where avatarUrl is null`, so a picture the user uploaded meanwhile is never overwritten.

Rules:

- **Never blocks sign-in, import or linking.** Any failure is logged and swallowed. Account creation commits first, and the avatar copy runs after it. Whether sign-in awaits it or fires it off is left to the builder, but a slow Jellyfin image must not hold the response past the normal Jellyfin timeout.
- **Copied once.** No later sync. A user's own upload always wins.
- **Only from the configured Jellyfin URL**, same anti-goal as above.

### Revocation sync

New scheduled job `SYNC_JELLYFIN_USERS` (`*/15 * * * *`), added to `SCHEDULED_JOB_NAMES`, the schedule list and a handler in `src/workers/`:

1. If Jellyfin isn't configured, or no Rawkoon user has a `jellyfinUserId` → return. The job does **not** depend on `sign_in_enabled`: it also covers sessions from the TV exchange and admin-linked users, which today are never revoked when the Jellyfin user is disabled or deleted. *(Claude's call: the 15-minute goal is unconditional, and the stricter behaviour is the safer one.)*
2. `listJellyfinUsers`. On error or an empty list → log and return (anti-goal: no mass revocation).
3. For every Rawkoon user with a `jellyfinUserId` whose Jellyfin user is missing or disabled → delete their Jellyfin-based sessions. Keep the link and the account, so a re-enabled Jellyfin user can sign in again. Password and passkey sessions are untouched.

## Web

- **Login** (`pages/login/_component/LoginForm.tsx`): a "Sign in with Jellyfin" button below passkey/SSO, shown when `jellyfin_sign_in` is true. It opens a Jellyfin form in place (username, password, Continue, Back), with a line saying the password is checked by the Jellyfin server and not stored. Errors map from the status: 401, 403 ("This Jellyfin account can't sign in to Rawkoon yet. Ask your admin."), 502. On success, the same `goNext()` as email login.
- **Jellyfin integration settings** (`JellyfinIntegrationSection.tsx`): two switches, "Sign in with Jellyfin" and "Any Jellyfin user can sign in" (the second disabled while the first is off).
- **Users** (`UsersListSection.tsx`): an "Import from Jellyfin" button, shown when the Jellyfin column is, opening a dialog listing Jellyfin users with a checkbox and a role select each. Disabled and already-linked users are shown but can't be ticked. Show the skipped list from the response as a toast. Users with a `@jellyfin.invalid` email show "—" instead of the email.
- **Security** (`SecurityPage.tsx`): a "Jellyfin" row next to Passkeys with Link (opens the same form as login) or "Linked as X" + Unlink (hidden when `can_unlink` is false). Shown when `jellyfin_sign_in` is true.
- en + fr strings for all of the above.

The mockup also showed a dedicated "You've been signed out, your Jellyfin access was removed" screen. v1 shows the normal login page, as for any expired session. *(Claude's call: the client can't tell a revoked session from an expired one without extra server state; parked.)*

## iOS

- Login screen: a "Sign in with Jellyfin" button revealing username and password fields. Shown when the SSO providers response says `jellyfin_sign_in`.
- `APIClient+Auth.swift`: `loginWithJellyfin(username:password:)` posting to `/api/auth/sign-in/jellyfin`, reading `set-auth-token` exactly like `login(email:password:)`.
- Status mapping as on the web.
- Strings go in the String Catalog.

## Delivery

Three PRs, in order: **API** (everything under "API" + tests), **web**, **iOS**. Each one merges independently: with `sign_in_enabled` off by default, the API PR changes nothing visible.

## Tests

- `authenticateJellyfinUser`: success, 401 → null, 5xx/timeout → throws, logout called after success.
- `resolveOrCreateJellyfinRawkoonUser`: linked, disabled, open-sign-in create, closed-sign-in deny, create race.
- Sign-in endpoint: 404 when off, 401/403/502 mapping, session cookie set, `providerId = "jellyfin"` recorded, rate limiter applies.
- Never matches by name: an unlinked Jellyfin user whose name equals an existing Rawkoon user's name or email local part gets 403 (closed) or a new account (open), never the existing account.
- Link/unlink: 409 on a taken Jellyfin user, unlink refused without another sign-in method, sessions revoked.
- Import: skips disabled, unknown and already-linked users. Never sets admin unless asked.
- Avatar copy: sets `avatarUrl` on a 200 image. Does nothing on 404. Does nothing and doesn't throw on 5xx, timeout, a non-image type or over 5 MB. Never overwrites an existing `avatarUrl`. On link, skipped when the user already has one. A failed copy still leaves the account created and signed in.
- Sync: revokes only Jellyfin-based sessions of missing/disabled users. Does nothing on fetch error or an empty list. Still runs when sign-in is off (revokes TV-exchange sessions too).
- TV exchange: unchanged with open sign-in not in effect, creates the account when `sign_in_enabled` and `open_sign_in` are both on, ignores `open_sign_in` when `sign_in_enabled` is off.

## Left to the builder

- Exact `DeviceId`/`Version` values in the Jellyfin authorization header.
- The better-auth plugin mechanics (`createAuthEndpoint`, `setSessionCookie`) and how its response is shaped to match `/sign-in/email`.
- Component structure of the login form and import dialog.
- Exact copy, within the meaning above.

## Parking lot

- Quick Connect sign-in (no password; needs a polling UI).
- Watch-history seeding on first sign-in, so Discover and "Continue watching" know the user on day one.
- Notify the admin when a new Jellyfin user appears ("Give them Rawkoon?").
- Keep the name and avatar in sync with Jellyfin after the first copy.
- A dedicated "your Jellyfin access was removed" sign-out message.
- Admin sign-in settings on iOS.
- A Jellyfin plugin: instant revocation, a "Requests" entry in Jellyfin's sidebar, a "request it" result in Jellyfin search, request limits from Jellyfin library access.
- Rawkoon as the identity provider for Jellyfin.

> Shipped in #67.

# Rawkoon iOS — Full Settings Parity: Design Spec

> **Status:** draft for review · **Date:** 2026-09-02 · **Branch:** `feat/web-settings-editable-ios-devices` · **Board:** task #969
> **Source inventory:** `SETTINGS_INVENTORY.md` (authoritative web surface) · Spec drafted via multi-agent workflow `wf_f27c90b0-089`.

## 0. Design Contract (BINDING — every agent, spec & implementation, MUST follow)

This is non-negotiable and is embedded verbatim into every implementation subagent's prompt:

1. **Approach A only** — native SwiftUI `Form`/`List` screens on the existing three-layer architecture (APIClient actor · DTOs · thin views). No WKWebView, no codegen, no MVVM layer, no new third-party deps.
2. **Match the existing iOS house style** — study `SettingsView.swift` and `NotificationsSettingsView.swift` and mirror their idioms exactly: view-owned `@State`, `.task { await load() }`, `model.api()`, `Theme` tokens (`Theme.base`/`raised`/`apricot`/`terracotta`/`muted`), `.listRowBackground(Theme.raised)`, `.scrollContentBackground(.hidden)`, inline nav titles. No agent invents a new visual language.
3. **The reusable components in §4.7 are the only field primitives** — every screen composes them; no bespoke one-off field styling.
4. **Same endpoints as the web** — parity is honest: identical server API, never a new bespoke endpoint unless this spec names it.
5. **No behavior change to existing screens; no on-device state migration** — Keychain, position journal, downloaded library untouched.
6. **No release, ever, by any agent** — no version bump, tag, or GitHub release (auto-uploads TestFlight + redeploys prod; user's call alone).
7. **Verification is macbuild** — a phase is done only when `lint` + `kit` + `build` are green on the `macbuild` host (Linux builds RawkoonKit only). Pull first; beware the stale-git BUILD-SUCCEEDED trap.
8. **New strings are English inline literals** — no `.xcstrings` migration here (separate milestone); keep literals extraction-friendly.

Any deviation from this contract is a defect, not a judgment call.

---

# Rawkoon iOS — Full Settings Parity with the Web App

## 1. Summary, Goals, Non-Goals

Rawkoon's iOS app today exposes only a thin slice of the settings surface the web app offers — a handful of read-only admin views and a couple of account screens. This document specifies bringing the native SwiftUI app to **full parity** with the web settings surface: every General/Integrations/Media/Books/Users/System/Account screen the web renders, editable, on the same server endpoints the web uses, delivered as five sequenced, independently-shippable phases on top of a shared foundation built first. It is a pure additive milestone — no existing behavior changes, no on-device state migrates, and no agent cuts a release.

**Goals**
- Native SwiftUI editors for every settings screen the web app has, hitting the identical server API.
- One shared substrate (APIClient extension, reusable form components, admin gating, secret/dirty conventions) that every screen composes, so the linter and compiler hold the boundaries.
- A single companion web change: surface iOS/APNS devices alongside web-push devices in the notifications device roster.
- Every phase leaves `main` green on `lint` + `kit` + `build` and behaves identically to the prior build for existing screens.

**Non-Goals**
- **No release.** No version bump, no tag, no GitHub release — publishing one auto-uploads to TestFlight and auto-redeploys production; that is the user's decision alone.
- **No localization.** All new strings are English inline literals; the `.xcstrings` migration is a separate later milestone.
- **No MVVM layer.** We match the existing view-owned-`@State` house style, pushing only pure decisions down into `RawkoonKit`.
- **No on-device state migration.** Keychain, the position journal, and the downloaded library are untouched.
- **Deferred parity gaps** (flagged, not built): native WebAuthn passkey registration, avatar multipart upload (read-only shipped), nav-rail position (no iPhone analogue).

---

## 2. Context: current iOS state vs. the full web surface

Per `SETTINGS_INVENTORY.md`, the web settings surface spans ~25 distinct screens across seven tab groups (General, Integrations, Media, Books, Users & Access, System, Account), of which the iOS app currently ships only:

- **Account:** `SettingsView` (readonly server/email/name rows), `NotificationsSettingsView` (per-toggle prefs), `ActivityView` (read-only feed).
- **Admin, read-only:** `QualityProfilesView`, `IndexersView`, `DownloadClientView`, `UsersView` — all display-only, no create/edit/delete.

Everything else — General settings, TMDB/Jellyfin/Local AI/Prowlarr/Jackett config, editable Download Client + Hook, Library/Import/Scan/Reindex, all Books settings, Custom Formats, Book Quality Profiles, Notification Channels, Profile editing, Invitations, Sessions, Web-push, API keys, SSO/OIDC, Jobs, Blocklist, and the device roster — has **no iOS presence**. The inventory also counts ~106 hardcoded-string sites in the existing views (localization is out of scope here but the new literals must stay extraction-friendly; see §7).

The build targets: SwiftUI, iOS 18 deployment, Xcode 26 SDK, `SWIFT_VERSION 6.0` with `SWIFT_STRICT_CONCURRENCY: complete` and `SWIFT_DEFAULT_ACTOR_ISOLATION: MainActor` already set in `project.yml` (the Swift-6 audit item is done). All new code compiles clean under complete concurrency: every DTO `Sendable`, every cross-actor closure isolated.

---

## 3. Chosen approach

**Approach A — native SwiftUI, phased (chosen).** Build native `Form`/`List` screens that call the existing `APIClient` actor, matching the current house style, sequenced foundation-first then simplest-to-heaviest. Chosen because it matches the existing three-layer architecture exactly (no competing pattern mid-milestone), keeps parity honest (same endpoints as web), and lets each phase ship independently behind new `NavigationLink`s so a half-finished later phase never exposes a broken screen.

- **Rejected B — WKWebView wrapper around the web settings pages.** One line: breaks native feel, can't reuse the app's bearer-token session cleanly, and regresses the "app keeps shipping natively" bar.
- **Rejected C — codegen Swift DTOs from the shared TS types.** One line: violates the "no new third-party dependencies" constraint and fights the established "declare only fields we use" convention.

---

## 4. Architecture (shared foundation — Phase 1)

### 4.1 The three layers, unchanged

| Layer | Where | Role | This milestone adds |
|---|---|---|---|
| **`APIClient`** (`actor`) | `Rawkoon/APIClient.swift` | Only thing that talks HTTP; owns bearer token, cookie-less ephemeral `URLSession`, encode/decode. | ~50 typed settings methods; new generic helpers; a split-out `APIClient+Settings.swift`. |
| **DTOs** | `Rawkoon/Models.swift` (+ private response structs) | `nonisolated struct … : Decodable/Encodable, Sendable`, camelCase bridged by `.convertFromSnakeCase`. | ~40 request/response structs. |
| **Views** | `Rawkoon/Views/*.swift` | SwiftUI `Form`/`List`; own `@State`, call `model.api()`, `.task { await load() }`. | ~25 screens + shared components. |
| **`AppModel`** (`@MainActor @Observable`) | `Rawkoon/AppModel.swift` | Session, `isAdmin`, `api()`, Keychain, journals. | `refreshAdminIfNeeded()`; optional read-only APNS-token exposure; otherwise untouched. |
| **`RawkoonKit`** (SPM, pure) | `Sources/RawkoonKit/*` | Dependency-free, Linux-testable logic. | Validation, dirty-diff, condition codec, secret-omission body builder — all with tests. |

**Deliberate non-goal:** no view-model layer. Any non-trivial *decision* (validation, dirty-diff, condition serialization, secret omission) goes into `RawkoonKit` as a pure function the view calls; views stay thin orchestrators.

### 4.2 APIClient extension pattern & generic helpers

`APIClient.swift` is already ~1009 lines; +50 methods trips `file_length` lint. **In Phase 1:** promote the generic helpers (`get`/`post`/`postExpectOK`/`patch`/`putExpectOK`/`postRaw`/`sendPost`/`sendPatch`/`makeRequest`/`perform`/`mapStatus`) from `private` to `internal`, then add settings methods in `extension APIClient` inside `APIClient+Settings.swift`. Confirm the `.swiftlint.yml` `file_length` threshold before deciding how many files to split.

All HTTP flows through `makeRequest(path:method:requiresAuth:)` → `perform`, status mapped by `mapStatus` (401/403 → `.unauthorized`, else `.http(code)`; decode → `.decode`; transport → `.transport`). Two coders are shared: `mediaDecoder` / `mediaEncoder` (snake↔camel). **Add these generic helpers in Phase 1** (multiple domains need them):

- `put<T: Decodable>(_ path:, body:) async throws -> T` — PUT returning a body (mirror `patch`); most `PUT /api/integrations/*` return the saved record.
- `patchExpectOK(_ path:, body:) async throws` — PATCH with no meaningful body.
- `delete(_ path:, query:) async throws` / `deleteExpectOK(_ path:)` — authenticated DELETE returning Void (guard 2xx else `mapStatus`), folding the hand-rolled `removeFromLibrary`/`deleteDownloadEntry` boilerplate into one helper.
- `delete<T: Decodable>(_ path:) async throws -> T` — rare DELETE returning a decoded body.
- **Plain-casing variants** `getPlain<T>` / `putPlain<T>` / `postPlain<T>` (or a `keyStrategy` parameter) using `JSONDecoder()`/`JSONEncoder()` with **no** key conversion — required only by the three Download-Client Hook endpoints, which speak camelCase on the wire (`callbackUrl`, `autoConfigure`, `activeHookedSecs`, …) and would be mangled by `.convertToSnakeCase`.

**Extension rule every later phase follows:** a typed method is a one-liner over the generics; never hand-roll `makeRequest`/`perform` unless you need a non-JSON path (file download, multipart) or a DELETE with a query string.

### 4.3 Codable model strategy & drift mitigation

**Rule:** hand-mirror minimally from `apps/shared/types` and the actual route handlers under `apps/api/src/routes/*` — one `nonisolated struct … : Decodable/Sendable` per response, declaring **only the fields the app reads** (the `Models.swift` convention). No codegen, no shared schema import.

Hand-mirroring across two languages with no compiler link is the single largest correctness risk. Enumerated drift: (1) server field rename → silent `nil`/default; (2) new enum value server-side → decode failure or raw string; (3) required→optional flip → decode crash if modeled non-optional; (4) write-shape divergence → omitted-required-field 500; (5) secret-flag rename → wrong placeholder.

**Mitigation (layered, cheap):**
- Copy exact JSON field names from the real route handler, not memory — each per-screen spec below lists them.
- **Model everything not provably-present as optional; never force-unwrap.** A drifted/removed field degrades to `nil`, never a crash.
- **`String`-backed, not Swift-`enum`-backed, for open/growing sets** (channel types, condition types/operators, client kinds, resolutions, metadata sources) — branch with a `default` arm showing the raw value. Use a Swift `enum` only where the set is truly closed and iOS must branch.
- **Fixture-decode contract tests in `RawkoonKitTests`** for the branching shapes (conditions, quality profiles, download-client): a captured real JSON payload under `Tests/RawkoonKitTests/Fixtures/settings/*.json` decoded into the DTO with field asserts — the only automated drift alarm on Linux CI. Simple scalar forms rely on the section field-list + the macbuild round-trip. DTOs with non-trivial decode logic live in (or are mirrored into) `RawkoonKit` so the tests can reach them.

### 4.4 Secret / write-only field convention

Many screens carry secrets the server never returns in plaintext (Jellyfin/TMDB/indexer/Google Books API keys, download-client password, OIDC client secret, API-key create). The server exposes only a boolean "is one stored" (`has_api_key`, `password_set`, `client_secret_set`) — or, for the four integrations with **no** flag (TMDB, Jellyfin, Prowlarr, Jackett), nothing at all.

**Precise convention (iOS mirrors web):**
- GET DTO carries the boolean (or nothing), **never** the secret. The editable `@State var secretInput = ""` starts empty on every load.
- `SecretField` shows a masked placeholder when stored (`"•••••• (stored)"` where a flag exists; `"Leave blank to keep existing key"` where none does) and a "Required"/"Enter API key" placeholder when not. Never render or pre-fill a real or fake secret.
- **On save, omit the secret from the body when `secretInput.isEmpty`.** Send it only when non-empty. Because a default `JSONEncoder` emits `null` for a `nil` optional and the server may read `null` as "clear it," **build secret-bearing bodies with a manual `encode(to:)` using `encodeIfPresent`** (or route through `postRaw` with a `[String: Any]` dict). This is the #1 place a naive implementation silently wipes a stored secret — the secret-omission body builder is a pure, unit-tested `RawkoonKit` function.
- **Dirty semantics:** a secret field is dirty only when non-empty; untouched, it never marks the form dirty and never appears in the body.
- **Server gotcha to surface:** if no key was ever stored **and** the field is blank, the PUT returns `400 "api_key is required"` (or `"password is required"`) — map to an inline field error, not a generic failure.
- **One-time reveal** (API-key create, invitation links, rotated hook secret): show in a copyable, non-editable `.textSelection(.enabled)` panel with a "won't be shown again" warning; keep in `@State` only, never persist.

*Open, per-endpoint:* confirm each route treats missing-key vs `null` vs `""` identically against `apps/api/src/routes/integrations/*` before Phase 2; each per-screen spec must state its exact "keep existing secret" wire contract.

### 4.5 Admin gating

`AppModel.isAdmin` (`Bool`, default false) is set by `refreshAdmin()` from `currentUser().user.isAdmin ?? false` after login and library reload, cleared on `logout()`. It already gates the `if model.isAdmin { Section("Admin") … }` block in `SettingsView`.

Every admin screen: (1) is reachable **only** through a `NavigationLink` inside that guard; (2) **self-guards** at the top of its `body` — if `!model.isAdmin`, render `ContentUnavailableView("Admin only", systemImage: "lock", …)` (the `UsersView`/`QualityProfilesView` pattern) instead of the form; (3) treats a server 401/403 (→ `.unauthorized`) as authoritative regardless of the local flag. Client gating is UX; the server enforces `requireAdmin`/`ensureAdmin` on every route as defense in depth.

**Phase-1 fix:** `isAdmin` refreshes only on login/library-reload, so a cold Settings open (no library loaded) or a mid-session promotion/demotion can be stale. Add `AppModel.refreshAdminIfNeeded()` and call it from `SettingsView.task`. This is the one behavior-adjacent change and it only *adds* rows for actual admins.

Account screens (Profile, Notifications, Activity, Devices, Notification Channels) sit **outside** the admin guard — every signed-in user reaches them.

### 4.6 Save / dirty-tracking; optimistic vs. refetch

Two save shapes, chosen per screen:
- **Auto-save-on-change** (as `NotificationsSettingsView`): each toggle writes immediately, reverts the single field on failure, sets `saveError`. Use for toggle-only screens and per-row switches (Books-enabled, metadata-source enable, device roster deletes).
- **Explicit Save/Cancel with dirty tracking** (new; the primary interaction): load a `loaded` snapshot, edit a `draft`, compute `isDirty = draft != loaded` (an `Equatable` value struct + pure `!=`), show Save (disabled unless dirty & valid) + Cancel (reverts) in the toolbar, a spinner while saving, inline error in `Theme.terracotta`. Use for all multi-field forms. The secret-field asymmetry (empty secret ≠ dirty) is extracted to `RawkoonKit` `SettingsDirty.isDirty(loaded:draft:secretEntered:)` and unit-tested.

**Optimistic-vs-refetch rule (never both on one screen):**
- Simple scalar/toggle forms → **optimistic with rollback** (apply to `@State`, write, restore + error on failure).
- CRUD lists and forms whose server response is authoritative (id assignment, ordering, normalization, `*_set` booleans) → **save then refetch `load()`**. Applies to quality profiles, custom formats, book quality profiles, OIDC, users, API keys, channels, metadata-source order.

### 4.7 Reusable SwiftUI components

New file **`Views/Settings/SettingsComponents.swift`** (+ `SettingsFormScaffold.swift`), companion to media-focused `Components.swift`. Every component uses `Theme` tokens inside `Form`/`Section` with `.listRowBackground(Theme.raised)`, `.scrollContentBackground(.hidden)`, `.background(Theme.base)`, `.tint(Theme.apricot)`, `.navigationBarTitleDisplayMode(.inline)`. API surface is fixed here; visual/interaction detail is deferred to the design pass.

| Component | Signature (shape) | Notes / edge cases |
|---|---|---|
| **LabeledTextFieldRow** | `(_ title, text: Binding<String>, placeholder:, keyboard: .default/.URL/.emailAddress/.numberPad, autocaps: Bool = false, mono: Bool = false)` | URLs: `.URL` + no autocaps + `.autocorrectionDisabled`. `mono` for paths/templates. |
| **SecretField / PasswordFieldRow** | `(_ title, input: Binding<String>, isStored: Bool, placeholder: String = "")` | `SecureField`; placeholder + omit-when-empty logic per §4.4. Never render the stored secret. |
| **ToggleRow** | `(_ title, isOn: Binding<Bool>, subtitle: String? = nil)` | Optional footnote in `Theme.muted`. |
| **PickerRow** | `(_ title, selection: Binding<T>, options: [(value: T, label: String)])`, `T: Hashable` | Menu `Picker`; supports a "None" sentinel. Country, resolution, client type, region, file operation, locale. |
| **SegmentedRow** | thin `Picker(...).pickerStyle(.segmented)` | 2–3 choices (SettingsView "Download over", Arr import source). |
| **MultiSelectRow** | `(_ title, selected: Binding<Set<T>>, options:, minSelection: Int = 0)` → pushes a checklist | Enforce `minSelection` by disabling the last checkmark. Languages, sources, codecs, RSS indexers. |
| **NumberFieldRow / NumberRow** | `(_ title, value: Binding<Int?>, range:, suffix: String? = nil)` + a `Double` variant | `.numberPad`/`.decimalPad`; empty = `nil`; clamp on commit; `suffix` "GB"/"MB"/"months"/"seconds". |
| **OrderedPickerRow** | ordered multi-select: chosen items reorderable (`.onMove` / up-down), unchosen below to add | Book allowed-formats, tracker priority. |
| **TrackerPriorityEditor** | specialization of `OrderedPickerRow<String>` over free-text slugs: add-by-text + reorder + delete | Trackers are arbitrary strings (no server enum). |
| **TestConnectionButton** | `(title: String = "Test connection", action: async -> TestResult)` where `TestResult = .success(String?) / .failure(String)` | idle → spinner → green ✓ / red message. Disabled while dirty **only if** the endpoint tests *saved* state. |
| **SaveCancelBar / SettingsFormScaffold** | `@Observable` dirty container holding `loaded`+`draft`; Save (disabled unless dirty & valid) + Cancel + spinner + inline error | Spine of every editable screen; on save success `loaded = draft`. |
| **CrudListScaffold** | generic over `Item: Identifiable`: `load`, `row`, `onDelete`, `addDestination`, `emptyState` | Loading spinner, error `ContentUnavailableView`, empty state, `List` with `.listRowBackground(Theme.raised)`, footer count, toolbar "+", row-tap edit, swipe-to-delete + confirm. Re-`load()` after any mutation. |
| **ConditionBuilderView** + **ConditionRow** | rows of (type, operator, value, negate) | The most complex primitive; shell built in Phase 1, the type→operator→value matrix (`RawkoonKit ConditionRules`/`ConditionCodec`) filled in Phase 4. |
| **SettingsStateView / JobStatusRow** | shared loading/error/empty helper; job state + progress line | `ProgressView().tint(Theme.apricot)` loading; `Theme.terracotta` error retry; `ContentUnavailableView` empty. `JobStatusRow` shared by reindex + migrate. Reuse `StatusBadge` from `Components.swift`. |

### 4.8 Error / permission handling

`APIError` (`unauthorized`/`http(Int)`/`decode`/`transport`) is the only surfaced error; every method funnels through `mapStatus` (401 **and** 403 → `.unauthorized`). Screens map it with a local `message(for:)` (copy `QualityProfilesView`): `.unauthorized` → "Admin only." (admin) or "Unauthorized. Check your credentials." (account); `.transport` → "Network error. Check your connection." **The server hides error detail** — the global `onError` swallows everything except `NOT_FOUND`/`VALIDATION` into a generic 500 `{ error: "Internal server error" }` — so **never parse or display a server error message**; map by status and show a fixed local string. The exceptions where a message *does* reach the client are `badRequest` (400 `{ error }`) paths explicitly noted per screen (library scan, test-connection failures, provider-error test dispatches); surface those, but treat a 400 as "check the input" when no message is present.

**Offline:** `AppModel.isOnline` / `withDeadline` — forms disable Save and show "You're offline" rather than hang; loads show the error footer + Retry and keep any locally-derived content (e.g. the synthetic "This device" row).

### 4.9 Proposed file layout

Views are flat today; introduce **one** subfolder. XcodeGen `sources: [Rawkoon]` globs recursively — no `project.yml` change for files under `Rawkoon/` (and none for RawkoonKit tests; the existing `.testTarget` picks them up). Do **not** bump `MARKETING_VERSION`.

```
apps/ios/Rawkoon/
├── APIClient.swift              # helpers promoted to internal
├── APIClient+Settings.swift     # NEW: ~50 settings methods
├── Models.swift                 # + settings DTOs
├── AppModel.swift               # + refreshAdminIfNeeded(), optional currentApnsToken
└── Views/
    ├── SettingsView.swift        # MODIFY: Account + Admin sub-sections, new NavigationLinks
    ├── NotificationsSettingsView.swift
    ├── DevicesView.swift         # NEW (Phase 1)
    └── Settings/
        ├── SettingsComponents.swift        # field components + SettingsStateView + JobStatusRow
        ├── SettingsFormScaffold.swift      # load/dirty/save/error + CrudListScaffold
        ├── ProfileView.swift
        ├── GeneralSettingsView.swift
        ├── integrations/
        │   ├── TmdbIntegrationView.swift
        │   ├── JellyfinIntegrationView.swift
        │   ├── LocalAiIntegrationView.swift
        │   ├── IndexerManagerIntegrationView.swift
        │   ├── DownloadClientView.swift          # MODIFY → editable
        │   └── DownloadClientHookView.swift
        ├── media/
        │   ├── MediaLibrarySettingsView.swift     # + scan + reindex sections
        │   ├── ArrLibraryImportView.swift
        │   ├── QualityProfilesView.swift          # MODIFY → CRUD
        │   ├── QualityProfileEditorView.swift
        │   ├── CustomFormatsView.swift
        │   └── CustomFormatEditorView.swift        # hosts ConditionBuilder
        ├── books/
        │   ├── BooksSettingsView.swift             # container: provider/audnexus/sources/files sections
        │   ├── BookQualityProfilesView.swift
        │   └── BookQualityProfileEditorView.swift
        └── admin/
            ├── UsersView.swift                     # MODIFY → CRUD
            ├── UserProvisioningView.swift
            ├── InvitationsView.swift
            ├── SessionsView.swift                  # sessions + web-push
            ├── ApiKeysView.swift
            ├── OidcProvidersView.swift
            ├── OidcProviderFormView.swift
            ├── JobsView.swift
            └── BlocklistView.swift
```

`SettingsView` restructures (add rows only, do not disrupt existing): a non-gated **Account** section (Profile, Notifications, Devices, Activity, Notification Channels); the existing **Requests & Alerts**; and inside `if model.isAdmin` sub-sections mirroring the web tabs — **Integrations**, **General**, **Media**, **Books**, **Users & Access**, **System**.

---

## 5. Phased plan

Ordering is guardrails-first: foundation and its shared components before the heavy CRUD, so the linter and compiler hold the new boundaries. Every phase ends green on `lint` + `kit` + `build` and passes a macbuild smoke pass. **No version bump, no release, in any phase.**

### Phase 1 — Foundation (+ device roster)

**APIClient methods (this phase):** the generic helpers (`put<T>`, `patchExpectOK`, `delete`/`deleteExpectOK`, `delete<T>`, plain-casing variants) and the split into `APIClient+Settings.swift`; plus the four **device-roster** methods (see below). **RawkoonKit:** `FormDirtyState.swift` / `SettingsDirty`, `ConditionRules.swift`, the secret-omission body builder, `SettingsValidation.*` — each with tests in `Tests/RawkoonKitTests/`. **Components:** `SettingsComponents.swift` + `SettingsFormScaffold.swift` (all §4.7 primitives, ConditionBuilder as a shell). **AppModel:** `refreshAdminIfNeeded()` wired into `SettingsView.task`; Admin sub-section skeleton; optional read-only `currentApnsToken`/`isCurrentDeviceRegistered`.

**Device roster — `DevicesView.swift` (all users, not admin-gated).** A read + single-delete list of every device registered to receive push for the current user. It is placed in Phase 1 as the first real consumer of the new plumbing (`apnsDevices()`, `webPushDevices()`, `deleteExpectOK`) — low risk, no form primitives, no admin gate. Three sections:
1. **This device** — synthetic row from `UIDevice.current.name`, `iOS {systemVersion}`, `App {CFBundleShortVersionString}`; **non-deletable** (it re-registers immediately).
2. **Other iOS devices** — remaining APNS rows (`device_name`, `iOS {os_version}` + `App {app_version}`, "Added {created_at}"), swipe-to-delete + confirm.
3. **Web browsers** — web-push rows (composed display name, "Added {created_at}"), delete.

APIClient methods to add:
```
func apnsDevices() -> ApnsDevicesResponse            // GET  /api/notifications/apns/devices
func deleteApnsDevice(id: Int)                        // DELETE /api/notifications/apns/devices/:id
func webPushDevices() -> WebPushDevicesResponse       // GET  /api/notifications/devices
func deleteWebPushDevice(id: Int)                     // DELETE /api/notifications/devices/:id
```
DTOs (`nonisolated … Decodable, Identifiable, Sendable`): `ApnsDeviceDTO { id: Int, deviceName: String?, osVersion: String?, appVersion: String?, createdAt: Date }`; `WebPushDeviceDTO { id: Int, endpoint: String, deviceName/osName/osVersion/browserName/browserVersion/platform: String?, createdAt: Date }`; plus `{ devices }` envelopes. Wire a `NavigationLink { DevicesView() }` labeled `Label("Devices", systemImage: "iphone")` into the Account section.

*Edge cases:* the APNS list omits `device_token`, so match "this device" heuristically by `deviceName == UIDevice.current.name` (and optionally app version); worst case a user sees their device twice (benign). Both DELETEs return **400** (`badRequest`) — not 404 — when the id isn't the caller's or is already gone: on any delete error, refetch rather than only rolling back. Load `apnsDevices()` and `webPushDevices()` independently (`try?`) so one failing doesn't blank the other; keep the synthetic "This device" row rendered offline.

**macbuild exit criteria:** `swift test` (RawkoonKit) green including the new pure-logic tests; `swiftformat --lint`/`swiftlint` clean; `xcodegen generate` + `xcodebuild build -scheme Rawkoon -destination 'generic/platform=iOS Simulator' CODE_SIGNING_ALLOWED=NO` → BUILD SUCCEEDED (pull first, confirm the commit — stale-git trap); Devices screen loads and deletes round-trip against a dev server.

### Phase 2 — Simple integrations & General

Single-object GET/PUT (or PATCH) forms with a secret and/or a toggle — no CRUD lists. All admin-only except where noted. Screens: **General**, **TMDB**, **Jellyfin**, **Local AI**, **Prowlarr/Jackett** (one parameterized view), **Audnexus** (Books provider, admin). *(The Books-provider **Audnexus** and **Google Books** GET/PUT/test forms are simplest-shape and land here; the rest of the Books tab is Phase 3.)*

**General — `GeneralSettingsView.swift`** — `GET/PATCH /api/settings` (`{ settings }`). Fields: Country code `PickerRow` (ISO-2, server `^[A-Z]{2}$`); Look-ahead window `PickerRow` 3/6/12/24 months (server 400s otherwise); Languages `MultiSelectRow` en/fr/de/es/it/pt/ja/ko, **min 1** enforced client-side; Save. **Never send `books_enabled`** from here (PATCH is partial; the Books domain owns it). CSV split/joined in the view.

**TMDB — `TmdbIntegrationView.swift`** — Enabled toggle; API key `SecretField` (write-only, no flag → "Leave blank to keep existing key"); Popularity threshold `NumberFieldRow` 0–100 (clamp client + server).

**Jellyfin — `JellyfinIntegrationView.swift`** — Enabled; Website URL `LabeledTextFieldRow(.URL)` (server validates); API key `SecretField`. **No test-connection endpoint** — do not add a Test button.

**Local AI — `LocalAiIntegrationView.swift`** — Enabled; Base URL (server strips trailing slash); Model text; **TestConnectionButton**. No secret. The test endpoint returns **404** (disabled/unconfigured) or **502** (unreachable/no models) with `{ error }` — give `testLocalAi()` a bespoke implementation that decodes the error body on non-2xx so the user sees the server message; on success show "Connected — N models" and, if `modelAvailable == false`, a warning.

**Prowlarr & Jackett — `IndexerManagerIntegrationView.swift`** (one view, enum `IndexerManagerKind`) — Enabled; Website URL; API key `SecretField`; **RSS indexers** `MultiSelectRow` populated from `.../indexers`. Selection is `Set<String>` of **slugs** (not ids). `.../indexers` returns data only when the manager is **enabled and already saved** — on first configure it's `[]`; if empty, show "Save and enable the connection to choose RSS indexers," and re-fetch after a successful save. Footnote when enabling: "This is now the active indexer manager" (server sets `activeIndexerManager`). Do not confuse with the existing read-only `IndexersView` (hits `/api/medias/indexers`).

**Audnexus — Books provider section (admin)** — Enabled; Region `PickerRow` (11 fixed: us/ca/uk/fr/de/es/it/au/br/in/jp with the web labels); Server URL text (no secret); Save (full round-trip); **TestConnectionButton** using the *typed* base_url + region. **Google Books** (also here): API key `SecretField` (`hasApiKey` → "Key is stored"); Save sends `enabled: true` always, clears field on success; Test sends `apiKey: field.isEmpty ? nil : field` (nil = test stored key; omit when nil).

**Phase-2 APIClient methods** (all reuse the generics; snake_case except the hook in Phase 3):
```
generalSettings / updateGeneralSettings           // GET/PATCH /api/settings
tmdbIntegration / saveTmdbIntegration             // GET / PUT  /api/integrations/tmdb
jellyfinIntegration / saveJellyfinIntegration     // GET / PUT  /api/integrations/jellyfin
localAiIntegration / saveLocalAiIntegration / testLocalAi   // GET / PUT / GET .../test
prowlarrIntegration / saveProwlarrIntegration / prowlarrIndexers
jackettIntegration  / saveJackettIntegration  / jackettIndexers
audnexusIntegration / updateAudnexusIntegration / testAudnexus
googleBooksIntegration / updateGoogleBooksIntegration / testGoogleBooks
```
DTOs per the field lists above; every PUT returns `{ success, integration }` (or `{ integration }` for Audnexus/GoogleBooks), decoded via a `…SaveResponse { let integration }` wrapper. `IntegrationTestResult { success: Bool, error: String? }` shared by the test buttons.

**macbuild exit criteria:** all seven+ forms build; a secret blank-saves without wiping (verify by reloading the web UI); an edit round-trips to the same value on the web; non-admin account sees no admin entry points; `swift test`/`lint` green.

### Phase 3 — Media & Books non-CRUD

Bigger single forms and job runners, still no full CRUD lists. All admin-only.

**Media Library Settings — `MediaLibrarySettingsView.swift`** — `GET/PATCH /api/library/post-processing/settings`. **PATCH is partial** — send **only the media-owned keys**; never the book fields (they share the row and belong to Books B5). Fields: Post-processing enabled toggle; Movies/Shows/Downloads paths (mono); File operation `PickerRow` hardlink/move; Movie/Episode templates (mono, maxLength 500); Min seed ratio (Double 0–100); Active indexer manager `PickerRow` Prowlarr/Jackett/None; Default movie & show quality-profile `PickerRow` (profiles + "None"); Save. **Reuses the already-shipped `qualityProfiles()` read** for the profile pickers (so Phase 3 is *not* blocked by the Phase-4 profile editor); an orphaned saved id falls back to "None." Active-indexer-manager options optionally filter on the Phase-2 `prowlarr()/jackett()` `.enabled` reads; self-contained fallback is to offer both + None. **Nullable-id/manager PATCH:** build the body as `[String: Any]` inserting only changed keys (mirrors the server's `!== undefined`; add `sendPatchRaw`) rather than double-optional gymnastics.

**Library scan** (section in the above, or `LibraryScanView`) — Scan path text (maxLength 4096); Scan type `PickerRow` movie/show; Run (async, spinner, button disabled during — synchronous, potentially slow, no status endpoint); Result "Matched N" + unmatched basenames. 400 if TMDB unconfigured or path inaccessible — `badRequest` reaches the client as `{ error }`; show it when present, else a generic "check the path / TMDB." Idempotent for existing titles.

**Reindex languages** (section, or standalone) — Start button (disabled while active/waiting); readonly `JobStatusRow` (state, current/total, updated/skipped/errors, current file, timestamps). `POST /api/library/reindex-languages` → `{ job_id }` (400 "already running" → just start polling); poll `GET .../status` (plain JSON) every 2–3s while `active`/`waiting`, cancel the `Task` in `.onDisappear`; `unknown` = never run.

**Arr import — `ArrLibraryImportView.swift`** — Source `SegmentedRow` both/radarr/sonarr; Radarr/Sonarr URL + **password** API-key fields (shown per source); Start (disabled while active); progress/result + Retry. Keys are per-call (never persisted/returned) — always send what's typed, hide the irrelevant source's fields. `POST /api/library/migrate` → `{ job_id }` (400 "already running" → follow the existing job). **Status is SSE-only** (`text/event-stream`) — `URLSession` has no native `EventSource`; **consume the stream** via `URLSession.bytes(for:)`, iterate `.lines`, parse `data:` lines into `LibraryMigrateStatus`, exposed as `libraryMigrateStatusStream() -> AsyncThrowingStream<…>` (set `Accept: text/event-stream`, carry the bearer, handle end/cancel in `.onDisappear`; restart the stream on foreground). Fallback (flag, don't assume): a new backend `GET .../status.json`. This SSE line-reader is the one net-new plumbing piece in the domain; land it here.

**Books — `BooksSettingsView.swift`** container (the Provider/Audnexus GET/PUT/test forms shipped in Phase 2; the rest here):
- **B1 General** — Books-enabled `ToggleRow`. `canEnable = googleBooksHasKey || booksEnabled` (disable + amber "needs a provider key" when false — needs B2's `hasApiKey`); second amber warning when enabled but a books/audiobooks path is missing (needs B5). `PATCH /api/settings` with only `books_enabled`; optimistic rollback.
- **B4 Metadata sources** — `GET /api/books/metadata-sources` (`requireUser`) / `PUT` (`requireAdmin`), body/response `{ order: [String] }`. The order array **is** the enable list (absent = disabled). Four sources (`local`, `audnexus`, `googlebooks`, `openlibrary`) with labels/hints; render with the up/down `OrderedPickerRow` + a "Disabled" sub-group. Keep `[String]` (not an enum) so a future source round-trips; render unknown ids with a fallback label. Saving empty restores the server default order (re-seed from the response); seed once from GET, don't clobber in-progress edits.
- **B5 Files & Audiobookshelf** — the **book-specific** fields of the shared post-processing row: Books/Audiobooks paths, Book/Audiobook templates (mono), Default book quality profile `PickerRow` (reads `GET /api/book-quality-profiles`), Audiobookshelf URL + audiobook/ebook library-ID GUIDs; Save via `PATCH`. **Critical:** the body must **always emit its keys** including explicit JSON `null` for cleared strings (a plain `String?` is omitted by `JSONEncoder`, silently keeping the old value) — use a manual `encode(to:)` with `try c.encode(optional, forKey:)` so blanks persist as `null` (matches web's `path.trim() || null`). Send **only** the eight book fields (never movie/show). Seed keyed on `updatedAt`; after save, re-seed so B1's "needs paths" warning clears.

**Phase-3 APIClient methods:**
```
mediaLibrarySettings / updateMediaLibrarySettings   // GET/PATCH /api/library/post-processing/settings (media subset)
scanLibrary                                         // POST /api/library/scan
startReindexLanguages / reindexLanguagesStatus      // POST + GET /api/library/reindex-languages(/status)
startLibraryMigrate / libraryMigrateStatusStream    // POST /api/library/migrate  + SSE .../status
appSettings / updateAppSettings                     // GET/PATCH /api/settings (books_enabled)  [shared w/ General]
bookMetadataSources / updateBookMetadataSources     // GET/PUT /api/books/metadata-sources
updateBookFilesSettings                             // PATCH .../post-processing/settings (book subset, explicit-null body)
bookQualityProfiles (read)                           // GET /api/book-quality-profiles  [shared w/ Phase 4]
downloadClient (exists) / saveDownloadClient / testDownloadClient
downloadClientHook / saveDownloadClientHook / rotateDownloadClientHook   // camelCase plain helpers
```

**Download Client — make `DownloadClientView.swift` editable + `DownloadClientHookView.swift`.** Form: Enabled; Client `PickerRow` qBittorrent/Transmission/Deluge (drives username visibility); Website URL; Username (**hidden for deluge**); Password `SecretField` (placeholder from `passwordSet`); Label (default "rawkoon"); Save path; **TestConnectionButton**. Keep the existing live-speed header. Blank password + `passwordSet == false` → 400; test returns `{ ok, error? }` at **200 even on failure** (unlike Local AI) — decode and show `error`. **Hook view** (camelCase, **unwrapped** responses — use the plain-casing helpers): Status `StatusBadge` (active/foreign-program/stale/awaiting-first/not-configured) + text; Callback URL (nullable — empty serializes to `null`/`""` to clear; omit key to keep); Auto-configure toggle; Active-hooked seconds `NumberFieldRow` (≥1); Last seen (relative); Save/Cancel; **Rotate secret** (destructive, confirm "Old callback URLs stop working," then refresh the whole object from the rotate response); copyable qBittorrent command / Deluge & Transmission scripts (`.textSelection`, shown for foreign-program/manual cases).

**macbuild exit criteria:** all Media & Books forms build and round-trip; the SSE migrate stream renders live progress and survives a background/foreground; a cleared path in B5 persists as null (verify on web); the hook camelCase methods decode; `swift test`/`lint` green.

### Phase 4 — Heavy CRUD

Four nested list → editor-modal editors sharing `CrudListScaffold` + `EditorModal` + `ConditionBuilder`. Build the scaffold logic first (its non-view dirty/delete-confirm pieces unit-tested in `RawkoonKit`). Three are admin-write/all-read (admin-gated); **Notification Channels is per-user** (not admin-gated). New private helper `deleteExpectOK` and a `JSONValue` enum (`.string/.int/.bool/.array/.object/.null`) for heterogeneous channel config.

**Media Quality Profiles — convert `QualityProfilesView.swift` → CRUD + `QualityProfileEditorView.swift`.** `qualityProfiles()` exists but decodes a truncated model — **expand `QualityProfile`** (add `preferredSources/Codecs/Languages: [String]`, `preferredSearchLanguage: String?`, `prioritizedTrackers: [String]`, `preferTrackerOverQuality: Bool`, `customFormats: [AssignedFormat]`); the read-only list keeps working. Add `createQualityProfile` (POST → `{ profile }` 201), `updateQualityProfile` (PUT `:id`), `deleteQualityProfile` (DELETE `:id` → `{ success }`). Editor fields: Name (required, 409 on dup); Min resolution `PickerRow` 480/720/1080/2160 (required); Cutoff `PickerRow` None+those; Preferred sources multiselect (REMUX/BluRay/WEB-DL/WEBRip/HDTV); Preferred codecs (HEVC/AVC/AV1/VP9); Preferred languages (en/fr/VFF/VFQ/VF2/VFI/TRUEFRENCH/de/es/it/ja/pt); Preferred search title language `PickerRow` (2-letter, `^[a-z]{2}$`, empty→null); Prioritized trackers `TrackerPriorityEditor`; Prefer/Require HDR toggles (**always sent**); Max size (GB, nullable Double); Min seeders (int ≥0); **Custom-format assignments** (list of {custom_format_id, score, required, forbidden}, picked from `customFormats()`). **Required in the body:** `name`, `min_resolution`, `preferred_sources`, `preferred_codecs`, `require_hdr`, `prefer_hdr`. Delete blocked → 409 "Cannot delete profile while library items are assigned" (surface verbatim); unknown `custom_format_id` → 400 (refetch formats).

**Custom Formats — `CustomFormatsView.swift` + `CustomFormatEditorView.swift`.** New: `customFormats()` (GET → `{ custom_formats }`, also consumed by the profile assignment editor), `createCustomFormat`/`updateCustomFormat`/`deleteCustomFormat`. Fields: Name (required, 409 dup); **Conditions** via `ConditionBuilder` — ordered rows, **≥1 required** (empty → 400 `conditions_empty`). Each row: type → allowed operators → value shape → negate, mirroring `customFormatValidation.ts` exactly:

| Type | Operators | Value |
|---|---|---|
| `title_regex`, `release_group` | `matches` | regex text (≤100; reject ReDoS-shaped/invalid client-side) |
| `source`, `codec`, `indexer`, `language` | `equals` | text |
| `resolution`, `seeders`, `size_range` | `gte lte lt gt equals between` | number; `between` → two numbers |
| `hdr_flag`, `proper_repack`, `freeleech` | `is_true` | no value |

The type→operator→value coupling (reset incompatible operator/value on type change) is the riskiest logic; encode the allow-tables as Swift dictionaries mirroring the validator, and put UI-rows ⇄ condition-JSON serialization in `RawkoonKit ConditionCodec` (tested). `operator` is a Swift keyword → `CodingKeys { case op = "operator" }`; `FormatConditionValue` decodes `String`/`Double`/`[Double]`. 400 codes to surface as friendly messages: `regex_too_long/regex_unsafe/regex_invalid`, `condition_type_invalid`, `operator_invalid_for_type`, `value_invalid_for_operator`, `negate_invalid`; delete blocked → 409.

**Book Quality Profiles — `BookQualityProfilesView.swift` + `BookQualityProfileEditorView.swift`.** **Verb is PATCH, not PUT.** `bookQualityProfiles()` (GET → `{ profiles }`), `createBookQualityProfile` (POST), `updateBookQualityProfile` (**PATCH** `:id`), `deleteBookQualityProfile` (DELETE → `{ deleted }`). Fields: Name (409 dup); Kind `PickerRow` ebook/audiobook/both (required); Allowed formats `OrderedPickerRow` (non-empty; ebook: epub/azw3/mobi/pdf/cbz; audiobook: m4b/mp3/flac/ogg; both: union); Cutoff format `PickerRow` None+allowed (must be within allowed); Prefer retail toggle (default true); Min seeders (int); Max size (MB, nullable); Min audio bitrate (nullable, **hidden for ebook**); Preferred languages multiselect; Prioritized trackers `TrackerPriorityEditor`; Prefer-tracker toggle. On Kind change, prune invalid formats/cutoff and show/hide bitrate (mirror `validateBookProfileFormats`). 400s: format/kind mismatch, cutoff not in allowed, empty allowed_formats; **delete is not blocked** (editions fall back to defaults).

**Notification Channels — `NotificationChannelsView.swift` + `NotificationChannelEditorView.swift` (per-user, NOT admin-gated).** Under `/api/notifications`, every row scoped to `user.id` — place under Requests & Alerts / Notifications. `notificationChannels()` (GET → `{ channels }`), `createNotificationChannel`, `updateNotificationChannel` (**PATCH**, partial — enable-toggle sends just `enabled`), `deleteNotificationChannel`, `testNotificationChannel` (POST `:id/test` → `{ success }`; a failing dispatch returns **400 with the provider error in the body** — decode and show it). Common fields: Label (1–100), Type `PickerRow` (create-time, immutable after), Enabled (row toggle via PATCH). Per-type config (swaps on Type change, sent as free-form `config` with exact snake_case keys):

| Type | Fields | Rules |
|---|---|---|
| `ntfy` | Server URL, Topic; Access token (opt); Priority (opt 1–5) | |
| `telegram` | Bot token, Chat ID | |
| `discord` | Webhook URL | |
| `gotify` | Server URL, App token; Priority (opt 1–10) | |
| `pushover` | API token, User key; Priority (opt −2…1) | |
| `slack` | Webhook URL | |
| `webhook` | URL (`{{title/body/url/image}}`), Method GET/POST (default POST), Body template (POST-only, valid JSON after substitution) | body template hidden for GET |

Model config as a `[String: JSONValue]` (or a type-keyed enum). GET returns full config unredacted, so secrets can prefill — still show masked `SecretFieldRow` and never log config. To change provider, delete + recreate. Enforce per-provider priority ranges in the picker; validate the webhook body template as JSON client-side; optimistic enable-toggle with rollback.

**macbuild exit criteria:** all four editors create/edit/delete round-trip; delete-blocked 409s surface verbatim; the condition builder produces JSON the server accepts on every type; the expanded `QualityProfile` still decodes the existing list; `swift test` (incl. `ConditionCodec`, `SettingsDirty`) and `lint` green.

### Phase 5 — Admin & Account

Account-write and destructive-admin surfaces last, when the shared layer is proven. New non-gated **Account** section (Profile, Activity); the rest under `if model.isAdmin`.

**Profile — `ProfileView.swift` (all users).** Move the editable account fields out of `SettingsView`. Email readonly `LabeledContent` `.textSelection`; First/Last name editable, dirty-tracked Save; Change-password sub-section (Current, New min-8, Confirm-match, all `SecureField`) → `updateProfile` (`PUT /api/users/me`, `putExpectOK`) + `changePassword` (`POST /api/users/me/password`, `postExpectOK`). Enforce min-8 + match client-side; wrong current password → 400 → "Current password is incorrect" (map by status). **Avatar: read-only display in Phase 5** (upload deferred — needs a multipart body builder + `PhotosPicker` + square crop; `POST /api/users/me/avatar` accepts a real multipart part as a `File`). **Passkeys: list + delete only** (`GET /api/auth/passkey/list-user-passkeys`, `POST .../delete-passkey`); native registration deferred (needs `ASAuthorizationController`, an associated-domains entitlement, and an AASA file self-hosters may not serve) — show "Add a passkey from the web app." Omit nav-rail position (no iPhone analogue).

**Activity — extend `ActivityView.swift` (all users, read-only).** Add service + type filters and "Load more" (+25). `activityFeed(limit:service:type:)` — one-line signature change (nil query values already dropped). Pull-to-refresh + explicit Load more; no SSE.

**Users — extend `UsersView.swift` → CRUD (admin).** `adminUsers()`/models exist. Rows gain: Toggle role admin↔user (`setUserRole`, `PATCH /api/admin/users/:id/role`), Reset password (`resetUserPassword`, `POST .../reset-password`, min-8, revokes that user's sessions server-side — say so in the confirm), Delete (`deleteUser`, `DELETE :id`). Toolbar + → provisioning sheet. Last-admin demote → 400 (surface + rollback badge); self-delete → 400 (hide Delete on the current user's own row — add `id` to `SessionUser`/`SessionResponse` for the comparison, or rely on the 400).

**User provisioning — `UserProvisioningView.swift` (admin sheet).** `SegmentedRow` between two forms: Generate invitation (Email, Locale, admin toggle → `createInvitation` `POST /api/admin/invitations` → `{ token }`, keep sheet open to show the copyable link) and Add user directly (First/Last opt, Email, Password min-8, Locale, admin → `createUser` `POST /api/admin/users` 201, dismiss + refresh). Duplicate email / bad format / pending-invite → 400 (map by status).

**Invitations — `InvitationsView.swift` (admin).** `invitations()` (GET), `resendInvitation` (POST `:id/resend` → `{ token }`), `revokeInvitation` (DELETE `:id`). Rows: email, status `StatusBadge`, dates, invited-by. **Link built client-side:** `"\(model.serverURL)/accept-invitation?token=\(token)"` in a copyable row with a "single-use, expires in 7 days" note (`UIPasteboard`/share sheet). Resend/revoke 400 on non-pending → disable on those rows. `id` is `Int`.

**Sessions + Web-push — `SessionsView.swift` (admin).** `adminSessions()` (GET); `revokeSession` (DELETE `:id`), `revokeUserSessions` (DELETE `/user/:userId`). Rows: user, device (browser/OS), IP, provider, dates; Revoke per row; Revoke-all when >1. Revoking one's own current session logs the phone out — warn in the confirm. Second section: `webPushSubscriptions()` (GET) + `deleteWebPushSubscription` (DELETE `:id`, `id` is `Int`); rows show user, device, truncated endpoint. Skip provider icons.

**API keys — `ApiKeysView.swift` (admin).** `apiKeys()` (GET), `createApiKey` (POST → 201 `{ key, api_key }`), `deleteApiKey` (DELETE `:id`). Rows: name, prefix `start…`, last used, expires, created; Revoke. Create sheet: Name (required, 400 on dup), Expiry days 1–365 (validate client-side); on success present the **one-time plaintext key** in a copyable panel — the sheet must not dismiss until acknowledged; store in `@State` only.

**SSO / OIDC — `OidcProvidersView.swift` + `OidcProviderFormView.swift` (admin, heaviest CRUD).** `oidcProviders()` (GET), `createOidcProvider` (POST → 201), `updateOidcProvider` (PUT `:id`), `deleteOidcProvider` (DELETE `:id`) under `/api/integrations/oidc`. Form: Provider name; **Slug** (create-only, readonly on edit, `^[a-z0-9-]+$`); **Redirect URI** readonly/copyable, **computed client-side** `"\(model.serverURL)/api/auth/oauth2/callback/\(slug)"` (updates live as slug typed, not returned by the API); Discovery URL (http(s)); Icon URL (opt, http(s)); Client ID; **Client secret** `SecretField` write-only (GET returns only `clientSecretSet`; on edit placeholder "Leave blank to keep existing," include in PUT only when non-empty); Enabled toggle (a field, no separate endpoint).

**Jobs — `JobsView.swift` (admin, poll not SSE).** `scheduledJobs()` (GET, scheduler state + queue stats + repeatable jobs), `triggerAction(action)` (POST `/trigger-action`; the 10 fixed action strings hard-coded in the view), `queueJobs(name:status:limit:)` (GET, returns a **bare array**), `retryQueueJob`, `retryFailedJobs`, `cleanQueue(status:grace:)` (DELETE with query, behind a confirm), `jobHistory(limit:)` (GET). Scheduled list with per-job Run; queue overview with per-status lists + Retry-all-failed / Clean / Retry-single; read-only history (last 50). **Web uses SSE for live queue updates — iOS polls** on pull-to-refresh (and optionally a `.task` timer); the one-shot endpoints carry everything the stream did. Retry-single 400 if not failed; clean/retry 400 on unknown queue.

**Blocklist — `BlocklistView.swift` (admin).** `blocklist()` (GET `/api/medias/blocklist`), `unblock(id:)` (DELETE `:id`). Rows: release title, indexer, reason, blocked-at; Unblock (confirm). `id` is `Int`; delete 404 if already gone → treat as success/refresh; server caps at 500 (no client paging).

**macbuild exit criteria:** every admin screen builds, gates for a non-admin account, and round-trips; the one-time API-key/invite reveals work; the OIDC client-secret blank-save keeps the stored secret; profile name + password changes persist; Jobs polling refreshes; state-preservation smoke pass (below) passes; `swift test`/`lint` green.

---

## 6. The single web-side change (device roster)

Companion to iOS Phase 1 (sequenced as small, additive Phase-2-adjacent web work; ships independently). Splits `NotificationsTab.tsx`'s flat device list into **Web push** and **iOS app** groups, each with its own loading/empty state and the same destructive-confirm delete flow. No admin gate, no API route changes (the APNS list/delete endpoints already exist).

- **`apps/shared/src/types/notification.ts`** — add `export interface ApnsDevice { id: number; device_name: string | null; os_version: string | null; app_version: string | null; created_at: string }` and `export interface ApnsDevicesResponse { devices: ApnsDevice[] }`. Do not touch the existing `NotificationDevice`/`NotificationDevicesResponse` (web-push contract). The APNS list omits `device_token` deliberately.
- **`apps/web/src/lib/endpoints/notifications.ts`** — `APNS_DEVICES: "/api/notifications/apns/devices"`, `DELETE_APNS_DEVICE: (id) => .../apns/devices/${id}`.
- **`apps/web/src/lib/queryKeys.ts`** — `apnsDevices: () => [...notifications, "apns-devices"] as const`.
- New hooks `useApnsDevices.ts` / `useDeleteApnsDevice.ts` — mirror the existing web-push hooks (5-min `staleTime`; `onSuccess` invalidates the apns key).
- **`NotificationsTab.tsx`** — call the two hooks; wrap current rows in a "Web push" sub-heading; add a parallel "iOS app" block (`device_name || iosDevice`, "Added {date}", `iOS {os_version}` + `App {app_version}`, delete). Reuse `formatDate`; add `getApnsDeviceDisplayName` and `handleDeleteApnsDevice`.
- **Locales** `apps/web/src/locales/{en,fr}/common.json` under `settings.notifications`: `webPushDevices`, `iosDevices`, `noWebPushDevices`, `noApnsDevices`, `iosDevice`, `iosVersionLabel`, `appVersionLabel`, `deleteApnsDeviceConfirm`, `apnsDeviceDeleted`, `deleteApnsDeviceError`, `loadingApnsDevices` (EN shown; add FR). Both DELETEs return **400** (not 404) when the id isn't the caller's — handle as "already gone."

---

## 7. Cross-cutting

**Localization deferral.** All new user-facing strings are **English inline literals** placed directly inside a `Text`/`LocalizedStringKey`-typed argument (never built into a `let` first), so the future `.xcstrings` extraction pass picks them up automatically. Do **not** add a catalog, `String(localized:)`, or `fr` resources now. Match `SettingsView` conventions (including the `\u{…}` escape idiom for em-dashes).

**State-preservation guarantee.** Nothing this milestone touches disturbs the three protected stores: **Keychain** (`server_url`/`auth_token`/`device_id`, service `cloud.samlo.rawkoon` — settings screens only *read* the session via `model.api()`/`currentUser()`; no `Keychain.set/delete`), the **position journal** (`positions.log`), and the **downloaded library** (`FileStore` + reading-progress). Settings are network read/write only. "Delete Downloads" in `SettingsView` stays exactly as-is; parity adds no new destructive path over downloaded files. **Verified in each phase's smoke pass:** update over an existing install → still logged in, an in-progress audiobook resumes at position, a downloaded book still plays offline.

**Testing strategy.** Only `RawkoonKit` compiles on Linux (`kit` job, `swift test`) — the app target and Views do not. Push every non-trivial *decision* down as a pure, tested function: field validation (`SettingsValidation.*`), dirty-diff incl. secret asymmetry (`SettingsDirty.*`), condition serialization (`ConditionCodec.*`), the secret-omission body builder, and fixture-decode contract tests for the branching DTOs (the only automated drift alarm). The SwiftUI forms themselves, `model.api()` wiring, and navigation stay view-only, proved by the macbuild build + a **manual round-trip smoke pass** per phase (load shows current values; edit + save persists and reloading the web UI confirms the same value round-tripped through the shared endpoint; secret fields keep the stored secret on blank-save; admin gating hides screens for a non-admin account). This deliberately matches the untested house-style view layer rather than the audit's MVVM aspiration.

**No-release rule.** Each phase ends with `main` green on `lint` + `kit` + `build` (the three non-uploading CI jobs) plus the macbuild smoke pass — that is "shippable," **not** a TestFlight upload. **The `macbuild` ssh host is the only real iOS gate**: a green Linux run proves only `RawkoonKit`; it does not compile the app, its Views, or `APIClient`. Watch the stale-git trap — pull and confirm the commit before trusting `BUILD SUCCEEDED`. **No agent cuts a release, bumps a version, tags, or publishes** — the `testflight` job is gated on a published GitHub release, and publishing one also triggers `docker-publish.yml` → auto-redeploys production via `DEPLOYER_WEBHOOK_URL`, an outward-facing act reserved to the user. If a gate can only be met by releasing, the gate is wrong — say so and stop.

---

## Master APIClient method list (deduped, by domain)

*Generic helpers (Phase 1):* `put<T>`, `patchExpectOK`, `delete(path:query:)`, `deleteExpectOK`, `delete<T>`, plain-casing `getPlain/putPlain/postPlain`, `sendPatchRaw`; `JSONValue` enum.

- **Devices (Phase 1):** `apnsDevices`, `deleteApnsDevice`, `webPushDevices`, `deleteWebPushDevice`.
- **General/Settings (Phase 2, shared):** `generalSettings`/`appSettings`, `updateGeneralSettings`/`updateAppSettings`.
- **Integrations (Phase 2):** `tmdbIntegration`/`saveTmdbIntegration`; `jellyfinIntegration`/`saveJellyfinIntegration`; `localAiIntegration`/`saveLocalAiIntegration`/`testLocalAi`; `prowlarrIntegration`/`saveProwlarrIntegration`/`prowlarrIndexers`; `jackettIntegration`/`saveJackettIntegration`/`jackettIndexers`; `audnexusIntegration`/`updateAudnexusIntegration`/`testAudnexus`; `googleBooksIntegration`/`updateGoogleBooksIntegration`/`testGoogleBooks`.
- **Download client (Phase 3):** `downloadClient` (exists), `saveDownloadClient`, `testDownloadClient`, `downloadClientHook`, `saveDownloadClientHook`, `rotateDownloadClientHook`.
- **Media library (Phase 3):** `mediaLibrarySettings`, `updateMediaLibrarySettings`, `scanLibrary`, `startReindexLanguages`, `reindexLanguagesStatus`, `startLibraryMigrate`, `libraryMigrateStatusStream`; reuse `qualityProfiles()` (exists).
- **Books non-CRUD (Phase 3):** `bookMetadataSources`, `updateBookMetadataSources`, `updateBookFilesSettings`, `mediaPostProcessingSettings` (shared with media), `bookQualityProfiles` (read, shared with Phase 4).
- **Heavy CRUD (Phase 4):** `createQualityProfile`, `updateQualityProfile`, `deleteQualityProfile` (+ expanded `QualityProfile`); `customFormats`, `createCustomFormat`, `updateCustomFormat`, `deleteCustomFormat`; `createBookQualityProfile`, `updateBookQualityProfile` (PATCH), `deleteBookQualityProfile`; `notificationChannels`, `createNotificationChannel`, `updateNotificationChannel` (PATCH), `deleteNotificationChannel`, `testNotificationChannel`.
- **Admin & account (Phase 5):** `updateProfile`, `changePassword`, `passkeys`, `deletePasskey`; `activityFeed` (extend); `setUserRole`, `resetUserPassword`, `deleteUser`; `createInvitation`, `createUser`, `invitations`, `resendInvitation`, `revokeInvitation`; `adminSessions`, `revokeSession`, `revokeUserSessions`, `webPushSubscriptions`, `deleteWebPushSubscription`; `apiKeys`, `createApiKey`, `deleteApiKey`; `oidcProviders`, `createOidcProvider`, `updateOidcProvider`, `deleteOidcProvider`; `scheduledJobs`, `triggerAction`, `queueJobs`, `retryQueueJob`, `retryFailedJobs`, `cleanQueue`, `jobHistory`; `blocklist`, `unblock`.

**Cross-phase dependencies resolved:** the Media default-quality-profile pickers and the Books default-book-profile picker consume the **already-shipped** `qualityProfiles()` / a read-only `bookQualityProfiles()` — Phase 3 does **not** block on the Phase-4 editors. The active-indexer-manager option filter optionally consumes Phase-2 `prowlarr()/jackett()` reads with a self-contained fallback. Notification-channel and quality-profile custom-format assignment both need `customFormats()`, built in Phase 4. `mediaPostProcessingSettings` GET/PATCH is one shared endpoint owned by Media (movie/show subset) and Books (book subset) — never send the other domain's keys.

---

## 8. Risks & open questions (ranked)

1. **Silent Codable drift (HIGH).** Hand-mirrored DTOs, no compiler link. Mitigated by defensive optionals, `String`-backed open enums, fixture-decode tests for branching shapes, and field lists copied from real route handlers. *Open:* fixtures for every endpoint, or only the branching shapes + manual round-trip for scalar forms? Recommendation: fixtures for conditions/quality-profiles/download-client; manual for scalar forms.
2. **Secret-field wipe (HIGH).** A naive `JSONEncoder` emits `null` for an untouched secret, which the server may read as "clear it." Every secret-bearing body uses `encodeIfPresent`; the omission builder is a tested `RawkoonKit` function. *Open, per-endpoint:* confirm missing-key vs `null` vs `""` are equivalent against `apps/api/src/routes/integrations/*` before Phase 2; each per-screen spec states its exact "keep existing secret" contract.
3. **`isAdmin` staleness (MEDIUM).** Refreshes only on login/library-reload. `refreshAdminIfNeeded()` on Settings entry + per-screen self-guard + 401/403 authoritative. *Open:* a cheaper "am I admin" endpoint than `currentUser()`? `currentUser()` is fine but re-fetches the whole session.
4. **APIClient file size vs `file_length` (MEDIUM).** +50 methods on a 1009-line file trips SwiftLint. Resolved via `APIClient+Settings.swift` + promoting helpers to `internal` (Phase 1). *Open:* confirm the `.swiftlint.yml` threshold.
5. **Condition builder complexity (MEDIUM).** 12 types × per-type operators × value kinds (ranges, booleans) × negate — the most complex UI and most drift-prone serialization. Isolated to Phase 4 + a tested `ConditionCodec`. *Open:* pin the exact condition JSON schema from `apps/api` custom-formats route, not the web TS alone.
6. **No automated view coverage (MEDIUM, accepted).** Matching house style over the audit's VM layer leaves the forms untested; correctness rests on the macbuild manual smoke pass. Deliberate, documented. *Open:* is the per-phase manual round-trip acceptable as the parity proof, or should one representative screen get a macbuild-only UI test target?
7. **Passkey WebAuthn registration (LOW / deferred).** Native register needs `ASAuthorizationController`, an associated-domains entitlement, and a self-hosted AASA file. Ship list + delete; flag register as a known parity gap.
8. **Avatar multipart upload (LOW / deferred).** `POST /api/users/me/avatar` is `multipart/form-data`; `APIClient` only does JSON today. Ship read-only display; add one multipart method + `PhotosPicker` + square crop as a follow-up. *Open:* crop-parity fidelity (web uses `ReactCrop` 1:1) — recommend a simple square crop.
9. **Client-only preferences (LOW, intentional non-parity).** Web nav-rail position has no server endpoint and no iPhone analogue — explicitly not ported; note so it isn't logged as a gap.

---

## Appendix A — Completeness critic punch-list (fold into phases before build)

Punch-list, ranked by severity. Cross-checked all 14 inventory tabs against the spec's phases, file layout (§4.9), and master method list.

## HIGH — whole web screens with zero iOS coverage, not flagged as deferred or non-goal

1. **RELEASES tab (Inventory §13) is entirely absent.** No screen, no `admin/ReleasesView.swift` in the §4.9 layout, no `releases()` / `refreshReleases()` methods (`GET /api/releases`, `POST /api/releases/refresh`), and it is not listed as a non-goal or deferred gap. It is one of the 11 admin tabs — the release-notes cards (repo, last synced, cached count, markdown bodies, assets) are distinct from the app-version row in `SettingsView` and from the `refresh_github_releases` Jobs action. **Fix:** add a `ReleasesView` under System, or explicitly list Releases as intentional non-parity in §8.

2. **MEDIA → History sub-tab (Inventory §11d) is absent.** `GET /api/library/download-history` (+ `/download-history/stats`) read-only history with status/days filters and pagination — no screen, no method, not flagged. Distinct from the dashboard `ActivityView` and from the download-client live-speed header. **Fix:** add a `LibraryHistoryView` (Phase 3 or 5) or flag as non-parity.

3. **JOBS → Library Health card (Inventory §10) is absent.** `GET /api/admin/library-health` / `LibraryHealthCard` is not in the Phase-5 `JobsView` description nor the master method list (`scheduledJobs`, `triggerAction`, `queueJobs`, `retry*`, `cleanQueue`, `jobHistory` only). **Fix:** add `libraryHealth()` + a card, or note as omitted.

4. **NOTIFICATIONS → Test Notification admin button (Inventory §3b) is absent.** `POST /api/notifications/test` (admin-only) has no method and no UI. `NotificationsSettingsView` is described as prefs-only. **Fix:** add `sendTestNotification()` behind an admin guard in the notifications screen.

## MEDIUM — contradictions and unresolved wiring

5. **`deleteExpectOK` is double-defined.** Listed as a Phase-1 generic helper (§4.2, §5 Phase 1, master list) *and* introduced as a "New private helper `deleteExpectOK`" in the Phase-4 intro. Pick one (Phase 1) and drop the Phase-4 claim.

6. **Spurious cross-phase dependency.** §7/cross-phase text: "Notification-channel and quality-profile custom-format assignment both need `customFormats()`." Notification channels do not consume custom formats — only the quality-profile assignment editor does. Remove the notification-channel half (or say what was actually meant, e.g. the shared `JSONValue` enum).

7. **Shared post-processing endpoint has three method names.** `mediaLibrarySettings`/`updateMediaLibrarySettings` (Phase 3 prose) vs `mediaPostProcessingSettings` (master list "Books non-CRUD" + cross-phase paragraph) for the same `GET/PATCH /api/library/post-processing/settings`. Collapse to one canonical name so the "one shared endpoint, two domain subsets" rule is unambiguous.

8. **Browser push subscription (Inventory §3c) has no mapped iOS analogue.** Subscribe/Unsubscribe + VAPID (`/api/notifications/subscribe|unsubscribe|vapid-public-key`) is the web's push-enable control; on iOS this is APNS registration (the auto-registering "This device" row) plus OS permission. Reasonable non-parity, but it is silently dropped — add a one-line note in §8 so it isn't logged as a gap.

## LOW / nits

9. **Two similarly-named web-push methods invite confusion:** `webPushDevices()` (Phase 1, `/api/notifications/devices`, per-user) vs `webPushSubscriptions()` (Phase 5, `/api/admin/web-push`, admin). Both correct, different endpoints — just call out the distinction where they're defined.

10. **§2 undercounts the web surface** ("~25 distinct screens across seven tab groups") against the inventory's 14 tabs / ~40 sub-screens. The undercount lines up exactly with the dropped screens in #1–#4 — worth reconciling so the parity claim is auditable.

## Correctly handled (no action)

Native-feasibility gaps are all addressed: WebAuthn passkey registration deferred (list+delete shipped), multipart avatar deferred (read-only shipped), SSE handled three ways (migrate via `URLSession.bytes`, reindex/Jobs via polling), nav-rail position flagged as no-analogue. Secret-omission convention, admin gating + self-guard, the shared `qualityProfiles()`/`bookQualityProfiles()` reuse so Phase 3 doesn't block on Phase 4, and the `PATCH`-vs-`PUT` verb notes (book quality profiles, notification channels) are all correct and internally consistent.

---

## Appendix B — Resolutions to the critic punch-list (authoritative; these patch §5–§8)

Because the target is **full parity**, the four HIGH gaps are BUILT, not waived. These resolutions override anything in §5–§8 they touch.

**HIGH — added screens (all read-only or trivial; small additions):**

1. **Releases → `admin/ReleasesView.swift` (Phase 5, System).** Read-only cards + refresh. Methods `releases()` (`GET /api/releases`), `refreshReleases()` (`POST /api/releases/refresh`). Rows: repo, last synced, cached count, per-release name/tag/date/author, markdown body (render as plain/attributed text — no HTML), assets as copyable download links. Distinct from the `SettingsView` app-version row and the `refresh_github_releases` Jobs action.

2. **Media → History → `media/LibraryHistoryView.swift` (Phase 5).** Read-only. Methods `downloadHistory(status:days:limit:offset:)` (`GET /api/library/download-history`), `downloadHistoryStats()` (`GET /api/library/download-history/stats`). Status filter (all/completed/failed/active) + days `PickerRow` + Load-more paging + a stats header. Reuse `StatusBadge`.

3. **Jobs → Library Health card (Phase 5, inside `JobsView`).** Method `libraryHealth()` (`GET /api/admin/library-health`); render a read-only summary card above the queue overview.

4. **Notifications → Test button (Phase 4/Account, inside the notifications screen).** Method `sendTestNotification()` (`POST /api/notifications/test`), shown **only when `model.isAdmin`**. Spinner + success/failure toast.

**MEDIUM — contradictions resolved:**

5. **`deleteExpectOK` is a Phase-1 generic helper only.** Drop the "new private helper" claim in the Phase-4 intro.
6. **Custom formats feed only the quality-profile assignment editor.** Notification channels do NOT consume `customFormats()` — remove that half of the cross-phase note. Channels share only the `JSONValue` enum.
7. **Canonical name for the shared post-processing endpoint:** `postProcessingSettings()` / `updatePostProcessingSettings(...)` for `GET/PATCH /api/library/post-processing/settings`. Media (Phase 3) and Books-files (Phase 3 B5) each send only their own key subset through it; the earlier `mediaLibrarySettings*` / `mediaPostProcessingSettings*` aliases are dropped.

**LOW — noted:**

8. **Web push subscribe/unsubscribe + VAPID is intentional non-parity** — on iOS the equivalent is APNS auto-registration (the "This device" row) + OS permission; there is no Subscribe button to port.
9. **`webPushDevices()` (per-user, `/api/notifications/devices`) ≠ `webPushSubscriptions()` (admin, `/api/admin/web-push`)** — different endpoints, both kept; naming is deliberate.
10. **§2's "~25 screens" is corrected to the inventory's 14 tabs / ~40 sub-screens** — the undercount was exactly the four screens added in #1–#4; parity is now complete and auditable against `SETTINGS_INVENTORY.md`.

With Appendix B applied, **every** web settings screen and CRUD list in `SETTINGS_INVENTORY.md` has an iOS home across Phases 1–5, except the two documented native-feasibility deferrals (WebAuthn passkey *registration*, avatar *upload*) and the intentional non-parity items above.

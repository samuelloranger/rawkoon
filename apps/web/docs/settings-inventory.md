# rawkoon Web App — Settings Surface Inventory

Entry: `apps/web/src/pages/settings/_component/Settings.tsx`. Tab state via URL search param `?tab=` (and `?subtab=` for media). Account tabs (all users): profile, activity, notifications. Admin-only tabs (gated on `currentUser.is_admin`): general, integrations, sso, users, sessions, api-keys, jobs, media, books, releases, blocklist.

All endpoints resolved from `apps/web/src/lib/endpoints/*.ts`. Fetcher = `useFetcher()` (`@/lib/api/context`).

---

## 1. PROFILE tab (`ProfileTab.tsx`) — all users

### 1a. Personal Information (`ProfileForm.tsx`)
| Field | Control | Editable | Endpoint |
|---|---|---|---|
| Profile picture | file upload + crop dialog (`ReactCrop`, aspect 1:1, max 5MB, downscale 1024px, jpeg 0.92) | yes | `POST /api/users/me/avatar` (multipart `avatar`) |
| Email | text (email) | readonly (disabled) | from `useCurrentUser` |
| First name | text | yes | `PUT /api/users/me` (`{first_name,last_name}`) |
| Last name | text | yes | `PUT /api/users/me` |
| Save changes | button-action | — | as above |

### 1b. Change Password (same form component)
| Field | Control | Editable | Endpoint |
|---|---|---|---|
| Current password | password (required) | yes | `POST /api/users/me/password` (`{current_password,new_password}`) |
| New password | password (required, min 8) | yes | same |
| Confirm new password | password (must match) | yes | same |
| Update password | button-action | — | same |

### 1c. Navigation (inline in ProfileTab, `NavPositionPicker` + `useNavPosition`)
| Field | Control | Editable | Endpoint |
|---|---|---|---|
| Nav rail position (desktop) | picker/select | yes (local persisted; `useNavPosition`) | client preference (no `/api` settings write) |

### 1d. Passkeys (`PasskeysSection.tsx`) — WebAuthn; hidden if unsupported. **CRUD list.**
| Field | Control | Editable | Endpoint |
|---|---|---|---|
| Passkey name (register) | text | yes | register via `usePasskeyRegister` (better-auth passkey) |
| Add passkey | button-action | — | WebAuthn register |
| Passkey rows (name, device type multi/single, backed up, added date) | readonly-display | — | `GET /api/auth/passkey/list-user-passkeys` |
| Delete passkey (inline confirm) | button-action | delete | `POST /api/auth/passkey/delete-passkey` |

---

## 2. ACTIVITY tab (`RecentActivityTab.tsx`) — all users (read-only feed)
| Field | Control | Editable | Endpoint |
|---|---|---|---|
| Service filter | select | filter | `GET /api/dashboard/activities/feed?limit&service&type` |
| Type filter | select | filter | same |
| Clear filters | button-action | — | — |
| Activity rows (icon, description, service label, type label, time) | readonly-display | — | same feed |
| Load more (pagination, +25) | button-action | — | same (limit grows) |

---

## 3. NOTIFICATIONS tab (`NotificationsTab.tsx`) — all users
Shows "not supported" banner if push unsupported.

### 3a. Notification Preferences (`NotificationPreferencesSection.tsx`)
Per-key toggles from `NOTIFICATION_PREFERENCE_KEYS`.
| Field | Control | Editable | Endpoint |
|---|---|---|---|
| Each preference key | toggle (checkbox) | yes | `PUT /api/users/me/notification-preferences` (`{notification_preferences}`) |

### 3b. Test Notification (admin only)
| Field | Control | Editable | Endpoint |
|---|---|---|---|
| Send test notification | button-action | — | `POST /api/notifications/test` |

### 3c. Permission / Subscription (browser push)
| Field | Control | Editable | Endpoint |
|---|---|---|---|
| Permission status | readonly + "Request permission" button | — | browser Notification API |
| Subscription status | Subscribe / Unsubscribe buttons | — | `POST /api/notifications/subscribe`, `POST /api/notifications/unsubscribe`; VAPID `GET /api/notifications/vapid-public-key` |

### 3d. Devices list (push devices). **CRUD-ish (list + delete).**
| Field | Control | Editable | Endpoint |
|---|---|---|---|
| Device rows (name, browser, OS, added date, "this device" badge) | readonly-display | — | `GET /api/notifications/devices` |
| Delete device (confirm) | button-action | delete | `DELETE /api/notifications/devices/:id` |

### 3e. Notification Channels (`NotificationChannelsSection.tsx`) — **full CRUD list**
List: `GET /api/notifications/channels`. Row: enable Switch, Edit, Test, Delete.
| Action | Control | Endpoint |
|---|---|---|
| Toggle enabled | toggle | `PATCH /api/notifications/channels/:id` (`{enabled}`) |
| Test channel | button-action | `POST /api/notifications/channels/:id/test` |
| Delete channel | button-action | `DELETE /api/notifications/channels/:id` |
| Add channel | opens `AddNotificationChannelModal` | `POST /api/notifications/channels` |
| Edit channel | opens `EditNotificationChannelModal` | `PATCH /api/notifications/channels/:id` |

**Channel create/edit form fields** (`NotificationChannelConfigFields.tsx`): common `label` (text) + `type` select (ntfy, telegram, discord, gotify, pushover, slack, webhook), plus per-type config:
- ntfy: Server URL, Topic, Access token (optional)
- telegram: Bot Token, Chat ID
- discord: Webhook URL
- gotify: Server URL, App Token
- pushover: API Token, User Key
- slack: Webhook URL
- webhook: URL (supports `{{title}}/{{body}}/{{url}}`), Method (POST/GET select), Body template (textarea, JSON, POST only)

---

## 4. GENERAL tab (`GeneralSettingsTab.tsx`) — admin. `GET/PATCH /api/settings`
### Region
| Field | Control | Editable | Endpoint |
|---|---|---|---|
| Country code | select (country list) | yes | `PATCH /api/settings` (`country_code`) |
### Upcoming Releases
| Field | Control | Editable | Endpoint |
|---|---|---|---|
| Look-ahead window | select (3/6/12/24 months) | yes | `PATCH /api/settings` (`upcoming_window_months`) |
| Languages to include | multi-checkbox (en, fr, de, es, it, pt, ja, ko; min 1) | yes | `PATCH /api/settings` (`upcoming_languages` CSV) |
| Save | button-action | — | same |

(Note: `books_enabled` also lives on `/api/settings` — toggled from Books tab.)

---

## 5. INTEGRATIONS tab (`IntegrationsTab.tsx`) — admin
Groups: Media (Jellyfin, TMDB), Indexers (Prowlarr, Jackett), Infrastructure (Download client), Other (Local AI). Each uses `IntegrationSectionCard` with an Enable toggle + Save/Cancel (dirty tracking).

### 5a. Jellyfin (`JellyfinIntegrationSection.tsx`) — `GET/PUT /api/integrations/jellyfin`
| Field | Control | Editable |
|---|---|---|
| Enabled | toggle | yes |
| Website URL | text (URL) | yes |
| API key | password | yes |

### 5b. TMDB (`TmdbIntegrationSection.tsx`) — `GET/PUT /api/integrations/tmdb`
| Field | Control | Editable |
|---|---|---|
| Enabled | toggle | yes |
| API key | password | yes |
| Popularity threshold | number (0–100) | yes |

### 5c. Prowlarr & 5d. Jackett (`IndexerManagerIntegrationSection.tsx`)
Prowlarr: `GET/PUT /api/integrations/prowlarr` (+ indexers `GET /api/integrations/prowlarr/indexers`). Jackett: `GET/PUT /api/integrations/jackett` (+ `GET /api/integrations/jackett/indexers`).
| Field | Control | Editable |
|---|---|---|
| Enabled | toggle | yes |
| Website URL | text (URL) | yes |
| API key | password | yes |
| RSS indexers | multiselect (`RssIndexerSelector`, populated from indexers endpoint) | yes |

### 5e. Download Client (`DownloadClientIntegrationSection.tsx`) — `GET/PUT /api/integrations/download-client`
| Field | Control | Editable |
|---|---|---|
| Enabled | toggle | yes |
| Client | select (qBittorrent / Transmission / Deluge) | yes |
| Website URL | text (URL) | yes |
| Username | text (hidden for Deluge) | yes |
| Password | password | yes |
| Label | text (default "rawkoon") | yes |
| Save path | text | yes |
| Test connection | button-action | `POST /api/integrations/download-client/test` |

**Download Client Hook sub-section** (`DownloadClientHookSection`) — `GET/PUT /api/integrations/download-client/hook`
| Field | Control | Editable |
|---|---|---|
| Status banner (active/foreign-program/stale/awaiting-first/not-configured) | readonly-display | — |
| Callback URL | text (URL) | yes |
| Auto-configure | toggle | yes |
| Active-hooked seconds | number (min 1) | yes |
| Save / Cancel | button-action | `PUT .../hook` |
| Rotate secret (confirm) | button-action | `POST /api/integrations/download-client/hook/rotate` |
| Deluge / Transmission script (collapsible, copy) | readonly-display (copy) | — |
| qBittorrent command (foreign-program) | readonly-display (copy) | — |

### 5f. Local AI (`LocalAiIntegrationSection.tsx`) — `GET/PUT /api/integrations/local-ai`
| Field | Control | Editable |
|---|---|---|
| Enabled | toggle | yes |
| Base URL | text (URL) | yes |
| Model | text | yes |
| Test connection | button-action | `GET /api/integrations/local-ai/test` |

---

## 6. SSO tab (`OidcProvidersTab.tsx`) — admin — **full CRUD list**
List `GET /api/integrations/oidc`. Create `POST`, Update `PUT /api/integrations/oidc/:id`, Delete `DELETE /api/integrations/oidc/:id`.
Row: icon, name, slug, enabled badge, Edit, Delete (inline confirm).
**Provider form fields:**
| Field | Control | Editable | Notes |
|---|---|---|---|
| Provider name | text | yes | |
| Slug | text | create-only (readonly on edit) | |
| Redirect URI | text | readonly (copyable) | `{apiBase}/api/auth/oauth2/callback/{slug}` |
| Discovery URL | text (URL) | yes | |
| Icon URL | text (URL) + preview | yes | |
| Client ID | text | yes | |
| Client secret | password | yes (blank keeps existing on edit) | `secretIsSet` from `client_secret_set` |
| Enabled | toggle | yes | |

---

## 7. USERS tab (`UsersTab.tsx`) — admin

### 7a. Users list (`UsersListSection.tsx`) — **CRUD list.** `GET /api/admin/users`
Columns: email, name, role, created, last login, actions.
| Action | Control | Endpoint |
|---|---|---|
| Toggle role admin/user (confirm) | button-action | `PATCH /api/admin/users/:id/role` (`{is_admin}`) |
| Reset password (prompt, min 8) | button-action | `POST /api/admin/users/:id/reset-password` |
| Delete user (confirm) | button-action | `DELETE /api/admin/users/:id` |

### 7b. Pending invite links (`PendingInvitationsSection.tsx`) — `GET /api/admin/invitations`
Columns: email, status badge (pending/accepted/revoked/expired), created, expires, actions.
| Action | Control | Endpoint |
|---|---|---|
| Regenerate link | button-action | `POST /api/admin/invitations/:id/resend` |
| Revoke (confirm) | button-action | `DELETE /api/admin/invitations/:id` |

### 7c. Provisioning (`UserProvisioningSection.tsx`) — toggles between two forms
**Generate invitation link** (`POST /api/admin/invitations`): Email (text), Locale (select en/fr), Give admin (checkbox), Generate button → shows `InviteLinkPanel` (copyable single-use link, 7-day expiry).
**Add user directly** (`POST /api/admin/users`): First name, Last name (optional text), Email, Password (min 8), Locale (select), Admin (checkbox), Add button.

---

## 8. SESSIONS tab (`SessionsTab.tsx`) — admin

### 8a. Active sessions — `GET /api/admin/sessions`
Columns: user (name/email/provider icon/device/IP), created, expires, actions. Uses `GET /api/integrations/oidc` for provider icons.
| Action | Control | Endpoint |
|---|---|---|
| Revoke session (confirm) | button-action | `DELETE /api/admin/sessions/:id` |
| Revoke all user sessions (shown if >1, confirm) | button-action | `DELETE /api/admin/sessions/user/:userId` |

### 8b. Web push subscriptions — `GET /api/admin/web-push`
Columns: user, device, endpoint, created, actions.
| Action | Control | Endpoint |
|---|---|---|
| Delete subscription (confirm) | button-action | `DELETE /api/admin/web-push/:id` |

---

## 9. API KEYS tab (`ApiKeysTab.tsx`) — admin — **CRUD list.** `GET /api/admin/api-keys`
Columns: name, key prefix (`start…`), last used, expires (or "never"), created, actions.
| Action | Control | Endpoint |
|---|---|---|
| Create (modal) | button-action | `POST /api/admin/api-keys` |
| Revoke (confirm) | button-action | `DELETE /api/admin/api-keys/:id` |

**Create API key modal:** Name (text, required), Expiry days (number 1–365, optional). On success shows one-time key (copyable, warning it won't show again).

---

## 10. JOBS tab (`JobsTab.tsx`) — admin — mostly action buttons
- **Library health card** (`LibraryHealthCard`) — readonly — `GET /api/admin/library-health`.
- **Queue overview** (`QueueCard.tsx`) per queue — `GET /api/admin/scheduled-jobs`. Expandable; job list `GET /api/admin/queues/:name/jobs?status&limit`.
  - Retry all failed: `POST /api/admin/queues/:queue/retry-failed`
  - Clean completed/failed (confirm): `DELETE /api/admin/queues/:queue/clean?status&grace`
  - Retry single job: `POST /api/admin/queues/:queue/jobs/:jobId/retry`
  - Status filter tabs: failed/active/waiting/completed
- **Scheduled jobs** list (from `scheduled-jobs`; config in `jobsConfig.ts`). Each has a Run button → `POST /api/admin/trigger-action` (`{action}`). Actions: cleanup_notifications, refresh_upcoming, check_movie_release_reminders, check_library_movie_releases, check_library_episode_releases, sync_library_show_episodes, check_library_download_completion, sync_library_attention_alerts, check_library_integrity, refresh_github_releases.
- **Job history** (readonly) — `GET /api/admin/jobs/history?limit=50`.

---

## 11. MEDIA tab (`MediaSettingsTab.tsx`) — admin — 5 sub-tabs (`SegmentedTabs`, `?subtab=`)

### 11a. Quality Profiles (`QualityProfilesTab.tsx`) — **full CRUD list**
List `GET /api/quality-profiles`. Create `POST`, Update `PUT /api/quality-profiles/:id`, Delete `DELETE /api/quality-profiles/:id` (confirm). Editor in `QualityProfileEditorModal` → `QualityProfileForm.tsx`.
**Form fields:**
| Field | Control | Editable |
|---|---|---|
| Name | text (required) | yes |
| Min resolution | select (480/720/1080/2160) | yes |
| Cutoff resolution | select (none/480/720/1080/2160) | yes |
| Preferred sources | multiselect (REMUX, BluRay, WEB-DL, WEBRip, HDTV) | yes |
| Preferred codecs | multiselect (HEVC, AVC, AV1, VP9) | yes |
| Preferred languages | multiselect (en, fr, VFF, VFQ, VF2, VFI, TRUEFRENCH, de, es, it, ja, pt) | yes |
| Preferred search title language | select (en/fr/de/es/it/ja/ko/pt/zh; default English) | yes |
| Prioritized trackers | list editor (`TrackerPrioritySection`) | yes |
| Prefer tracker over quality | toggle | yes |
| Prefer HDR | checkbox | yes |
| Require HDR | checkbox | yes |
| Max size (GB) | number | yes |
| Min seeders | number | yes |
| Custom formats assignment (with scores) | list editor (`CustomFormatAssignmentEditor`) | yes |

### 11b. Custom Formats (`CustomFormatsTab.tsx`) — **full CRUD list**
List `GET /api/custom-formats`. Create `POST`, Update `PUT /api/custom-formats/:id`, Delete `DELETE /api/custom-formats/:id`. Editor `CustomFormatEditorModal` → `CustomFormatForm.tsx`.
**Form:** Name (text, required) + Conditions builder (`ConditionBuilder.tsx`).
**Condition row fields:** condition type (title_regex, release_group, source, codec, indexer, language, hdr_flag, proper_repack, freeleech, resolution, seeders, size_range), operator (matches/equals/is_true/gte/lte/lt/gt/between per type), value (text / number / range / boolean), negate. Add/remove rows.

### 11c. Library Settings (`MediaPostProcessingTab.tsx` → `MediaPostProcessingSettingsBody.tsx`)
Settings load `GET /api/library/post-processing/settings`; save `PATCH` same. Also uses quality profiles list.
| Field | Control | Editable |
|---|---|---|
| Post-processing enabled | checkbox | yes |
| Movies path | text (mono) | yes |
| Shows path | text (mono) | yes |
| Downloads path | text (mono) | yes |
| File operation | select (hardlink/move) | yes |
| Movie template | textarea (mono) | yes |
| Episode template | textarea (mono) | yes |
| Min seed ratio | number | yes |
| Active indexer manager | select (prowlarr/jackett — only enabled ones; hint if none) | yes |
| Default movie quality profile | select (from profiles + none) | yes |
| Default show quality profile | select (from profiles + none) | yes |
| Save | button-action | `PATCH .../post-processing/settings` |

**Library scan card** (same file): Scan path (text), Scan type (select movie/show), Run scan → `POST /api/library/scan` (`{path,type}`); shows matched count + unmatched list.
**Reindex languages card** (`ReindexLanguagesSection`): Start button → `POST /api/library/reindex-languages`; status via `GET /api/library/reindex-languages/status`.

### 11d. History (`pages/medias/_component/LibraryHistoryTab.tsx`) — read-only
Filters: Status (all/completed/failed/active) select, Days (30 etc.) select, pagination. Data `GET /api/library/download-history` (+ `download-history/stats`). Stats section + history rows.

### 11e. Import (`ArrLibraryImportPanel.tsx`) — Radarr/Sonarr migration
| Field | Control | Editable |
|---|---|---|
| Source | segmented (both/radarr/sonarr) | yes |
| Radarr URL | text (shown if needed) | yes |
| Radarr API key | password | yes |
| Sonarr URL | text | yes |
| Sonarr API key | password | yes |
| Start import | button-action | `POST /api/library/migrate` |
| Progress / result / retry | readonly + retry button | status via `GET /api/library/migrate/status` (EventSource) |

---

## 12. BOOKS tab (`BooksSettingsTab.tsx`) — admin

### 12a. General
| Field | Control | Editable | Endpoint |
|---|---|---|---|
| Books enabled | toggle (disabled unless has key or already enabled; warns needs key/paths) | yes | `PATCH /api/settings` (`books_enabled`) |

### 12b. Provider — Google Books (`GET/PUT /api/integrations/googlebooks`, test `POST /api/integrations/googlebooks/test`)
| Field | Control | Editable |
|---|---|---|
| API key | password (placeholder shows "stored" if `has_api_key`) | yes |
| Save | button-action | `PUT` |
| Test | button-action | `POST .../test` |

### 12c. Audnexus (`AudnexusIntegrationSection.tsx`) — `GET/PUT /api/integrations/audnexus`, test `POST .../audnexus/test`
| Field | Control | Editable |
|---|---|---|
| Enabled | toggle | yes |
| Region | select (us/ca/uk/fr/de/es/it/au/br/in/jp) | yes |
| Server URL | text (URL) | yes |
| Save / Test connection | button-action | `PUT` / `POST .../test` |

### 12d. Metadata sources (`BookMetadataSourcesSection.tsx`) — `GET/PUT /api/books/metadata-sources`
Ordered/enabled list of sources: local, audnexus, googlebooks, openlibrary. Reorder (up/down buttons), enable/disable (Switch removes from order). Save source order → `PUT` (`{order}`).

### 12e. Files (writes via `PATCH /api/library/post-processing/settings`)
| Field | Control | Editable |
|---|---|---|
| Books path | text | yes |
| Audiobooks path | text | yes |
| Book template | text (mono) | yes |
| Audiobook template | text (mono) | yes |
| Default book quality profile | select (profiles + none) | yes |
| Save | button-action | `PATCH .../post-processing/settings` |

### 12f. Book Quality Profiles (`BookQualityProfilesSection.tsx`) — **full CRUD list**
List `GET /api/book-quality-profiles`. Create `POST`, Update `PATCH /api/book-quality-profiles/:id`, Delete `DELETE /api/book-quality-profiles/:id`. Editor dialog → `BookQualityProfileForm.tsx`.
**Form fields:**
| Field | Control | Editable |
|---|---|---|
| Name | text | yes |
| Kind | select (ebook/audiobook/both) | yes |
| Allowed formats | ordered picker (add/remove/reorder; formats depend on kind) | yes |
| Cutoff format | select (none + allowed formats) | yes |
| Prefer retail | toggle | yes |
| Min seeders | number | yes |
| Max size (MB) | number | yes |
| Min audio bitrate | number (hidden for ebook) | yes |
| Preferred languages | multiselect | yes |
| Prioritized trackers + prefer-over-quality | list editor + toggle | yes |

---

## 13. RELEASES tab (`ReleasesTab.tsx`) — admin — read-only + refresh
`GET /api/releases`; Refresh `POST /api/releases/refresh`. Shows repo, last synced, cached count, error banner, and release cards (name, tag, date, author, markdown body, assets). No editable fields.

---

## 14. BLOCKLIST tab (`BlocklistTab.tsx`) — admin — list + delete
`GET /api/medias/blocklist`. Columns: release title, indexer, reason, blocked at, actions.
| Action | Control | Endpoint |
|---|---|---|
| Unblock (confirm) | button-action | `DELETE /api/medias/blocklist/:id` |

---

## Summary / counts
- Top-level tabs: **14** (3 account + 11 admin)
- Sub-screens/sections/panels/dialogs: **~40**
- Individual fields/controls: **~150+**
- **Full CRUD lists:** OIDC providers, Users, API keys, Notification channels, Quality profiles, Custom formats, Book quality profiles. List+delete-only: Passkeys, Push devices, Web-push subscriptions, Invitations, Blocklist, RSS indexer multiselect.

## Easily-overlooked screens
- Passkeys / WebAuthn (Profile)
- Nav rail position (Profile, client-only)
- Download Client Hook config sub-panel (callback URL, auto-configure, secret rotation, scripts)
- RSS indexer multiselect inside Prowlarr/Jackett
- Audnexus + Book metadata source ordering (Books)
- Library scan + Reindex languages cards (Media → Library Settings)
- Arr (Radarr/Sonarr) migration/import (Media → Import, EventSource)
- Web-push subscriptions admin table (Sessions)
- Queue management retry/clean (Jobs)
- Notification preferences per-key + push devices (Notifications)
- `books_enabled` flag shared on `/api/settings`

---

## iOS parity status (current)

Shipped in #67 (v1.13.0). iOS Settings is no longer a readonly peek at a few
admin lists. `SettingsView` is the root: account (server URL, profile),
requests/alerts (notifications, devices, channels), playback (smart rewind),
and downloads (Wi-Fi vs any). Admins also get ~22 native destinations in
`SettingsDestination` — General, TMDB, Jellyfin, Local AI, Prowlarr, Jackett,
Indexers, Download client, Book providers, Library, Arr import, Quality
profiles, Custom formats, Books, Book quality profiles, Users, Sessions, API
keys, SSO providers, Blocklist, Jobs, Releases — grouped as System /
Integrations / Library & Quality / Users & Security / Jobs & Releases. Those
views write through the same settings APIs as the web app; they are not
display-only.

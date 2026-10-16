# Integrations

Configure external services in **Settings → Integrations**. Integration
credentials are encrypted at rest; use the connection test before enabling a
service.

## Media and downloads

| Service | Purpose |
| --- | --- |
| TMDB | Discovery, search, and media metadata. A TMDB API key is required for discovery. |
| Google Books | Book and audiobook metadata. Required for the book library; see [Books and audiobooks](/library/books). |
| qBittorrent, Transmission, Deluge, or rdt-client | The active download client. Rawkoon polls it for progress and completion. |
| Prowlarr or Jackett | Indexer search. Choose one active indexer manager for the library grab pipeline. |
| Jellyfin or Plex | Latest additions, watch activity, and supported notifications. Jellyfin also signs in the [TV app](/tv-app); see [Jellyfin](#jellyfin). |
| AI provider (optional) | Any OpenAI-compatible model, local or hosted, that chooses between releases a profile accepts. Configured in **Settings → AI**; see [AI release picks](/library/ai-release-picks). |

The Google Books key is set in **Settings → Books** rather than on this page,
next to the library paths and the feature switch it depends on. It is encrypted
the same way the other integrations are.

Choose one active download client. Rawkoon labels its torrents, polls the
client automatically, and detects stalled or expired downloads without
requiring webhook setup.

### rdt-client (debrid)

[rdt-client](https://github.com/rogerfar/rdt-client) sends torrents to a
debrid service (Real-Debrid, AllDebrid, Premiumize, TorBox), then downloads the
finished files to local disk. It speaks the qBittorrent Web API, so Rawkoon
talks to it through the qBittorrent adapter.

1. In **Settings → Integrations**, pick **rdt-client** as the download client.
   Use rdt-client's own address (its web UI listens on port 6500 by default)
   and the username and password you log into rdt-client with.
2. Mount rdt-client's download folder at the **same path** in both containers.
   Rawkoon imports from the path rdt-client reports and has no remote path
   mapping.
3. Use a downloader that writes real files to that folder. Symlink mode, which
   points at an rclone mount, is not supported.
4. In rdt-client's settings, keep **Post Download Action** on removing the
   torrent from the debrid provider and the client, and set **Finished Action
   Delay** to a day or so (1440 minutes).

Step 4 matters in both directions. With the default delay of 0, rdt-client
removes a torrent as soon as its local copy finishes, which can be before
Rawkoon has seen it complete; the download then stays pending in Rawkoon and
is never imported. With the action set to **None**, rdt-client ignores
Rawkoon's removal request, so torrents and their files pile up.

A debrid client never seeds, so seed ratio targets and the seed sweep don't
apply to it. Once an import has placed every file (movies, episodes, season
packs, books and audiobooks), Rawkoon asks rdt-client to remove the torrent
along with its local copy; the library keeps its own hardlink or moved file.
When an import leaves something behind, such as a season pack with failed
episodes or a book with skipped files, the torrent and its local copy are kept
for a manual fix. Data that another torrent shares is never deleted.

Rawkoon only treats a download as complete once rdt-client reports it
finished, not when the debrid service reaches 100%, because the local copy can
still be in progress at that point. The qBittorrent completion hook is not
available, since rdt-client can't run an external program.

### Jellyfin

Set the **Jellyfin Website URL** and a **Jellyfin API Key** (Jellyfin
Dashboard → API Keys). Rawkoon authenticates with the
`Authorization: MediaBrowser Token="…"` header, which every supported Jellyfin
version accepts; newer servers reject the older `X-Emby-Token` header.

The Website URL is also the address Rawkoon gives the [TV app](/tv-app), so it
must be reachable from your TVs, not only from the Rawkoon container.

**Linking users.** In **Settings → Users**, the Jellyfin column links each
Rawkoon account to one Jellyfin user. A link is what lets a Jellyfin client act
as that Rawkoon user:

- the TV app signs in to Rawkoon, then asks Rawkoon to approve a Jellyfin
  **Quick Connect** code for the linked Jellyfin user, so nobody types a
  Jellyfin password on the TV. Quick Connect must be on in Jellyfin
  (Dashboard → General → Quick Connect);
- a Jellyfin client can trade its Jellyfin token for a Rawkoon session through
  `POST /api/jellyfin/session`, which only succeeds for a linked user.

A Jellyfin user can be linked to only one Rawkoon account. Unlinked accounts
keep working everywhere except on the TV.

## Identity and notifications

- **OIDC** providers can be configured in Settings for external sign-in.
- **Device sign-in.** A TV signs in with a short code that you approve at
  `/device` on your instance (OAuth device authorization, RFC 8628). Codes
  expire after 10 minutes. Only the TV app's client id is accepted.
- **Web Push** uses VAPID keys from environment variables or the
  <code>vapid_keys/</code> directory.

## Importing an existing library

Rawkoon does not call Radarr or Sonarr during normal operation. The
**Settings → Library import** flow uses them only for a one-time migration of
metadata, files, and MediaInfo.

If their in-container media paths differ from Rawkoon's, set
<code>MEDIA_PATH_FROM</code> and <code>MEDIA_PATH_TO</code> to map source paths
to the mounted destination.

# Integrations

Configure external services in **Settings → Integrations**. Integration
credentials are encrypted at rest; use the connection test before enabling a
service.

## Media and downloads

| Service | Purpose |
| --- | --- |
| TMDB | Discovery, search, and media metadata. A TMDB API key is required for discovery. |
| Google Books | Book and audiobook metadata. Required for the book library; see [Books and audiobooks](/library/books). |
| qBittorrent, Transmission, or Deluge | The active download client. Rawkoon polls it for progress and completion. |
| Prowlarr or Jackett | Indexer search. Choose one active indexer manager for the library grab pipeline. |
| Jellyfin or Plex | Latest additions, watch activity, and supported notifications. |

The Google Books key is the one credential without a settings screen. Set it
with the <code>configureBooks</code> script, which encrypts it the same way the
other integrations are stored — a key written straight into the database is
treated as unconfigured.

Choose one active download client. Rawkoon labels its torrents, polls the
client automatically, and detects stalled or expired downloads without
requiring webhook setup.

## Identity and notifications

- **OIDC** providers can be configured in Settings for external sign-in.
- **Web Push** uses VAPID keys from environment variables or the
  <code>vapid_keys/</code> directory.

## Importing an existing library

Rawkoon does not call Radarr or Sonarr during normal operation. The
**Settings → Library import** flow uses them only for a one-time migration of
metadata, files, and MediaInfo.

If their in-container media paths differ from Rawkoon's, set
<code>MEDIA_PATH_FROM</code> and <code>MEDIA_PATH_TO</code> to map source paths
to the mounted destination.

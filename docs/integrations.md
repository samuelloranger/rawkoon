# Integrations

Configure external services in **Settings → Integrations**. Integration
credentials are encrypted at rest; use the connection test before enabling a
service.

## Media and downloads

| Service | Purpose |
| --- | --- |
| TMDB | Discovery, search, and media metadata. A TMDB API key is required for discovery. |
| qBittorrent | Rawkoon's download client. The settings page can configure its add and completion hooks. |
| Prowlarr or Jackett | Indexer search. Choose one active indexer manager for the library grab pipeline. |
| Jellyfin or Plex | Latest additions, watch activity, and supported notifications. |

Rawkoon uses qBittorrent's **Run external program** capability to send an
authenticated notification when a torrent is added or completed. Use the
**Configure webhooks** action in Settings instead of manually re-creating that
command.

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

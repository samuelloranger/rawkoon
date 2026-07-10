# Decisions

## ADR-001: A built-in media library instead of Radarr and Sonarr

**Status:** accepted.

Rawkoon implements movie and TV library workflows natively instead of wrapping
Radarr and Sonarr as upstream runtime services.

### Context

Movies and TV share most of the same lifecycle: discovery, quality selection,
indexer search, grab, import, and notification. Keeping separate Radarr and
Sonarr instances would create two configuration surfaces and two sources of
truth, while still forcing Rawkoon to translate its own product features
through third-party APIs.

### Decision

Rawkoon owns one media model and one quality and release pipeline. TMDB
provides discovery, Prowlarr or Jackett provide release results, qBittorrent
handles grabs, and Rawkoon post-processes files into the library.

The existing Radarr and Sonarr integrations remain only for a one-time library
import and for recognizing familiar filename conventions during file scanning.

### Consequences

This gives Rawkoon a unified UI and direct control over release scoring,
upgrades, alerts, and post-processing. It also means Rawkoon owns the
maintenance of its indexer adapters and post-processing behavior, and users
with highly customized *arr configurations may need to recreate some quality
rules.

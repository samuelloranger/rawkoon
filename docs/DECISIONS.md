# Decision Records

Architecture Decision Records (ADRs) for Rawkoon. Each ADR captures context, decision, and consequences.

Last verified: 2026-05-25

---

## ADR-001: Replace Radarr/Sonarr with a built-in media library

**Status**: Accepted (this is the current architecture; the project ships without an \*arr runtime dependency).

### Context

Most self-hosted homelab stacks compose Radarr (movies), Sonarr (TV), Prowlarr (indexers), and a torrent client. Rawkoon originally considered wrapping Radarr/Sonarr as upstream APIs. Two problems killed that approach:

1. **Two services, two configs, two databases of truth.** Movies and TV use almost identical workflows (discovery → quality profile → indexer search → grab → import → notify), but Radarr and Sonarr are separate forks with diverging features, request formats, and quirks. Wrapping both would multiply the surface area for every feature.
2. **Customization friction.** The end-user value Rawkoon wants to provide — unified release calendar, attention alerts, custom post-processing templates — would have meant translating every concept back and forth through the \*arr REST API, which doesn't expose enough internals (e.g. release scoring) to do well.

### Decision

Rawkoon implements its own movie + TV library natively, using a single Prisma data model (`LibraryMedia` + `LibraryEpisode`) and a single quality/release pipeline. TMDB drives discovery; Prowlarr or Jackett supply indexer search results; qBittorrent runs grabs; an internal post-processor moves files into a templated library tree.

For users migrating from existing \*arr stacks, **Settings → Library import** runs a one-time importer (`apps/api/src/services/jobs/libraryMigrate{Radarr,Sonarr}.ts`, queue `library-migrate`) that pulls metadata, files, and MediaInfo into the Rawkoon library.

### Scope

Code that still references Radarr/Sonarr does so for one of two reasons:

- **Migration** — `apps/api/src/services/jobs/libraryMigrate*.ts`, the `POST /api/library/migrate` route, the `library-migrate` BullMQ queue, and `MEDIA_PATH_FROM` / `MEDIA_PATH_TO` env vars for path remapping during import.
- **Filename conventions** — `apps/api/src/utils/medias/filenameParser.ts` and `releaseTitleParser.ts` know how to parse Radarr/Sonarr-named files when scanning a downloads directory.

There is **no runtime API call to Radarr or Sonarr** anywhere in the day-to-day pipeline. Webhooks like `crossSeed`, `prowlarr`, `jellyfin`, etc. remain because those tools sit alongside Rawkoon rather than substitute for the \*arr services.

### Consequences

**Pros**
- Single source of truth for movies + TV → no sync drift.
- Native control of release scoring (`apps/api/src/utils/medias/releaseScorer.ts`), upgrade detection (`apps/api/src/services/upgradeDetection.ts`), and attention alerts (`apps/api/src/services/libraryAttention*.ts`).
- One UI, one notification stream.

**Cons / what we give up**
- We carry the maintenance cost of indexer adapters (Prowlarr + Jackett) and post-processing (template renderer, file ops, MediaInfo scan) that Radarr/Sonarr would otherwise handle.
- Users with deep Radarr/Sonarr custom-format setups must reconfigure quality profiles in Rawkoon (the importer brings over basic profile structure but not custom-format rules).

### Pointers

- Data model: [DATA_MODEL.md#media-library](./DATA_MODEL.md#media-library-the-arr-replacement)
- Per-feature deep dive: [modules/medias.md](./modules/medias.md) (library)
- AGENTS.md "Media library" section also documents this stance.

# Downloads and files

Rawkoon coordinates a download; qBittorrent, Transmission, or Deluge transfers it. When
post-processing is enabled, Rawkoon turns the completed download into a
tracked library file.

## Before grabbing a release

Confirm these settings first:

1. A download client is connected and passes its connection test.
2. Prowlarr or Jackett is selected as the active indexer manager.
3. Movie and show library paths are configured.
4. Post-processing is enabled.
5. Rawkoon and the download client can see the same completed files through
   compatible container mounts.

For hardlinks, the download path and destination library path must be on the
same filesystem.

## Add and download media

Add a movie or show from **Explore**, or import an existing library. Open its
Library item to choose a quality profile, search indexers, inspect candidates,
and grab a release.

Rawkoon records the grab and sends the release to the active client with a
tracking label. Configure its save path to match your mount layout.

For TV, you can search individual episodes or a season pack. For an existing
file that you want to replace, use the upgrade flow so Rawkoon does not treat
the old file as the completed download.

## What happens at completion

Rawkoon polls the active client for progress and completion, with faster checks
while downloads are moving and slower checks while idle.

Rawkoon then:

1. Locates the completed video file.
2. Renders the movie or episode naming template.
3. Hardlinks or moves the file into the configured library path.
4. Scans the destination with MediaInfo.
5. Records the final path and file metadata.
6. Updates the Library and triggers a Jellyfin refresh when configured.

Hardlink keeps the downloaded file available for seeding. Move relocates it,
which can stop seeding if the download client no longer finds its content.

## Adopt, rescan, and repair

Use **Downloads import** when completed downloads already exist and need to be
adopted. Use **Rescan** on a Library item after a manual file change or mount
repair. Both actions help Rawkoon reconcile its database with files on disk.

The Library history records the release, indexer, completion state, and final
destination. If post-processing fails, the history keeps the error and the
Library attention list identifies the item for follow-up.

Common fixes are:

- correct an unmapped container path;
- enable post-processing or set the correct movie/show destination;
- confirm the download client can expose the completed content path; or
- retry a manual search after changing the quality profile.

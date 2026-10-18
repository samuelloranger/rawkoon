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

For TV, you can search individual episodes or a season pack. Release names
are read in the common forms: <code>S02E05</code>, <code>2x05</code>,
<code>Season 2</code> or <code>Saison 2</code>, multi-episode releases, and
season packs such as <code>Show.S02.1080p</code>. When a season pack is
imported, its files are matched to episodes the same way. For an existing
file that you want to replace, use the upgrade flow so Rawkoon does not treat
the old file as the completed download.

## Automatic searches

You do not have to grab every release by hand. Every monitored title that is
still wanted is searched automatically, by two jobs that hit the same indexer:

| Job | Schedule | What it does |
| --- | --- | --- |
| Release search | every 6 hours by default; change it under Settings, Media, Library Settings, "Check for new releases"; a shorter interval means more indexer searches, and the minimum is 15 minutes | Searches each wanted movie and episode, and grabs the best match its quality profile allows. A season whose aired episodes are all wanted is searched as one season pack. |
| RSS | every 15 minutes | Matches new releases from the indexer feeds against the same wanted titles. |

Neither job searches a title before it can exist:

- **Movies** wait for their digital release. Rawkoon uses the TMDB digital
  release date for the instance's TMDB region, read as a calendar day in the
  instance's time zone. Once that date looks due, the release search checks it
  again with TMDB before searching, since those dates change; RSS relies on the
  stored date. A movie with no digital date yet is not searched.
- **Episodes** wait for their air date.

When a quality profile has a grab delay, both jobs hold what they find until the
delay ends, then grab the best release seen in that window. By default a release
that already meets the profile's cutoff skips the wait. A manual search grabs at
once.

### When searches give up

Each scheduled release search that finds nothing usable counts one failed
attempt against the movie or episode; RSS misses do not count. The first 12
failed attempts are retried on every scheduled search. After that, the title is
searched again only once about a day has passed since its last failed attempt,
so releases that show up late (dubbed or regional versions) are still caught.
After 40 failed attempts the title is set to **Skipped**, it stops being
searched, and administrators are notified. At the default 6-hour cadence that is
about a month of searching. From the twelfth attempt, the title also appears in
the Library attention list.

Two outcomes do not count as a failed attempt: a release held back by the
profile's grab delay, and a grab refused because the library disk is low on
free space.

A manual search, or setting the title back to wanted, resets the counter.

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

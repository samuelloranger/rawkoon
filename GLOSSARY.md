# Rawkoon

A self-hosted library for movies, TV shows, ebooks and audiobooks. It discovers titles, searches indexers for releases, hands downloads to a download client, places the finished files in the library, and tells the people who asked for them.

## Catalog and library

**Title**:
Anything that can be discovered, requested and added to the library: a movie, a show or a book. Identified by its catalog entry, not by a file.
_Avoid_: Media, content

**Library item**:
A title that has been added to the library, together with everything Rawkoon tracks about it (status, quality profile, files, history). Shows contain episodes; books contain editions.
_Avoid_: Library media, entry, record

**Episode**:
One episode of a show. It has its own air date, status and files, and is searched and downloaded on its own or as part of a season pack.
_Avoid_: Ep

**Edition**:
The ebook or the audiobook of a book. A book has one or two editions, and each is monitored, searched, graded, downloaded and stored separately. A request for a book does not choose an edition.
_Avoid_: Format (for the ebook/audiobook distinction), version

**Chapter**:
A slice of an audiobook edition on the timeline of the whole book. Downloads for offline listening are per chapter; an edition without chapters cannot be listened to offline.
_Avoid_: Track, part

**Quality profile**:
A named set of rules that says which releases are acceptable for a title and which acceptable release is preferred, including the cutoff at which upgrades stop. Movies and shows share one kind of profile; books have their own.
_Avoid_: Quality preset, tier

**Cutoff**:
The quality at which a quality profile considers a file good enough and stops looking for upgrades.
_Avoid_: Target quality

## Acquisition lifecycle

**Library status**:
Where a library item, episode or edition stands in being acquired: Wanted, Downloading, Downloaded, Upgrading or Skipped. A show that is still airing is shown as Returning, In production or Planned instead of Downloaded, which combines its library status with its airing state.
_Avoid_: State, airing status

**Wanted**:
The title has no file yet and is waiting to be found. A Wanted title that is Monitored is searched automatically once it can exist (a movie after its digital release, an episode after it airs).
_Avoid_: Missing, pending

**Downloading**:
A release has been grabbed and its download has not finished.
_Avoid_: In progress, active

**Downloaded**:
The download finished and its file is placed, or about to be placed, in the library. For a show it describes the show-wide download, not its episodes: a show can read Wanted while every episode is Downloaded.
_Avoid_: Available (that is a request state), complete

**Upgrading**:
A better release has been grabbed while the current file is still in place.
_Avoid_: Replacing

**Skipped**:
Automatic searching has stopped for the title, either because it failed repeatedly or because an administrator chose to stop. A manual search, or setting the title back to Wanted, resets it.
_Avoid_: Ignored, given up, abandoned

**Monitored**:
An on/off choice that lets Rawkoon search for a title automatically. It is independent of Library status: a Skipped title stays Monitored, and an unmonitored title keeps its status.
_Avoid_: Tracked, watched, followed (followed is for authors)

**Airing state**:
Whether a show is still producing episodes: Returning, In production, Planned, or ended (which includes canceled). It comes from the catalog.
_Avoid_: Show status, series status

**Search attempt**:
One automatic search that found nothing usable. Repeated attempts end in Skipped; a delayed grab or a refusal for low disk space does not count.
_Avoid_: Retry, miss

**Upgrade**:
Replacing an existing file with a better release of the same target, as judged by the quality profile. The old file is superseded once the new one is in place.
_Avoid_: Replace, re-download

## Releases and downloads

**Release**:
A specific downloadable version of a title offered by an indexer, such as a particular encode of a movie. Releases are scored or rejected against a quality profile.
_Avoid_: Torrent, candidate

**Season pack**:
A release that contains a whole season of a show. It is searched when every monitored episode of the season has aired and is still Wanted, and its files are matched to episodes when placed.
_Avoid_: Season torrent, batch

**Target**:
The thing a grab is for: a movie, a single episode, a season of a show, or a book edition. Only one active download is allowed per target.
_Avoid_: Subject

**Grab**:
The act of choosing a release and handing it to the download client. A manual grab happens at once; an automatic grab may first be a Delayed grab. The record that results is a Download.
_Avoid_: Fetch, snatch; and "grab" for the record

**Download**:
The tracked life of one grabbed release, from the grab until it ends in completion or failure. Shown in history and in the activity views.
_Avoid_: Grab (for the record), torrent, transfer

**Delayed grab**:
A release found by an automatic search but kept back by the quality profile's grab delay, so better releases for the same target can arrive first. When the delay ends, the best delayed release is grabbed, unless the target has been satisfied meanwhile.
_Avoid_: Hold, pending release, queued release

**Grab delay**:
How long an automatic grab waits after a release is published before it is taken. A release that already meets the cutoff can skip it.
_Avoid_: Wait time

**Blocklist**:
Releases that must never be grabbed again, added by a person or automatically when a download stalls, contains malware, or is rejected on placement.
_Avoid_: Ban list, denylist

**Download outcome**:
How a download ends: it completes, it fails, or it is adopted. An outcome also updates the library status, notifies the requester and schedules post-processing.
_Avoid_: Result

**Adopt**:
Attach a torrent that the download client already has to a download instead of adding it again. Happens when a grab hits a duplicate. An adopted torrent that is already finished produces a completed outcome at once.
_Avoid_: Claim

**Reconcile**:
One pass that compares unfinished downloads with the download client and decides, for each, whether it completed, failed, stalled, or should keep waiting.
_Avoid_: Sync, poll

## Placing files

**Post-process**:
The automatic step that places a completed download in the library: naming the file from the template, moving or hardlinking it, reading its technical details, and superseding the file it upgrades.
_Avoid_: Import (as the automatic step)

**Assign downloads**:
A manual action by an administrator that matches video files already sitting in the downloads folder to titles and places them in the library, as post-process would have.
_Avoid_: Downloads import, import

**Rescan**:
A manual action on one library item that re-reads its files and attaches any untracked files found in its place in the library.
_Avoid_: Import, refresh (refresh means re-reading catalog data)

**Scan library folder**:
A one-off administrator action that walks a folder of existing media, matches names to the catalog, and adds the matches to the library as already Downloaded.
_Avoid_: Library import, import

**Migrate from Radarr/Sonarr**:
A one-time transfer of an existing Radarr or Sonarr library into Rawkoon.
_Avoid_: Import library, sync

**Link Jellyfin users**:
Tying a Rawkoon account to a Jellyfin user, either for an existing account or by creating accounts already linked from a connected server's users (disabled users are skipped).
_Avoid_: Import users

**Seeding**:
Continuing to upload a finished download to other peers from the download client. Rawkoon keeps a hardlinked download seeding until its seed target is met.
_Avoid_: Sharing

**Seed target**:
The ratio or seeding time after which Rawkoon stops seeding a download and removes it from the client. Can differ per indexer.
_Avoid_: Seed goal, seed release, "released" (a release is an indexer result, not the end of seeding)

## Requests

**Request**:
A member's ask for a title to be added to the library, which an administrator approves or denies. There is one request per title: asking for a title again reopens its request instead of creating a second one.
_Avoid_: Wish, order, watchlist entry (a watchlist is a personal bookmark, not a request)

**Pending**:
A request waiting for an administrator.
_Avoid_: Open, submitted

**Approved**:
An administrator accepted the request and the title is in the library. A show's request stays Approved until a show-wide or season-pack download of it finishes while the show is no longer airing; episodes downloaded one at a time never make it Available on their own.
_Avoid_: Accepted, granted

**Denied**:
An administrator declined the request, optionally with a reason. Asking again reopens it as Pending.
_Avoid_: Rejected, declined

**Available**:
The requested title has been delivered: a movie when its download finishes, a show as described under Approved, a book when its first edition is placed.
_Avoid_: Fulfilled, done, downloaded

## Books playback

**Manifest**:
Everything a client needs to play or download an edition: title, authors, total duration and the ordered chapters with links to their content. Playback, offline download planning and resuming all read it.
_Avoid_: Playlist

**Grant**:
A short-lived permission carried by a chapter's content link, so background downloads that cannot send a login can still fetch it. An expired grant means refetch the manifest, not fail the chapter.
_Avoid_: Token, signed URL

## Relationships

- A **Title** becomes a **Library item** when requested and approved, or when an administrator adds it directly.
- A **Library item** has a **Quality profile**; a show has **Episodes**, a book has **Editions**.
- A **Target** is searched when it is **Wanted** and **Monitored**; the search yields **Releases** that the profile accepts or rejects.
- A **Grab** of a **Release** creates one **Download** for a **Target**; a **Delayed grab** postpones it.
- A **Download outcome** moves the **Library status** and may make a movie or show **Request** **Available**; for a book, **Post-process** does.
- A show's **Library status** and **Airing state** vary independently; a show request becomes **Available** only when a show-wide download finishes after the show has stopped airing.

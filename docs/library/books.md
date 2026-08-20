# Books and audiobooks

Rawkoon manages an ebook and audiobook library alongside movies and shows. It
discovers titles through Google Books, searches releases through the same
indexer manager, hands grabs to the same download client, and imports completed
files into their own library tree.

The feature is off by default. Until it is enabled, a movies-and-shows instance
behaves exactly as before: no books navigation, no book searches, and no extra
indexer traffic.

::: warning Configured from the command line
Books have no settings screen yet. Enabling the feature, storing the Google
Books key, and setting the library paths are done with the
<code>configureBooks</code> script described below. Everything after that —
adding books, monitoring, searching, grabbing — happens in the web interface.
:::

## Turn it on

Run the script inside the container. Each flag is optional, so you can set one
thing at a time.

```bash
docker compose exec rawkoon bun apps/api/src/scripts/configureBooks.ts \
  --books-path /mnt/storage/Books \
  --audiobooks-path /mnt/storage/Audiobooks \
  --google-key AIza... \
  --enable
```

```bash
# Print the current state and change nothing
docker compose exec rawkoon bun apps/api/src/scripts/configureBooks.ts --status
```

The Google Books key must be set through the script rather than written into the
database directly: it is encrypted with the instance's `SECRET_KEY`, and a
plaintext value is treated as unconfigured. Get a key from the Google Cloud
console and enable the Books API on the project.

Both library paths must be inside a volume the container can write to, and — as
with movies and shows — inside the same mount your download client sees, or
files are copied instead of hardlinked.

## Editions

A book is one title with up to two **editions**: an ebook and an audiobook.
Each edition is monitored, searched, graded, and stored separately, so you can
want the audiobook of a title whose ebook you already have. A book always has at
least one edition; add the other from the book's page.

Each edition carries its own state, and the book list shows both at once:

| State | Meaning |
| --- | --- |
| Wanted | Monitored and missing. Eligible for automatic search. |
| Downloading | A release was grabbed and is in the download client. |
| Upgrading | A better format was grabbed while the current file is still in place. |
| Downloaded | At least one file is in the library. |
| Skipped | Searching gave up after repeated failures, or you turned monitoring off. |

## Book quality profiles

Book profiles are separate from movie and show profiles, because the qualities
are unrelated: an ebook has a format, not a resolution.

Two profiles are created for you — **Standard Ebook** and **Standard
Audiobook**. A profile is scoped to one edition kind, or to both.

| Control | Effect |
| --- | --- |
| Allowed formats | Rejects any release whose format is not in the list. Order is preference: the first entry is best. |
| Cutoff format | An edition at or above the cutoff is finished, and is never searched for an upgrade again. |
| Prefer retail | Ranks a release marked retail above one that is not. It is a preference, never a requirement — most real releases carry no marker at all. |
| Maximum size | Rejects a release above the configured size. |
| Minimum seeders | Rejects a release below the threshold when the indexer reports a count. |
| Minimum audio bitrate | Audiobooks only. Rejects a release below the bitrate. |
| Preferred languages | Ranks matching releases higher. The book's own language is always added, so a French book prefers French releases without configuration. |
| Prioritized trackers | Orders trackers as a tie-break, or above quality if you choose. |

Format order carries real meaning. In the seeded ebook profile `epub` outranks
`pdf` because a pdf of a book is usually a scan; in the audiobook profile `m4b`
outranks `mp3` because one chaptered file beats a directory of tracks.

::: tip
Profiles have a full API but no admin screen yet. The two seeded profiles cover
most libraries; changing them means using `/api/book-quality-profiles`.
:::

## Searching and grabbing

Open a book, then use **Search indexers** on the edition you want.

Every book search is free text. Torznab exposes no ISBN or book-id parameter,
so Rawkoon searches by title and author surname and then filters what comes
back. That filter is the part worth understanding, because it is what stops the
wrong book from being imported:

- the release title must contain every word of the book's title;
- the author's surname must appear in the release name;
- the release's kind must match the edition — an audiobook cannot satisfy an
  ebook edition, whatever category the tracker filed it under;
- the format must be allowed by the profile.

Rejected releases stay visible with the reason attached. Free-text matching is
the weakest link in the pipeline, and reading the rejections is how a profile
gets tuned.

## Automatic acquisition

Once books are enabled, three scheduled jobs run on their own.

| Job | Schedule | What it does |
| --- | --- | --- |
| Book releases | every 6 hours | Searches monitored wanted editions and grabs the best match. Also searches for upgrades on editions below their cutoff format. |
| RSS | with the media RSS poll | Matches new releases in the book and audio categories against wanted editions. |
| Author releases | daily | Adds new titles from monitored authors. |

There is no publication-date gate. A book has no digital release window worth
waiting on, and Google Books' own dates are unreliable enough that gating on
them would stop real searches from ever running.

A search that keeps failing eventually stops: after enough attempts the edition
is set to **Skipped** and administrators are notified. A manual search clears
that.

An upgrade **replaces** what it supersedes. When a better format is imported,
the previous files for that edition are deleted from disk. This is what keeps a
library from doubling every time a book improves.

## Following an author

Open **Authors** from the books page and turn on monitoring for an author whose
new work you want automatically.

Monitoring records the date you switched it on, and only titles published on or
after that date are added — turning it on never pulls in a backlist. Choose
which editions new titles arrive as; with nothing selected they arrive as
ebooks.

An author is identified by name, because Google Books exposes no author
identifier. Two writers with the same name are one author to Rawkoon.

## Files and import

Completed downloads are imported with the same post-processing setting as media,
using these templates:

```
Books       {author}/{title} ({year})/{title} ({year}) [{format}]
Audiobooks  {author}/{title} ({year})/{title}
```

An ebook grab often ships several formats of the same book. Every format the
profile allows is imported as a file on that one edition; the rest are dropped.

A multi-track audiobook keeps its original filenames inside the rendered
directory. Renaming dozens of tracks risks destroying playback order in
whatever plays them, so the directory is the unit Rawkoon controls and the
tracks are left alone.

Duration and narrators come from the audio container's own tags; Google Books
provides neither.

## Rescan

**Rescan files** on an edition registers files that are already in the library
but have no database rows.

You need it after removing and re-adding a book. Removing a book deliberately
leaves its files on disk, so the re-added book starts empty while the file is
still sitting there. Rescan adopts it, and also drops rows whose file has since
disappeared.

It only ever looks inside the directory the naming template points at, so it
cannot pull in an unrelated book.

## Notifications

Administrators are notified when a book is grabbed, when it finishes importing,
when an import fails, when searching gives up on an edition, and when a
monitored author has new titles.

## Limits worth knowing

- **Google Books is the only metadata source.** It is the single point of
  failure for discovery, its records are often sparse (missing descriptions,
  page counts of zero, no cover art), and it returns transient 5xx errors for
  valid queries. Rawkoon retries and never caches an error as "not found", but
  it cannot invent data the provider does not have.
- **A reported language can be wrong.** Rawkoon cross-checks it against the
  ISBN's registration group and corrects an obvious contradiction.
- **Multi-book and author-collection packs are rejected.** A release containing
  a whole series is never grabbed for a single edition.
- **Requests and the discover deck do not cover books yet.** Books are added
  from the books page, not requested.

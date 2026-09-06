# Books and audiobooks

Rawkoon manages an ebook and audiobook library alongside movies and shows. It
discovers titles through Google Books, searches releases through the same
indexer manager, hands grabs to the same download client, and imports completed
files into their own library tree.

The feature is off by default. Until it is enabled, a movies-and-shows instance
behaves exactly as before: no books navigation, no book searches, and no extra
indexer traffic.

## Turn it on

Everything is in **Settings → Books**, in this order:

1. **Google Books** — paste an API key and save it. Get one from the Google
   Cloud console with the Books API enabled on the project. **Test key** checks
   it against the live API before you rely on it.
2. **Files** — set the books and audiobooks library paths.
3. **Book library** — switch the feature on. The switch stays inert until a key
   is stored, because a Books section whose every search fails on
   authentication is worse than no Books section.

The key is stored encrypted with the instance's `SECRET_KEY` and is never sent
back to the browser: the field shows whether a key exists, and submitting it
empty keeps the current one. A key written straight into the database is treated
as unconfigured, so it cannot be set with SQL.

Both library paths must be inside a volume the container can write to, and — as
with movies and shows — inside the same mount your download client sees, or
files are copied instead of hardlinked.

::: details Configuring without the interface
The same settings can be applied from a shell, which is useful for scripted
setup. Each flag is optional.

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

The script also has `--fix-languages`, which re-derives every stored book's
language from its ISBN and corrects rows where the provider disagreed. There is
no equivalent in the interface.
:::

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

**Settings → Books** lists the profiles with their format order and cutoff, and
sets which one new editions default to. Editing a profile's rules is not in the
interface yet; the `/api/book-quality-profiles` endpoints accept changes.

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

Completed downloads are imported with the same post-processing setting as media.
The naming templates are in **Settings → Books**, and default to:

```
Books       {author}/{title} ({year})/{title} ({year}) [{format}]
Audiobooks  {author}/{title} ({year})/{title}
```

Available tokens are `{author}`, `{title}`, `{year}`, `{format}` and
`{language}`.

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

## Reading and listening

Both the web app and the iOS app play audiobooks and read EPUBs. They share one
position per user through the same APIs, so where you left off on the phone is
where the browser resumes.

On the book page, **Listen** appears when an audiobook has chapter files
registered, and **Read** when an ebook has an EPUB. A mini-player stays at the
bottom of the SPA while audio is loaded. Home shows a Continue card for
in-progress titles.

The web player runs only while the tab is visible. Locking the phone or
switching apps will typically pause audio in Mobile Safari — that is expected.
There is no sleep timer, datasaver, or CarPlay from the browser.

The iOS app still has its own reader and player, including offline downloads.

### What the web app dropped in 1.8.0

The first web reader and player were removed in 1.8.0. Reading progress from
before that cut was not migrated. Browser offline downloads from that era are
gone. The current web Listen/Read path is new and uses the same progress rows
as iOS.

## Progress

Both clients track two positions per user, and both sync through the server so
they follow you across devices:

| | Audiobook | Ebook |
| --- | --- | --- |
| Stored in | `book_listening_progress` | `book_reading_progress` |
| Position is | Seconds on the whole-book timeline | Spine document + a 0–1 offset inside it |
| Read with | `GET /api/books/progress` | `GET /api/books/reading-progress` |
| Written with | `PUT /api/books/editions/:id/progress` | `PUT /api/books/editions/:id/reading-progress` |

Both are keyed on `(user, edition)` and both resolve conflicts the same way:
newest write wins, the client clock is clamped to server time on receipt, and an
older write is rejected rather than allowed to walk a reader backwards from
another device. Each device also keeps its own copy on disk, so a position
survives a crash or an offline session and is pushed on the next sync.

A reading position stores the spine document's **path** as well as its index,
because re-downloading a book can reorder its spine — the index alone would then
open a different chapter. On open the path is what the app trusts: if it moved,
the index follows it; if it is gone entirely, the app lands at the top of the
nearest chapter rather than mid-way through an unrelated one.

The in-app reader unpacks **EPUB only**. Other formats in the library — the
`.mobi` files that ship beside some editions, pdf, azw3 — can be downloaded but
show *EPUB only* where the Read button would be.

## Metadata sources

Google Books alone leaves most of a book blank. Measured against a real
French-language library it supplied no series name for a single title, and no
narrator for any audiobook. So metadata is merged from four sources instead,
and each field is taken from the highest-priority source that has it.

The default order, highest first:

| Source | Supplies | Needs |
|---|---|---|
| Files on disk | Narrator tags, publisher, Calibre series | Nothing — reads your files |
| Audnexus / Audible | Narrators, series and position, genres, publisher, ratings, cover art, description | Nothing; the public instance is keyless |
| Google Books | Identity, description, ISBN | An API key |
| Open Library | Page counts, ratings | Nothing |

Reorder them under **Settings → Books → Metadata sources**. The list doubles as
the on/off switch: a source you turn off is removed from the order. Turning
everything off is not honoured — that would silently stop all enrichment — so
saving an empty list restores the default.

**Files on disk rank highest on purpose.** Fix a file with a tagger, rescan, and
your correction survives every later refresh. If a remote source outranked the
file, the next refresh would quietly undo the fix.

**Anything you edit by hand beats every source.** Overridden fields are never
touched by a refresh and show as set by hand rather than naming a provider.

### Audnexus

Audnexus is the audiobook data API Audiobookshelf uses. It needs no account.
Set the **region** to match where your editions were published — a French
audiobook is only listed in the French catalogue, so the wrong region finds
nothing.

The public instance at `https://api.audnex.us` is rate-limited to 300 requests
a minute, which no library of ordinary size will approach. If you would rather
not depend on it, point **Server URL** at your own instance; the project ships
no prebuilt image, so that means building it from source.

Audnexus is keyed by Audible ASIN and has no title search, so rawkoon resolves
an ASIN from the Audible catalogue first and scores the candidates. A candidate
whose volume number disagrees is rejected outright rather than accepted with a
lower score: attaching tome 1's data to tome 2 is worse than attaching nothing,
because the result looks complete.

### Refreshing

Metadata is merged when a book is added, and otherwise only when you ask.
There is no background sweep. Use **Refresh metadata** on a book's page; it
reports how many fields changed, and names any source that was unavailable, so
an outage is never mistaken for "this book has no narrators".

To re-run the whole library at once:

```bash
# inside apps/api
bun run src/scripts/backfillBookMetadata.ts --dry-run      # list what would run
bun run src/scripts/backfillBookMetadata.ts --book=13       # one book
bun run src/scripts/backfillBookMetadata.ts --only-missing  # books nothing has enriched yet
bun run src/scripts/backfillBookMetadata.ts                # everything
```

Each book is caught independently, so one unreachable provider or one odd file
cannot cost the rest of the library its metadata. Books that gain no fields are
counted and reported — normal for a title no source carries.

Where each field came from is recorded, and hovering it on the book page names
the source.

## Notifications

Administrators are notified when a book is grabbed, when it finishes importing,
when an import fails, when searching gives up on an edition, and when a
monitored author has new titles.

## Limits worth knowing

- **Discovery still goes through Google Books.** Identity and title search
  use that catalogue; enrichment then merges Audnexus, Open Library, and
  on-disk tags (see [Metadata sources](#metadata-sources)). Google's records
  are often sparse, and it returns transient 5xx errors for valid queries.
  Rawkoon retries and never caches an error as "not found", but it cannot
  invent data no provider has.
- **A reported language can be wrong.** Rawkoon cross-checks it against the
  ISBN's registration group and corrects an obvious contradiction.
- **Multi-book and author-collection packs are rejected.** A release containing
  a whole series is never grabbed for a single edition.
- **Requests and the discover deck do not cover books yet.** Books are added
  from the books page, not requested.
- **Bookmarks and notes are not tracked anywhere.** Only a single current
  position per edition is stored.

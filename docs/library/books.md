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

Imported books are read and played in Rawkoon itself, from the book's page:
**Read** for an ebook, **Listen** for an audiobook. Once there is a position
either button reads **Continue**, and the same word appears on the books list.

### The reader

The reader takes the whole window — no sidebar — and its chrome fades once you
start reading, returning on any pointer move or key. The rail down the right
edge is the table of contents: each segment is one chapter, sized to that
chapter's real length, and clicking or dragging it moves you.

| Format | Reader |
|---|---|
| `epub` | Full reader — chapter navigation, typography, page or scroll layout |
| `pdf` | Page-per-view, with selectable text |
| `cbz` | Page-per-view images |
| `mobi`, `azw3` | **Not readable in the browser** — the file offers a download instead |

Text settings (Aa) apply to epub only, since a pdf and a cbz have a fixed
layout: reading face (Literata or Hanken Grotesk), size, line height, margins,
Pages or Scroll, and a Night or Paper theme. They are remembered per browser,
not per book.

Keys: `←` `→` or `PageUp` `PageDown` turn pages, `Esc` closes.

### The player

The player keeps playing while you move around the rest of Rawkoon — it lives
in a bar at the bottom of the window, and opens full-screen when you click it.
A book split across many tracks is presented as one timeline: chapters come
from the audio container's own marks, or one chapter per file when the
container has none.

- Speed from 0.5x to 3x, without the pitch rising
- Skip back 15 seconds, forward 30
- A chapter list, and a volume boost up to +12 dB for quiet narration
- Lock-screen, headset and media-key controls, on platforms that offer them

Keys, in the full-screen player: `Space` plays or pauses, `←` `→` skip,
`[` `]` change speed, `Esc` closes.

### Where you left off

Each person's position is their own, and it follows them between devices. An
ebook and an audiobook of the same title are tracked separately — finishing
chapter four in the ebook does not move the audiobook, because there is no
reliable way to line up an epub's chapters with an audiobook's.

Positions save while you read or listen, and on pause. If two devices disagree,
the most recently set position wins; a device that was offline for a week
cannot rewind a position set since.

### Reading offline

**Make available offline** on a book stores its files in the browser, along with
the details needed to open the book again with no network. An audiobook stores
every track, so playback does not stop at the first boundary.

Downloads are only ever removed when you remove them — an app update never
clears them. Positions recorded offline are queued and sent when the connection
returns.

Offline reading needs a browser that supports service workers and the Cache
API; where it does not, the button is not shown. A book is only reachable
offline in the browser that downloaded it, and only after that browser has
loaded Rawkoon at least once while online.

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
- **`mobi` and `azw3` cannot be read in the browser.** They import and download
  normally, but no reader renders them; quality profiles prefer `epub` for this
  reason.
- **Bookmarks, highlights and notes do not exist yet.** The reader tracks one
  position per book, nothing more.
- **There is no sleep timer, and no search inside a book.**

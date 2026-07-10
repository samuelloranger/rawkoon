# Media metadata

Rawkoon maintains two kinds of metadata. Keeping them separate makes it easier
to understand what needs a catalog refresh and what needs a file rescan.

## Catalog metadata

TMDB provides the identity and presentation data for movies and shows:

- title, sort title, year, overview, poster, and media type;
- release dates and release state;
- show seasons and episode information; and
- discovery and search results.

Rawkoon keeps the TMDB identity on each Library item so future refreshes remain
associated with the same title.

### Correcting a title

Use the Library item’s metadata controls to override its title, sort title,
year, overview, or poster. An override is stored separately from the TMDB
value, so an ordinary metadata refresh does not overwrite your correction.
Clear an override when you want Rawkoon to use the catalog value again.

## File metadata

When Rawkoon places or rescans a file, it uses MediaInfo to inspect the file
itself. The resulting record includes:

- path, filename, size, and duration;
- video codec, profile, resolution, frame rate, bitrate, and HDR format;
- parsed source, release group, and proper/repack state;
- audio format and individual audio tracks; and
- subtitle tracks and computed language tags.

The production image includes MediaInfo. In a local development environment,
install MediaInfo if you expect file scans to populate these details.

## Rescan after changing files

Use the Library item’s **Rescan** action after replacing a file outside
Rawkoon, repairing a mount, or changing audio/subtitle tracks. A rescan reads
MediaInfo again and can discover untracked video files in the configured
library directory.

Use the Library health view when paths have moved or files were removed. It
detects missing records on disk and other conditions that need operator
attention.

## Metadata does not move files

Changing a title, poster, or overview changes the catalog presentation only.
It does not rename, re-encode, move, or delete a video file. File placement is
controlled by the post-processing paths, templates, and operation described in
[Downloads and files](/library/downloads-and-files).

# Getting started

Rawkoon is a self-hosted movie and TV library. It discovers titles through
TMDB, searches releases through an indexer, sends downloads to qBittorrent,
and can place completed files into your library automatically.

This guide covers everyday use of an instance that is already running. If you
still need to install Rawkoon or complete its first administrator setup, see
[Self-host Rawkoon](/self-hosting).

## Sign in

Open your instance in a browser and sign in. Rawkoon listens on port
<code>3000</code> by default; your administrator may serve it behind a
different address. There is no open registration: the first account created on
a new instance becomes the administrator, and every later account is created
for you by an administrator.

## Add your first title

1. Open **Explore**, find a movie or show, and add it to the Library.
2. Assign a quality profile if the default is not appropriate.
3. Open the item and use its search or grab controls to select a release.
4. Watch the item move through downloading, completed, and post-processing
   states. The Library history and attention panel explain failures that need
   action.

Read [Quality profiles](/library/quality-profiles) before making the first
automated selection, and [Downloads and files](/library/downloads-and-files)
for the full lifecycle.

## Learn the library

- [Quality profiles](/library/quality-profiles) decide which releases are
  eligible and which is preferred.
- [Media metadata](/library/metadata) explains how titles, images, and details
  are sourced and refreshed.
- [Downloads and files](/library/downloads-and-files) traces a release from
  grab to a completed file in your library.

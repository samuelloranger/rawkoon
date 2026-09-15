# Getting started

Rawkoon is a self-hosted movie, TV, and book library. It discovers titles
through TMDB and Google Books, searches releases through an indexer, sends
downloads to an active client, and can place completed files into your library
automatically.

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

## Use the iPhone app

Rawkoon has a native iPhone app for managing the queue on the go and listening
to audiobooks offline (chapters download to the device; playback survives a
locked screen). Join the public beta on
[TestFlight](https://testflight.apple.com/join/wm3Psb2n): install Apple's
TestFlight app, open the link on your iPhone, then point the app at your
instance's address and sign in with your Rawkoon account.

The app is a client for your instance — it does not run a server of its own.

## Learn the library

- [Quality profiles](/library/quality-profiles) decide which releases are
  eligible and which is preferred.
- [Media metadata](/library/metadata) explains how titles, images, and details
  are sourced and refreshed.
- [Downloads and files](/library/downloads-and-files) traces a release from
  grab to a completed file in your library.
- [Books and audiobooks](/library/books) covers the separate book library, its
  own quality profiles, and author monitoring. It is off until an administrator
  turns it on.

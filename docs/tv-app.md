# TV app

RawkoonTV is the Android TV and Fire TV app for Rawkoon. Rawkoon finds and
downloads your movies and shows; Jellyfin plays them. RawkoonTV puts both on
the TV: you sign in to Rawkoon once, and it sets up Jellyfin for you.

RawkoonTV is a fork of [Wholphin](https://github.com/damontecres/Wholphin), an
open-source Jellyfin client for Android TV. Library browsing and playback are
Wholphin's; RawkoonTV adds the Rawkoon sign-in, discovery, and requests. Its
source and releases live in
[samuelloranger/rawkoon-tv](https://github.com/samuelloranger/rawkoon-tv).

## Before you start

An administrator needs to set up three things once. See
[Integrations → Jellyfin](/integrations#jellyfin) for the details.

1. Rawkoon v1.43.0 or later, with its Jellyfin integration configured.
2. **Quick Connect** turned on in Jellyfin (Dashboard → General → Quick
   Connect).
3. Your Rawkoon account linked to your Jellyfin user, in **Settings → Users**,
   in the Jellyfin column.

The TV needs Android 6 or later.

## Install

1. Allow the TV to install apps from unknown sources.
2. Download the APK from the
   [latest release](https://github.com/samuelloranger/rawkoon-tv/releases/latest)
   and install it, for example with a browser app such as Downloader, *Send
   files to TV*, or `adb install`.
3. Open RawkoonTV.

Release APKs are signed with this certificate (check with
`apksigner verify --print-certs`):

```
SHA-256 A2:71:9E:DC:5C:9D:1A:75:51:B0:A4:1D:02:7D:40:55:1E:14:DA:F1:2F:35:9F:F5:FA:1A:E3:8A:A9:83:AD:8B
```

## Sign in

1. Enter your Rawkoon address.
2. The TV shows a code and a QR code. On your phone, scan it or open
   `/device` on your Rawkoon instance, sign in if asked, check that the code
   matches, and choose **Approve**.
3. The TV finishes on its own: it reads your account, connects to the Jellyfin
   server Rawkoon names, and signs in to it through Quick Connect.

No Jellyfin password and no second server address. **Sign in with email and
password** on the code screen is the fallback when a phone is not at hand. A
code expires after 10 minutes; the TV offers a new one.

The TV gets a normal Rawkoon session, listed in **Settings → Sessions &
Tokens** and revocable there like any other. **Sign out** in the app's Rawkoon
settings forgets the account on that TV.

## What it adds to Wholphin

- **Discover and request.** Trending, popular, and upcoming titles come from
  Rawkoon. Open one and request it; the title page shows whether it is pending,
  approved, downloading, or ready. Requests follow the same rules as on the web;
  see [Requests](/library/requests).
- **Home rows.** **Coming soon** lists the next episodes and movies due in your
  library, with the episode numbers (`S2 · E3–5` when a day brings several).
  **My requests** lists your requests with their state.
- **Owned titles open in the library.** A title you already have shows **Open**
  and goes straight to its Jellyfin page instead of the request page.
- **Rawkoon look.** The Rawkoon theme and fonts are the default. Wholphin's
  other themes stay available in its display settings.
- **Interface size.** Rawkoon settings → **Interface size** scales the whole
  interface. The default is 90%, which fits more on screen on TVs that report a
  low resolution to apps.
- **Updates.** The app checks the RawkoonTV releases and offers to install new
  versions. The first update asks Android for permission to install apps; after
  that an update is one click and keeps your settings and sign-in. It needs free
  storage on the TV; when there is not enough, the app says how much is missing.

Everything else is Wholphin: a customizable home, ExoPlayer and MPV playback,
subtitles, trickplay previews, live TV, music, and refresh-rate switching. See
[Wholphin's feature list](https://github.com/damontecres/Wholphin#features).

## When sign-in stops

| Message | Cause and fix |
| --- | --- |
| Rawkoon has no Jellyfin integration | Set up Jellyfin in **Settings → Integrations**. |
| This Jellyfin account is not linked to Rawkoon | An administrator links your account in **Settings → Users**. |
| The media server forgot the sign-in code | Quick Connect codes are short-lived, or Quick Connect is off. Turn it on in Jellyfin and try again. |
| Could not reach the media server | The TV cannot reach the Jellyfin address Rawkoon gave it. Jellyfin's **Website URL** in Rawkoon must be reachable from the TV. |
| Your Rawkoon session ended | The session was revoked or expired. Sign in again; the server address is kept. |

Report bugs that also happen in Wholphin to
[Wholphin](https://github.com/damontecres/Wholphin/issues), and RawkoonTV ones
to [rawkoon-tv](https://github.com/samuelloranger/rawkoon-tv/issues).

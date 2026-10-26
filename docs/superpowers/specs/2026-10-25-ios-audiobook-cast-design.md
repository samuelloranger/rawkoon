# Cast audiobooks from the iOS app

## Why

A listener who is cooking, cleaning or putting a child to bed wants the book on the speaker in the room, not on the phone in their pocket. Most of those speakers and smart displays are Google Cast receivers (Nest Hub, Nest Audio, Chromecast, Cast-enabled TVs and soundbars). iOS has no built-in Cast, and AirPlay doesn't reach them.

The moment this serves: mid-chapter, the listener taps the Cast button in the player, picks the kitchen display, and the book carries on there from the same second. Back on the couch, they disconnect and the phone picks up where the display stopped.

## Goals

- A Cast button in the audiobook player that lists nearby Cast devices.
- Casting starts at the current position, at the current speed, with the cover, title, author and chapter shown on the receiver.
- Play, pause, seek, skip ±, chapter jumps and speed in the app control the receiver while casting.
- Listening progress keeps saving while casting, through the same path as local playback, so other devices and the web stay in sync.
- Disconnecting hands playback back to the phone at the receiver's last position, paused.

## Non-goals

- Casting from the web player.
- Casting ebooks, movies or TV.
- A custom receiver app. The Default Media Receiver is enough for v1.
- Mac Catalyst. The Cast SDK is iOS-only, so the Mac build doesn't get the button.
- Casting a book that is only on the phone. The receiver fetches the audio itself, so it always streams from the server.

## Anti-goals

- **A second source of truth for position.** The receiver reports position and the app records it. The receiver never writes progress to the server on its own.
- **Long-lived grants for the receiver.** It gets the same signed grant URLs the phone streams with today, refreshed the same way.
- **Silently dropping progress.** If the phone loses the session while the receiver keeps playing, the position is reconciled when the session resumes, never reset to the phone's stale value.

## Decisions

- **Client-side, with Google's SDK.** It is the maintained implementation of the protocol, it handles discovery and session resume, and it keeps playback state in the app, which already owns progress, sleep timer, smart rewind and Now Playing. A server-side sender was considered and rejected: it adds a second session holder, needs mDNS from inside the container, and only works on the server's LAN.
- **Package:** the official `https://github.com/googlecast/google-cast-ios-sdk` Swift package, product `GoogleCastDynamic`, at an exact version in `project.yml` like Readium. The dynamic product bundles the SDK's UI resources; the static one would need its `.bundle` files copied in by hand.
- **Receiver:** the Default Media Receiver (`kGCKDefaultMediaReceiverApplicationID`, `CC1AD845`). It needs no Cast Developer Console registration.
- **One queue item per manifest file**, mirroring `AudiobookPlayer.buildQueue`. A single-file book is one item, and chapters are seek targets within it, as they are locally.
- **Content type comes from the server.** Grant URLs carry no extension (`/api/books/files/:id/content?grant=…`), and the receiver needs a content type on load. Add `mime_type` to `BookManifestFile` in `@rawkoon/shared/types` and fill it with the existing `contentTypeForPath`. Both clients can ignore it until they need it. *(Claude's call: sniffing the first bytes on the phone would mean an extra request per file.)*

## Integration

### Build and permissions

- `project.yml`: add the package; depend on `GoogleCastDynamic` with `platformFilter: iOS`. Guard every Cast source with `#if !targetEnvironment(macCatalyst)`, the same way CarPlay sources are guarded.
- Info.plist: add `NSBonjourServices` = `_googlecast._tcp` and `_CC1AD845._googlecast._tcp`. Reword the existing `NSLocalNetworkUsageDescription` so it covers both the server and Cast discovery.
- `GCKCastContext` is set up once at app launch, except under XCTest. The SDK's default `startDiscoveryAfterFirstTapOnCastButton` holds discovery, and the Local Network prompt, until the first tap on the Cast button.

### Playback routing

`AudiobookPlayer` keeps its public surface (`positionSecs`, `isPlaying`, `rate`, `currentChapter`, `play()`, `pause()`, `seek(to:)`, `setRate(_:)`). Inside, it gets a route: `.local` or `.cast(CastSession)`.

- **Entering cast:** pause and tear down the local `AVQueuePlayer`, deactivate nothing yet, then load the queue on the receiver at the current file and offset, with `autoplay` and `playbackRate` set from the local state. Metadata: `GCKMediaMetadataType.audiobookChapter` (title, book title, author, cover URL).
- **While casting:** controls are forwarded to `GCKRemoteMediaClient`. Receiver status updates feed `positionSecs`, `isPlaying` and the current chapter through the same setters the local observers use. That keeps `onPositionTick`, `onPlaybackStopped`, `persistPlaybackProgress` and the sleep timer unchanged.
- **File boundaries:** the receiver advances its own queue. When the current item changes, the app maps it back to a manifest file the way `handleCurrentItemChanged` does.
- **Leaving cast** (user disconnect, receiver stopped by someone else, network loss): take the last receiver position, rebuild the local queue there with `autoplay: false`, and save progress.
- **Expired grants:** a receiver load failure with an HTTP 401 triggers the existing `refreshManifest`, then one reload at the same position, mirroring `retryStream`.

### Background and lock screen

The SDK suspends the session when the app goes to the background (`suspendSessionsWhenBackgrounded`, default on) and resumes it on return. The receiver keeps playing while the session is suspended. v1 keeps the default:

- On resume (or relaunch into a resumed session), read the receiver's position first and adopt it.
- While suspended, the lock screen shows the last known state. Remote commands while suspended are best-effort.

Turning the option off for live lock-screen control while casting is parked until v1 is in use.

## Risks to check first (spike)

1. **The receiver plays a grant URL.** Load one file of an `.m4b` and one of an `.mp3` book on a Nest Hub with the Default Media Receiver. Check seek (Range requests) and a 1.5× rate. If the receiver refuses, check whether the content route needs CORS headers.
2. **HTTPS.** The receiver page is HTTPS, so an `http://` server URL is likely blocked as mixed content. Confirm, and if so show "Casting needs an HTTPS server URL" instead of a silent failure.
3. **Dynamic framework in the Release archive.** The Release config signs manually and SPM targets already rejected a provisioning profile once (see the comment in `project.yml`). Archive on `macbuild` and through `ios.yml` before building features on top.
4. **Swift 6 strict concurrency.** The SDK is Objective-C with delegate and listener callbacks. Each callback hops to the main actor explicitly; no closure built on `@MainActor` is handed to the SDK (the same trap as the earlier playback-start crash).
5. **Build-number parsing in SDK 4.8.6.** A reported regression asserts when the first component of `CFBundleVersion` has more than six digits. Our build number is the CI run number, so it is safe, but the build number must not move to a date format while this SDK version is pinned.

## Testing

- RawkoonKit unit tests: the manifest-file → queue-item mapping (start index, offset, content type) and receiver-item → whole-book position, as pure functions.
- App tests: route switching keeps `positionSecs` continuous across enter/leave, and leaving cast never autoplays.
- Manual on a real Cast receiver: the spike list above, plus disconnect from the receiver's own UI, the phone locked for a whole chapter, and an app relaunch mid-cast.

# iOS log retrieval — 2026-09-01

This app has no remote log aggregation, and none is planned at this
milestone's scope. Every message the app logs goes through `os.Logger`
(`apps/ios/Rawkoon/Logging.swift`) into the OS's own unified logging system,
and getting it back out — from the simulator or from a real device — is a
manual, on-demand step. There is no dashboard to open; use the commands
below.

Every command filters on the subsystem string `cloud.samlo.rawkoon`, and can
be narrowed further to one of the five categories the app declares:
`playback`, `download`, `network`, `auth`, `sync`.

## From the simulator

Watch log lines live while the app runs:

```bash
xcrun simctl spawn booted log stream --predicate 'subsystem == "cloud.samlo.rawkoon"' --level debug
```

Look back over a window instead of watching live:

```bash
xcrun simctl spawn booted log show --predicate 'subsystem == "cloud.samlo.rawkoon"' --last 5m
```

Narrow either command to a single category by adding `category` to the
predicate — for example, just the download queue:

```bash
xcrun simctl spawn booted log stream --predicate 'subsystem == "cloud.samlo.rawkoon" && category == "download"' --level debug
```

## From a real device

**With a Mac.** Find the device's UDID, then collect a log archive for it:

```bash
xcrun devicectl list devices                     # find the device UDID
log collect --device-udid <UDID> --output rawkoon.logarchive
```

`rawkoon.logarchive` opens in Console.app, where the same subsystem/category
filters apply.

**Without a Mac.** Two routes, neither needs a computer:

- **On-device analytics data.** Settings → Privacy & Security → Analytics &
  Improvements → Analytics Data lists per-app diagnostic reports the device
  already collected.
- **A sysdiagnose.** Hold Volume Up, then Volume Down, then the Side button
  briefly (the same chord that triggers a screenshot, held a beat longer).
  This produces a full-system diagnostic archive containing the unified log
  for every process on the device — not just this app, and **not filterable
  by subsystem at capture time**. It is the right tool when a Mac is not
  available, but expect to search a much larger archive for the
  `cloud.samlo.rawkoon` lines once it lands somewhere they can be filtered.

## A caution about running under a debugger

Xcode sets the `OS_ACTIVITY_DT_MODE` environment variable on any process it
launches or attaches to. This disables `os.Logger`'s privacy redaction
entirely, for every field, regardless of its `.public`/`.private`
annotation — redaction is enforced at write time, and under this variable the
write-time check is skipped.

Two consequences follow from that, and both are standing operational
warnings, not footnotes about how this phase happened to be tested:

- **A console session under Xcode's Run/Debug button can display values that
  would be redacted on a real device.** A shared screen or a screen recording
  taken during a debug session can leak something the shipped app would
  never show a user or a support ticket.
- **"Is this value readable" proves nothing while a debugger is attached.**
  A correctly-`.private`-annotated value and a forgotten annotation look
  identical under `OS_ACTIVITY_DT_MODE` — both render in plain text. Any
  check of a log call's redaction behavior has to launch the app without a
  debugger attached, with `xcrun simctl launch` (or the on-device
  equivalent), not from Xcode's Run button.

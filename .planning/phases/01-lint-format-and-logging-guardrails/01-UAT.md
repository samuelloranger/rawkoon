---
status: testing
phase: 01-lint-format-and-logging-guardrails
source: [01-VERIFICATION.md]
started: 2026-09-01T21:20:00Z
updated: 2026-09-01T21:20:00Z
---

## Current Test

number: 1
name: Forced-404 log redaction check on the simulator
expected: |
  editionId, fileId, and status render as plain numbers in `log stream` output
  filtered on `subsystem == "cloud.samlo.rawkoon"` — not as `<private>`.
awaiting: user response

## Tests

### 1. Forced-404 log redaction check on the simulator

expected: editionId, fileId, and status render as plain numbers in `log stream` output filtered on `subsystem == "cloud.samlo.rawkoon"` — not as `<private>`.
result: [pending]

Force a real chapter download 404 against the v1.12.7 (or later) build on
macbuild's simulator, launching via `simctl launch` — **not** Xcode's debugger.

```
xcrun simctl spawn booted log stream --predicate 'subsystem == "cloud.samlo.rawkoon"'
```

Why a human: needs live server credentials and a genuine 404, which cannot be
fabricated safely from an agent session. Launching under Xcode sets
`OS_ACTIVITY_DT_MODE`, which disables redaction entirely and would produce a
false pass — the whole point of the check is that the values are public by
declaration, not public because the debugger is attached.

### 2. Device play/pause/resume parity against v1.12.6

expected: Behavior is indistinguishable from v1.12.6 — same audio start, same pause/resume behavior, same Lock Screen info, no new error text anywhere.
result: [pending]

On a real iPhone, install the v1.12.7 TestFlight build, open a book whose
chapters are already downloaded, then:

1. Play a downloaded chapter — audio starts as it did on v1.12.6.
2. Pause — pauses immediately, Lock Screen artwork and now-playing info unchanged.
3. Resume — resumes from the same position.
4. Nothing on screen reads differently anywhere you passed through: no new error
   text, no changed wording, no changed layout.

Why a human: requires physical device interaction. This is the phase's one named
behavior risk — the playback-path `try?`→`do`/`catch` conversion in
`AudiobookPlayer.swift` — and it has to be felt, not read. Report any difference
at all as a regression: a refactor the user can feel is a failed refactor.

## Summary

total: 2
passed: 0
issues: 0
pending: 2
skipped: 0
blocked: 0

## Gaps

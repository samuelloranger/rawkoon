---
phase: 02-shared-formatters-and-network-discipline
source: user decisions during plan-phase (2026-09-01)
---

# Phase 2 Context — locked decisions

Two forks the research surfaced were decided by the user before planning. Both
are LOCKED: the planner must honour them, and the verifier should check the
outcome against them rather than re-litigating.

## D-1 (LOCKED): the openEbook error string may change, documented and scoped

`ContinueListeningView.openEbook`'s catch hardcodes `.transport`, so today's
visible message masks the real 401/404. Routing the download through `APIClient`
surfaces the true status, which changes what the user reads.

The milestone constraint says "no user-visible change, including layout and
wording, until the localization phase". This is an explicit, scoped exception to
that constraint, granted by the user.

Bounds — narrower than "error text may change":
- ONLY the `openEbook` failure path in `ContinueListeningView`.
- NOT `BookView`, whose blanket catch produces no visible change; leave its
  wording exactly as it is.
- The old and new strings must both be recorded in the phase's verification
  notes, alongside the formatter parity table, so the change is documented
  rather than discovered.
- No other wording, layout, or timing may change anywhere.

Rationale: the current string is not merely different, it is wrong — it reports a
transport failure for what is actually an authentication or not-found result. A
phase whose whole point is "failures are typed" cannot keep a hardcoded lie in
the one place a user actually sees the failure.

## D-2 (LOCKED): `formatBytes` takes `Int64?` and returns `String`

The two existing `formatBytes` copies disagree on parse failure and on
zero/negative. The shared function takes an optional numeric input and returns a
non-optional string, so the missing-value case is explicit at each call site.

Chosen deliberately over keeping the `String?` shape: hiding the divergence
inside the shared function would make "which copy's behaviour won" invisible,
which is the opposite of what KIT-03's parity requirement is for. The signature
change forces the compiler to surface every call site, and each one gets looked
at once.

The planner should still record, per call site, what that site passed before and
what it passes now — a signature change is exactly where a silent behaviour
change hides.

## Carried in from phase 1 — constraints on how this phase can be verified

These are facts established during phase 1, not decisions, but they bound what
the plan may claim as verification:

- **`macbuild` is the only real iOS gate.** A green Linux run covers `RawkoonKit`
  alone. It was OFFLINE at planning time (`no route to host`) and still carries an
  uncommitted patch on top of `9504468` — every macbuild verify command must
  start with `git fetch && git checkout -B` against the pushed sha, or a stale
  tree will fake a `BUILD SUCCEEDED`. Phase 1's verify commands already do this;
  copy that pattern.
- **Background `URLSession` transfers do not complete in the simulator** — all
  189 tasks in a phase-1 test failed with `NSURLErrorUnknown`, and no file ever
  reached disk. The three view-level downloads this phase touches use
  `URLSession.shared`/async rather than a background session, so they may well
  work where the chapter downloader did not — but the plan must verify that
  distinction rather than assume it, and must not build a verification step on a
  background download completing in the simulator.
- **No agent cuts a release.** Shippability is `lint`/`kit`/`build` green on a
  push to `main`. The `testflight` job is gated on a published GitHub release and
  publishing is the user's decision alone. No verification step may require a
  release.
- Board **#963** remains open: `urlSession(_:task:didCompleteWithError:)` logs
  nothing and swallows transport failures. It is adjacent to criterion 4's intent
  but is not a `try?` site and is outside this phase's requirement IDs. The
  planner should say explicitly whether it is in or out; the research recommends
  out.

## D-3 (LOCKED): the shared formatters are free top-level `public func`s

Not `enum Formatters` with static members. `RawkoonKit`'s established convention
for a stateless transform is a free top-level function — `SmartRewind.swift:13`,
`ChapterFilter.swift:10`, `ContextMenuItems.swift:13` — while `struct`/`enum`
with members is reserved for types carrying real state (`BookTimeline`,
`DownloadPlan`). Nothing in the package groups unrelated pure functions under a
namespace enum, so introducing one would invent a convention rather than follow
the surrounding code.

The research drafted `enum Formatters`; it is defensible but not a copy of
anything here, and this milestone's whole purpose is that the next feature is
cheap because the code reads consistently.

## D-4 (LOCKED): no capture script is committed

The parity capture runs as a throwaway (`swift <file>.swift` from `/tmp` on
`macbuild`) against the distinct formatter bodies. There is no Swift-script
precedent anywhere in the repo — `apps/ios/scripts/` holds only `.mjs`/`.ts` for
App Store Connect — so adding one for a one-time measurement would leave a file
nobody maintains.

Commit the captured OUTPUT (the parity document), not the instrument. The
document is what the verifier reads and what has lasting value; the script is
scaffolding.

## Fix template — already in the codebase

The crash on non-finite input has an existing shape to copy rather than invent:

- Guard: `guard value.isFinite, value > 0 else { return <safe default> }`
  — `apps/ios/Sources/RawkoonKit/SmartRewind.swift:13`
- Test: the `-5` / `.nan` / `.infinity` triple
  — `apps/ios/Tests/RawkoonKitTests/SmartRewindTests.swift:24-29`

Use both. A new guard written in a different shape from the one already in the
package is a worse outcome than the bug.

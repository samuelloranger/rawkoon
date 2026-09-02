# iOS Settings Parity — Phase 1 (Foundation + Device Roster) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the shared foundation (RawkoonKit pure logic, APIClient generic helpers, reusable SwiftUI settings components, admin-refresh) and the first consumer of it — the notification **device roster** in both the iOS app and the web app.

**Architecture:** Native SwiftUI on the existing three-layer architecture (APIClient actor · DTOs · thin views); Linux-testable pure logic lives in the `RawkoonKit` SPM package; the single web change adds an `ApnsDevice` shared type + hooks + a device-list split in `NotificationsTab`. No behavior change to existing screens.

**Tech Stack:** Swift 6 / SwiftUI / iOS 18 / Xcode 26 SDK; `RawkoonKit` (dependency-free SPM, Linux `swift test`); React 19 + TanStack Query + vitest (web); Bun workspace.

**Spec:** `docs/superpowers/specs/2026-09-02-ios-settings-full-parity-design.md` — read it, especially §0 Design Contract, §4 Architecture, §5 Phase 1, §6 web change. The plan implements Phase 1 only.

## Global Constraints

- **Approach A only** — native SwiftUI on the existing three layers; no WKWebView, no codegen, no MVVM, no new third-party deps. (Spec §0.1)
- **Match the iOS house style** — mirror `SettingsView.swift` / `NotificationsSettingsView.swift`: view-owned `@State`, `.task { await load() }`, `model.api()`, `Theme` tokens, `.listRowBackground(Theme.raised)`, `.scrollContentBackground(.hidden)`, inline nav titles. (Spec §0.2, §4.7)
- **Same endpoints as web**; never invent an endpoint not named in the spec. (Spec §0.4)
- **No behavior change to existing screens; no on-device state migration** — Keychain, position journal, downloaded library untouched. (Spec §0.5)
- **No release, ever** — no `MARKETING_VERSION` bump, tag, or GitHub release. (Spec §0.6)
- **Verification is macbuild** — a task touching the iOS app target is done only when `swiftformat --lint` + `swiftlint` + `swift test` (RawkoonKit) + `xcodebuild build` are green on the `macbuild` host; pull first, confirm the commit (stale-git BUILD-SUCCEEDED trap). Linux builds RawkoonKit only. (Spec §0.7)
- **New strings are English inline literals**; no `.xcstrings`. (Spec §0.8)
- **DTOs:** `nonisolated struct … : Decodable/Encodable, Sendable`; decode via the shared `mediaDecoder` (`.convertFromSnakeCase`); model absent-able fields as optional, never force-unwrap. (Spec §4.3)
- **Web query keys** centralized in `apps/web/src/lib/queryKeys.ts`; endpoints in `apps/web/src/lib/endpoints/*`; shared types in `@rawkoon/shared/types`. (repo CLAUDE.md)

---

## File Structure

**RawkoonKit (new, Linux-testable):**
- Create `apps/ios/Sources/RawkoonKit/Settings/SettingsDirty.swift` — pure dirty-diff incl. secret asymmetry.
- Create `apps/ios/Sources/RawkoonKit/Settings/SecretBody.swift` — omit-empty-secret body builder.
- Create `apps/ios/Sources/RawkoonKit/Settings/SettingsValidation.swift` — language min-count, number clamp, non-empty checks.
- Create `apps/ios/Sources/RawkoonKit/Settings/ConditionRules.swift` — condition type→operator allow-table (shell used fully in Phase 4).
- Test `apps/ios/Tests/RawkoonKitTests/Settings/{SettingsDirtyTests,SecretBodyTests,SettingsValidationTests,ConditionRulesTests}.swift`.

  *(Confirm the exact RawkoonKit package dir on disk before Task 1 — `swift package describe --type library` from `apps/ios`, or inspect `Package.swift`. Paths above assume the standard SPM layout; adjust to the real one and keep it consistent.)*

**iOS app target:**
- Create `apps/ios/Rawkoon/APIClient+Settings.swift` — settings/device methods in an `extension APIClient`.
- Modify `apps/ios/Rawkoon/APIClient.swift` — promote generic helpers `internal`; add generics.
- Modify `apps/ios/Rawkoon/Models.swift` — add device DTOs.
- Modify `apps/ios/Rawkoon/AppModel.swift` — add `refreshAdminIfNeeded()`.
- Create `apps/ios/Rawkoon/Views/Settings/SettingsComponents.swift` and `SettingsFormScaffold.swift` — the §4.7 primitives.
- Create `apps/ios/Rawkoon/Views/DevicesView.swift`.
- Modify `apps/ios/Rawkoon/Views/SettingsView.swift` — add a "Devices" `NavigationLink` in Account; call `refreshAdminIfNeeded()`.

**Web:**
- Modify `apps/web/../../apps/shared/src/types/notification.ts` — `ApnsDevice`, `ApnsDevicesResponse`.
- Modify `apps/web/src/lib/endpoints/*` (notification endpoints) — APNS device paths.
- Modify `apps/web/src/lib/queryKeys.ts` — apns devices key.
- Create `apps/web/src/lib/notifications/useApnsDevices.ts`, `useDeleteApnsDevice.ts`.
- Modify `apps/web/src/pages/settings/_component/NotificationsTab.tsx` — split Web push / iOS groups.
- Modify `apps/web/src/locales/en/*.json` + `fr/*.json` — device-group strings.
- Test `apps/web/src/lib/notifications/useApnsDevices.test.ts` and a `NotificationsTab` render test.

---

## Task 1: RawkoonKit — `SettingsDirty`

**Files:**
- Create: `apps/ios/Sources/RawkoonKit/Settings/SettingsDirty.swift`
- Test: `apps/ios/Tests/RawkoonKitTests/Settings/SettingsDirtyTests.swift`

**Interfaces:**
- Produces: `enum SettingsDirty { static func isDirty<T: Equatable>(loaded: T, draft: T, secretEntered: Bool) -> Bool }` — dirty when `draft != loaded` OR a secret was entered.

- [ ] **Step 1: Write the failing test**

```swift
import Testing
@testable import RawkoonKit

struct SettingsDirtyTests {
    @Test func cleanWhenEqualAndNoSecret() {
        #expect(SettingsDirty.isDirty(loaded: "a", draft: "a", secretEntered: false) == false)
    }
    @Test func dirtyWhenValueChanged() {
        #expect(SettingsDirty.isDirty(loaded: "a", draft: "b", secretEntered: false) == true)
    }
    @Test func dirtyWhenSecretEnteredEvenIfEqual() {
        #expect(SettingsDirty.isDirty(loaded: "a", draft: "a", secretEntered: true) == true)
    }
}
```

- [ ] **Step 2: Run test to verify it fails**

Run (from `apps/ios`): `swift test --filter SettingsDirtyTests`
Expected: FAIL — `SettingsDirty` not defined.

- [ ] **Step 3: Write minimal implementation**

```swift
/// Pure dirty-tracking for settings forms. A secret field is dirty only when
/// the user typed something (empty secret never marks the form dirty — see spec §4.4/§4.6).
public enum SettingsDirty {
    public static func isDirty<T: Equatable>(loaded: T, draft: T, secretEntered: Bool) -> Bool {
        draft != loaded || secretEntered
    }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `swift test --filter SettingsDirtyTests`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/ios/Sources/RawkoonKit/Settings/SettingsDirty.swift apps/ios/Tests/RawkoonKitTests/Settings/SettingsDirtyTests.swift
git commit -m "feat(ios): RawkoonKit SettingsDirty pure dirty-tracking"
```

---

## Task 2: RawkoonKit — secret-omission body builder

**Files:**
- Create: `apps/ios/Sources/RawkoonKit/Settings/SecretBody.swift`
- Test: `apps/ios/Tests/RawkoonKitTests/Settings/SecretBodyTests.swift`

**Interfaces:**
- Produces: `enum SecretBody { static func merge(base: [String: SecretBody.Value], secret key: String, value: String) -> [String: SecretBody.Value] }` where `Value` is `.string(String) | .bool(Bool) | .int(Int) | .double(Double)`. Adds the secret key **only when `value` is non-empty**; never emits it as null. (Spec §4.4: a blank secret must be omitted, never sent as null, or the server clears it.)

- [ ] **Step 1: Write the failing test**

```swift
import Testing
@testable import RawkoonKit

struct SecretBodyTests {
    @Test func omitsEmptySecret() {
        let body = SecretBody.merge(base: ["enabled": .bool(true)], secret: "api_key", value: "")
        #expect(body["api_key"] == nil)
        #expect(body["enabled"] == .bool(true))
    }
    @Test func includesNonEmptySecret() {
        let body = SecretBody.merge(base: ["enabled": .bool(true)], secret: "api_key", value: "sk-123")
        #expect(body["api_key"] == .string("sk-123"))
    }
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `swift test --filter SecretBodyTests`
Expected: FAIL — `SecretBody` not defined.

- [ ] **Step 3: Write minimal implementation**

```swift
/// Builds request bodies that OMIT a secret field when the user left it blank,
/// so a stored server-side secret is never wiped (spec §4.4).
public enum SecretBody {
    public enum Value: Equatable {
        case string(String), bool(Bool), int(Int), double(Double)
    }
    public static func merge(base: [String: Value], secret key: String, value: String) -> [String: Value] {
        guard !value.isEmpty else { return base }
        var out = base
        out[key] = .string(value)
        return out
    }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `swift test --filter SecretBodyTests`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/ios/Sources/RawkoonKit/Settings/SecretBody.swift apps/ios/Tests/RawkoonKitTests/Settings/SecretBodyTests.swift
git commit -m "feat(ios): RawkoonKit secret-omission body builder"
```

---

## Task 3: RawkoonKit — `SettingsValidation`

**Files:**
- Create: `apps/ios/Sources/RawkoonKit/Settings/SettingsValidation.swift`
- Test: `apps/ios/Tests/RawkoonKitTests/Settings/SettingsValidationTests.swift`

**Interfaces:**
- Produces: `enum SettingsValidation { static func clamp(_ v: Int, to range: ClosedRange<Int>) -> Int; static func hasMinSelection<T>(_ set: Set<T>, min: Int) -> Bool; static func nonBlank(_ s: String) -> Bool }`.

- [ ] **Step 1: Write the failing test**

```swift
import Testing
@testable import RawkoonKit

struct SettingsValidationTests {
    @Test func clampsIntoRange() {
        #expect(SettingsValidation.clamp(150, to: 0...100) == 100)
        #expect(SettingsValidation.clamp(-5, to: 0...100) == 0)
        #expect(SettingsValidation.clamp(50, to: 0...100) == 50)
    }
    @Test func enforcesMinSelection() {
        #expect(SettingsValidation.hasMinSelection(Set(["en"]), min: 1) == true)
        #expect(SettingsValidation.hasMinSelection(Set<String>(), min: 1) == false)
    }
    @Test func detectsBlank() {
        #expect(SettingsValidation.nonBlank("  ") == false)
        #expect(SettingsValidation.nonBlank(" x ") == true)
    }
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `swift test --filter SettingsValidationTests`
Expected: FAIL — `SettingsValidation` not defined.

- [ ] **Step 3: Write minimal implementation**

```swift
public enum SettingsValidation {
    public static func clamp(_ v: Int, to range: ClosedRange<Int>) -> Int {
        min(max(v, range.lowerBound), range.upperBound)
    }
    public static func hasMinSelection<T>(_ set: Set<T>, min: Int) -> Bool {
        set.count >= min
    }
    public static func nonBlank(_ s: String) -> Bool {
        !s.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `swift test --filter SettingsValidationTests`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/ios/Sources/RawkoonKit/Settings/SettingsValidation.swift apps/ios/Tests/RawkoonKitTests/Settings/SettingsValidationTests.swift
git commit -m "feat(ios): RawkoonKit settings validation helpers"
```

---

## Task 4: RawkoonKit — `ConditionRules` (allow-table shell)

**Files:**
- Create: `apps/ios/Sources/RawkoonKit/Settings/ConditionRules.swift`
- Test: `apps/ios/Tests/RawkoonKitTests/Settings/ConditionRulesTests.swift`

**Interfaces:**
- Produces: `enum ConditionRules { static func operators(for type: String) -> [String]; static func needsValue(_ operator: String) -> Bool }`. The full custom-format matrix from spec §5 Phase 4; built now so the condition-builder component shell (Task 6) compiles against a real API. Values mirror `apps/api/src/services/customFormatValidation.ts` — read it and copy the mapping exactly.

- [ ] **Step 1: Write the failing test**

```swift
import Testing
@testable import RawkoonKit

struct ConditionRulesTests {
    @Test func regexTypeAllowsMatchesOnly() {
        #expect(ConditionRules.operators(for: "title_regex") == ["matches"])
    }
    @Test func numericTypeAllowsComparators() {
        #expect(ConditionRules.operators(for: "seeders").contains("between"))
        #expect(ConditionRules.operators(for: "seeders").contains("gte"))
    }
    @Test func booleanFlagNeedsNoValue() {
        #expect(ConditionRules.needsValue("is_true") == false)
        #expect(ConditionRules.needsValue("equals") == true)
    }
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `swift test --filter ConditionRulesTests`
Expected: FAIL — `ConditionRules` not defined.

- [ ] **Step 3: Write minimal implementation**

```swift
/// Custom-format condition type → allowed operators, mirroring
/// apps/api/src/services/customFormatValidation.ts (spec §5 Phase 4).
public enum ConditionRules {
    private static let table: [String: [String]] = [
        "title_regex": ["matches"],
        "release_group": ["matches"],
        "source": ["equals"],
        "codec": ["equals"],
        "indexer": ["equals"],
        "language": ["equals"],
        "resolution": ["gte", "lte", "lt", "gt", "equals", "between"],
        "seeders": ["gte", "lte", "lt", "gt", "equals", "between"],
        "size_range": ["gte", "lte", "lt", "gt", "equals", "between"],
        "hdr_flag": ["is_true"],
        "proper_repack": ["is_true"],
        "freeleech": ["is_true"],
    ]
    public static func operators(for type: String) -> [String] { table[type] ?? [] }
    public static func needsValue(_ op: String) -> Bool { op != "is_true" }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `swift test --filter ConditionRulesTests`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/ios/Sources/RawkoonKit/Settings/ConditionRules.swift apps/ios/Tests/RawkoonKitTests/Settings/ConditionRulesTests.swift
git commit -m "feat(ios): RawkoonKit condition-rules allow-table"
```

---

## Task 5: iOS APIClient generic helpers + `APIClient+Settings.swift` split

**Files:**
- Modify: `apps/ios/Rawkoon/APIClient.swift` — change `private` → `internal` on: `makeRequest`, `perform`, `mapStatus`, `get`, `post`, `postExpectOK`, `sendPost`, `patch`, `sendPatch`, `postRaw`, `pathWithQuery`, and the static `mediaDecoder`/`mediaEncoder`. Add the new generics below.
- Create: `apps/ios/Rawkoon/APIClient+Settings.swift` — empty `extension APIClient {}` for now (device methods land in Task 11).

**Interfaces:**
- Produces (on `APIClient`, `internal`):
  - `func put<T: Decodable>(_ path: String, body: some Encodable) async throws -> T`
  - `func putExpectOK(_ path: String, body: some Encodable) async throws`
  - `func patchExpectOK(_ path: String, body: some Encodable) async throws`
  - `func deleteExpectOK(_ path: String, query: [String: String?] = [:]) async throws`
  - `func delete<T: Decodable>(_ path: String) async throws -> T`
  - Plain-casing (no key conversion) `func getPlain<T: Decodable>(_ path: String) async throws -> T`, `func putPlain<T: Decodable>(_ path: String, body: some Encodable) async throws -> T`, `func postPlainExpectOK(_ path: String, body: some Encodable) async throws` — for the Download-Client Hook camelCase wire (spec §4.2; used in Phase 3).

- [ ] **Step 1: Add the generic helpers**

In `APIClient.swift`, after `sendPatch(...)`, add (real bodies; a `sendPut` mirrors `sendPost`):

```swift
    private func sendPut(_ path: String, body: some Encodable) async throws -> (Data, HTTPURLResponse) {
        var request = try makeRequest(path: path, method: "PUT", requiresAuth: true)
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try Self.mediaEncoder.encode(body)
        return try await perform(request)
    }

    func put<T: Decodable>(_ path: String, body: some Encodable) async throws -> T {
        let (data, response) = try await sendPut(path, body: body)
        guard (200 ..< 300).contains(response.statusCode) else { throw mapStatus(response.statusCode) }
        do { return try Self.mediaDecoder.decode(T.self, from: data) }
        catch { throw APIError.decode }
    }

    func putExpectOK(_ path: String, body: some Encodable) async throws {
        let (_, response) = try await sendPut(path, body: body)
        guard (200 ..< 300).contains(response.statusCode) else { throw mapStatus(response.statusCode) }
    }

    func patchExpectOK(_ path: String, body: some Encodable) async throws {
        let (_, response) = try await sendPatch(path, body: body)
        guard (200 ..< 300).contains(response.statusCode) else { throw mapStatus(response.statusCode) }
    }

    func deleteExpectOK(_ path: String, query: [String: String?] = [:]) async throws {
        let request = try makeRequest(path: pathWithQuery(path, query), method: "DELETE", requiresAuth: true)
        let (_, response) = try await perform(request)
        guard (200 ..< 300).contains(response.statusCode) else { throw mapStatus(response.statusCode) }
    }

    func delete<T: Decodable>(_ path: String) async throws -> T {
        let request = try makeRequest(path: path, method: "DELETE", requiresAuth: true)
        let (data, response) = try await perform(request)
        guard (200 ..< 300).contains(response.statusCode) else { throw mapStatus(response.statusCode) }
        do { return try Self.mediaDecoder.decode(T.self, from: data) }
        catch { throw APIError.decode }
    }
```

Add plain-casing coders + helpers (no snake conversion, spec §4.2):

```swift
    private static let plainDecoder = JSONDecoder()
    private static let plainEncoder = JSONEncoder()

    func getPlain<T: Decodable>(_ path: String) async throws -> T {
        let request = try makeRequest(path: path, method: "GET", requiresAuth: true)
        let (data, response) = try await perform(request)
        guard (200 ..< 300).contains(response.statusCode) else { throw mapStatus(response.statusCode) }
        do { return try Self.plainDecoder.decode(T.self, from: data) }
        catch { throw APIError.decode }
    }

    func putPlain<T: Decodable>(_ path: String, body: some Encodable) async throws -> T {
        var request = try makeRequest(path: path, method: "PUT", requiresAuth: true)
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try Self.plainEncoder.encode(body)
        let (data, response) = try await perform(request)
        guard (200 ..< 300).contains(response.statusCode) else { throw mapStatus(response.statusCode) }
        do { return try Self.plainDecoder.decode(T.self, from: data) }
        catch { throw APIError.decode }
    }

    func postPlainExpectOK(_ path: String, body: some Encodable) async throws {
        var request = try makeRequest(path: path, method: "POST", requiresAuth: true)
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try Self.plainEncoder.encode(body)
        let (_, response) = try await perform(request)
        guard (200 ..< 300).contains(response.statusCode) else { throw mapStatus(response.statusCode) }
    }
```

- [ ] **Step 2: Promote existing helpers to `internal`**

Remove the `private` keyword from `makeRequest`, `perform`, `mapStatus`, `get`, `post`, `postExpectOK`, `sendPost`, `patch`, `sendPatch`, `postRaw`, `pathWithQuery`, and the static `mediaDecoder`/`mediaEncoder` (leave everything else private). This lets the `APIClient+Settings.swift` extension reuse them.

- [ ] **Step 3: Create the settings extension file**

```swift
import Foundation

// Settings & device API methods. Kept out of APIClient.swift to stay under the
// file_length lint threshold (spec §4.2). Device methods land in Task 11.
extension APIClient {}
```

- [ ] **Step 4: Check `.swiftlint.yml` `file_length`**

Read `apps/ios/.swiftlint.yml`. Confirm `APIClient.swift` after these additions is under the `file_length` error threshold; if not, move more existing method groups into extension files. Note the threshold in the commit body.

- [ ] **Step 5: Verify on macbuild**

Run on `macbuild` (pull first, confirm HEAD): `swiftformat --lint apps/ios && swiftlint --config apps/ios/.swiftlint.yml && cd apps/ios && xcodegen generate && xcodebuild build -scheme Rawkoon -destination 'generic/platform=iOS Simulator' CODE_SIGNING_ALLOWED=NO`
Expected: lint clean, BUILD SUCCEEDED.

- [ ] **Step 6: Commit**

```bash
git add apps/ios/Rawkoon/APIClient.swift apps/ios/Rawkoon/APIClient+Settings.swift
git commit -m "feat(ios): APIClient generic PUT/PATCH/DELETE + plain-casing helpers"
```

---

## Task 6: iOS shared settings components

**Files:**
- Create: `apps/ios/Rawkoon/Views/Settings/SettingsComponents.swift` — the field primitives.
- Create: `apps/ios/Rawkoon/Views/Settings/SettingsFormScaffold.swift` — `CrudListScaffold`, `SaveCancelBar`/dirty container, `SettingsStateView`.

**Interfaces:** implement every component in the spec §4.7 table with the exact signatures listed there. This task's verification is compilation + reuse by `DevicesView` (Task 12). Build the `ConditionBuilderView` as a compiling shell that consumes `RawkoonKit.ConditionRules` (Task 4); its full editor lands in Phase 4.

- Produces (representative — full set per spec §4.7): `LabeledTextFieldRow`, `SecretField`, `ToggleRow`, `PickerRow<T: Hashable>`, `SegmentedRow<T: Hashable>`, `MultiSelectRow<T: Hashable>`, `NumberFieldRow`, `OrderedPickerRow<T>`, `TrackerPriorityEditor`, `TestConnectionButton`, `CrudListScaffold`, `SettingsStateView`, `JobStatusRow`, `ConditionBuilderView` (shell).

- [ ] **Step 1: Implement `SettingsComponents.swift`**

Worked example for one primitive (implement the rest to the §4.7 signatures, same house style — `Theme` tokens, `Form`/`Section` friendly):

```swift
import SwiftUI

struct LabeledTextFieldRow: View {
    let title: String
    @Binding var text: String
    var placeholder: String = ""
    var keyboard: UIKeyboardType = .default
    var autocaps: Bool = false
    var mono: Bool = false

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(title).font(.footnote).foregroundStyle(Theme.muted)
            TextField(placeholder, text: $text)
                .keyboardType(keyboard)
                .textInputAutocapitalization(autocaps ? .sentences : .never)
                .autocorrectionDisabled(!autocaps)
                .font(mono ? .system(.body, design: .monospaced) : .body)
        }
        .listRowBackground(Theme.raised)
    }
}

struct ToggleRow: View {
    let title: String
    @Binding var isOn: Bool
    var subtitle: String? = nil
    var body: some View {
        Toggle(isOn: $isOn) {
            VStack(alignment: .leading, spacing: 2) {
                Text(title)
                if let subtitle { Text(subtitle).font(.footnote).foregroundStyle(Theme.muted) }
            }
        }
        .tint(Theme.apricot)
        .listRowBackground(Theme.raised)
    }
}
```

Implement `SecretField`, `PickerRow`, `SegmentedRow`, `MultiSelectRow`, `NumberFieldRow`, `OrderedPickerRow`, `TrackerPriorityEditor`, `TestConnectionButton`, `JobStatusRow` to their §4.7 signatures. `SecretField` never renders the stored secret; shows a masked placeholder (spec §4.4).

- [ ] **Step 2: Implement `SettingsFormScaffold.swift`**

`SettingsStateView` (loading spinner / error `ContentUnavailableView` + retry / empty), a generic `CrudListScaffold<Item: Identifiable>` (load, row, onDelete, addDestination, emptyState, footer count, toolbar "+", swipe-delete+confirm, re-`load()` after mutation), and `ConditionBuilderView` shell that lists rows and offers `ConditionRules.operators(for:)`.

- [ ] **Step 3: Verify on macbuild**

Run on `macbuild`: `swiftformat --lint apps/ios && swiftlint --config apps/ios/.swiftlint.yml && cd apps/ios && xcodegen generate && xcodebuild build -scheme Rawkoon -destination 'generic/platform=iOS Simulator' CODE_SIGNING_ALLOWED=NO`
Expected: lint clean, BUILD SUCCEEDED. (These are not yet referenced by a screen; a `#Preview` in each keeps the compiler exercising them.)

- [ ] **Step 4: Commit**

```bash
git add apps/ios/Rawkoon/Views/Settings/SettingsComponents.swift apps/ios/Rawkoon/Views/Settings/SettingsFormScaffold.swift
git commit -m "feat(ios): reusable settings form components"
```

---

## Task 7: iOS `AppModel.refreshAdminIfNeeded()`

**Files:**
- Modify: `apps/ios/Rawkoon/AppModel.swift` — add the method near the existing private `refreshAdmin()` (line ~721).

**Interfaces:**
- Consumes: existing private `refreshAdmin()`, `isAdmin`, `apiClient`.
- Produces: `func refreshAdminIfNeeded() async` — public (call from `SettingsView.task`); refreshes admin state when the app couldn't earlier (e.g. cold Settings open with no library loaded). Only ever *adds* admin rows for real admins (spec §4.5). Add a guard flag `private var didRefreshAdminOnce = false` so it runs at least once per session even if `isAdmin` is already false.

- [ ] **Step 1: Add the method**

```swift
    private var didRefreshAdminOnce = false

    /// Refresh admin state on a cold Settings open (or after a promotion/demotion),
    /// since `refreshAdmin()` otherwise only runs on login/library-reload (spec §4.5).
    func refreshAdminIfNeeded() async {
        guard apiClient != nil, !didRefreshAdminOnce else { return }
        didRefreshAdminOnce = true
        await refreshAdmin()
    }
```

- [ ] **Step 2: Verify on macbuild**

Run on `macbuild`: `cd apps/ios && xcodegen generate && xcodebuild build -scheme Rawkoon -destination 'generic/platform=iOS Simulator' CODE_SIGNING_ALLOWED=NO`
Expected: BUILD SUCCEEDED.

- [ ] **Step 3: Commit**

```bash
git add apps/ios/Rawkoon/AppModel.swift
git commit -m "feat(ios): AppModel.refreshAdminIfNeeded for cold settings open"
```

---

## Task 8: Web — `ApnsDevice` shared type + endpoints + query key

**Files:**
- Modify: `apps/shared/src/types/notification.ts`
- Modify: `apps/web/src/lib/endpoints/*` (the notifications endpoints module — locate `NOTIFICATION_ENDPOINTS`)
- Modify: `apps/web/src/lib/queryKeys.ts`

**Interfaces:**
- Produces: `interface ApnsDevice { id: number; device_name: string | null; os_version: string | null; app_version: string | null; created_at: string; }` and `interface ApnsDevicesResponse { devices: ApnsDevice[] }`; `NOTIFICATION_ENDPOINTS.APNS_DEVICES` (`"/api/notifications/apns/devices"`) and `APNS_DELETE_DEVICE(id)`; `queryKeys.notifications.apnsDevices()`.

  *(Confirm the exact `ApnsDevice` field names against the `GET /api/notifications/apns/devices` handler at `apps/api/src/routes/notifications/index.ts:709` before writing — copy the wire names verbatim.)*

- [ ] **Step 1: Add the shared types**

Append to `apps/shared/src/types/notification.ts`:

```typescript
export interface ApnsDevice {
  id: number;
  device_name: string | null;
  os_version: string | null;
  app_version: string | null;
  created_at: string;
}

export interface ApnsDevicesResponse {
  devices: ApnsDevice[];
}
```

- [ ] **Step 2: Add endpoints + query key**

In the notifications endpoints module, alongside `DEVICES`/`DELETE_DEVICE`:

```typescript
  APNS_DEVICES: "/api/notifications/apns/devices",
  APNS_DELETE_DEVICE: (id: number) => `/api/notifications/apns/devices/${id}`,
```

In `apps/web/src/lib/queryKeys.ts`, under `notifications`:

```typescript
    apnsDevices: () => [...queryKeys.notifications.all, "apns-devices"] as const,
```

- [ ] **Step 3: Typecheck**

Run: `bun run typecheck` (from repo root) and `cd apps/shared && bun run formatCheck`
Expected: pass.

- [ ] **Step 4: Commit**

```bash
git add apps/shared/src/types/notification.ts apps/web/src/lib/endpoints apps/web/src/lib/queryKeys.ts
git commit -m "feat(web): ApnsDevice shared type + endpoints"
```

---

## Task 9: Web — `useApnsDevices` + `useDeleteApnsDevice`

**Files:**
- Create: `apps/web/src/lib/notifications/useApnsDevices.ts`
- Create: `apps/web/src/lib/notifications/useDeleteApnsDevice.ts`
- Test: `apps/web/src/lib/notifications/useApnsDevices.test.ts`

**Interfaces:**
- Consumes: `useFetcher`, `queryKeys.notifications.apnsDevices()`, `NOTIFICATION_ENDPOINTS.APNS_DEVICES`/`APNS_DELETE_DEVICE`, `ApnsDevicesResponse`.
- Produces: `useApnsDevices(options?)` (mirrors `useNotificationDevices`), `useDeleteApnsDevice()` (mirrors `useDeleteNotificationDevice`, invalidates `apnsDevices()`).

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, it, expect, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useApnsDevices } from "./useApnsDevices";

const fetcher = vi.fn().mockResolvedValue({ devices: [{ id: 1, device_name: "iPhone", os_version: "18.2", app_version: "1.12.8", created_at: "2026-09-01T00:00:00Z" }] });
vi.mock("@/lib/api/context", () => ({ useFetcher: () => fetcher }));

function wrapper({ children }: { children: React.ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

describe("useApnsDevices", () => {
  it("fetches APNS devices", async () => {
    const { result } = renderHook(() => useApnsDevices(), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.devices[0].device_name).toBe("iPhone");
    expect(fetcher).toHaveBeenCalledWith("/api/notifications/apns/devices");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/web && bunx vitest run src/lib/notifications/useApnsDevices.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the hooks**

`useApnsDevices.ts`:

```typescript
import { useQuery, type UseQueryOptions } from "@tanstack/react-query";
import { useFetcher } from "@/lib/api/context";
import { queryKeys } from "@/lib/queryKeys";
import { NOTIFICATION_ENDPOINTS } from "@/lib/endpoints";
import type { ApnsDevicesResponse } from "@rawkoon/shared/types";

export function useApnsDevices(
  options?: Omit<UseQueryOptions<ApnsDevicesResponse>, "queryKey" | "queryFn">,
) {
  const fetcher = useFetcher();
  return useQuery({
    queryKey: queryKeys.notifications.apnsDevices(),
    queryFn: () => fetcher<ApnsDevicesResponse>(NOTIFICATION_ENDPOINTS.APNS_DEVICES),
    staleTime: 5 * 60_000,
    ...options,
  });
}
```

`useDeleteApnsDevice.ts`:

```typescript
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useFetcher } from "@/lib/api/context";
import { queryKeys } from "@/lib/queryKeys";
import { NOTIFICATION_ENDPOINTS } from "@/lib/endpoints";

export function useDeleteApnsDevice() {
  const fetcher = useFetcher();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (deviceId: number) =>
      fetcher<{ success: boolean }>(NOTIFICATION_ENDPOINTS.APNS_DELETE_DEVICE(deviceId), {
        method: "DELETE",
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.notifications.apnsDevices() });
    },
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/web && bunx vitest run src/lib/notifications/useApnsDevices.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/notifications/useApnsDevices.ts apps/web/src/lib/notifications/useDeleteApnsDevice.ts apps/web/src/lib/notifications/useApnsDevices.test.ts
git commit -m "feat(web): useApnsDevices + useDeleteApnsDevice hooks"
```

---

## Task 10: Web — split the NotificationsTab device list (Web push / iOS)

**Files:**
- Modify: `apps/web/src/pages/settings/_component/NotificationsTab.tsx`
- Modify: `apps/web/src/locales/en/common.json` + `apps/web/src/locales/fr/common.json` (the namespace the tab uses — confirm from `useTranslation("common")`).
- Test: `apps/web/src/pages/settings/_component/NotificationsTab.test.tsx`

**Interfaces:**
- Consumes: `useApnsDevices`, `useDeleteApnsDevice` (Task 9); existing `useNotificationDevices`, `useDeleteNotificationDevice`.
- Produces: a device section rendering two labeled groups — "Web push" (existing web-push devices) and "iOS app" (APNS devices) — each with a per-group empty state and a delete-with-confirm. Existing web-push behavior unchanged; iOS group is additive.

- [ ] **Step 1: Write the failing render test**

```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { NotificationsTab } from "./NotificationsTab";

vi.mock("@/lib/notifications/useApnsDevices", () => ({
  useApnsDevices: () => ({ data: { devices: [{ id: 9, device_name: "Sam's iPhone", os_version: "18.2", app_version: "1.12.8", created_at: "2026-09-01T00:00:00Z" }] }, isLoading: false }),
}));
// ...mock the other notification hooks + i18n as the file's siblings do (copy from an existing settings test).

describe("NotificationsTab device roster", () => {
  it("renders an iOS app group with the registered device", () => {
    render(<NotificationsTab />);
    expect(screen.getByText("Sam's iPhone")).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/web && bunx vitest run src/pages/settings/_component/NotificationsTab.test.tsx`
Expected: FAIL — no "Sam's iPhone" (iOS group not rendered yet).

- [ ] **Step 3: Implement the split**

In `NotificationsTab`, add `const { data: apnsData } = useApnsDevices();` and `const deleteApns = useDeleteApnsDevice();`. Render the existing device list under a "Web push" group heading, and a new "iOS app" group iterating `apnsData?.devices ?? []` (name = `device_name`, subtitle = `iOS {os_version} · Rawkoon {app_version} · {formatDate(created_at)}`, a delete button using the existing `confirm(...)` pattern → `deleteApns.mutateAsync(id)`). Each group shows its own empty state when its list is empty. Add the new i18n keys (`settings.notifications.devices.webPushGroup`, `.iosGroup`, `.iosEmpty`, `.webEmpty`) to `en` and `fr`.

- [ ] **Step 4: Run test + full web suite**

Run: `cd apps/web && bunx vitest run src/pages/settings/_component/NotificationsTab.test.tsx && cd ../.. && bun run typecheck && bun run lint`
Expected: PASS, typecheck + biome clean.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/pages/settings/_component/NotificationsTab.tsx apps/web/src/pages/settings/_component/NotificationsTab.test.tsx apps/web/src/locales/en apps/web/src/locales/fr
git commit -m "feat(web): show iOS devices alongside web push in notifications"
```

---

## Task 11: iOS — device DTOs + APIClient device methods

**Files:**
- Modify: `apps/ios/Rawkoon/Models.swift` — add device DTOs.
- Modify: `apps/ios/Rawkoon/APIClient+Settings.swift` — add the four methods.

**Interfaces:**
- Consumes: generics from Task 5 (`deleteExpectOK`, `get`).
- Produces: DTOs `ApnsDeviceDTO`, `WebPushDeviceDTO`, `ApnsDevicesResponse`, `WebPushDevicesResponse`; methods `apnsDevices() -> ApnsDevicesResponse` (GET `/api/notifications/apns/devices`), `deleteApnsDevice(id:) async throws` (DELETE `.../apns/devices/:id`), `webPushDevices() -> WebPushDevicesResponse` (GET `/api/notifications/devices`), `deleteWebPushDevice(id:) async throws` (DELETE `.../devices/:id`).

  *(Confirm field names against the two GET handlers before writing; model everything optional except `id`/`createdAt`.)*

- [ ] **Step 1: Add the DTOs**

```swift
nonisolated struct ApnsDeviceDTO: Decodable, Identifiable, Sendable {
    let id: Int
    let deviceName: String?
    let osVersion: String?
    let appVersion: String?
    let createdAt: String?
}
nonisolated struct ApnsDevicesResponse: Decodable, Sendable { let devices: [ApnsDeviceDTO] }

nonisolated struct WebPushDeviceDTO: Decodable, Identifiable, Sendable {
    let id: Int
    let endpoint: String?
    let deviceName: String?
    let osName: String?
    let osVersion: String?
    let browserName: String?
    let browserVersion: String?
    let platform: String?
    let createdAt: String?
}
nonisolated struct WebPushDevicesResponse: Decodable, Sendable { let devices: [WebPushDeviceDTO] }
```

- [ ] **Step 2: Add the methods to `APIClient+Settings.swift`**

```swift
extension APIClient {
    func apnsDevices() async throws -> ApnsDevicesResponse {
        try await get("/api/notifications/apns/devices")
    }
    func deleteApnsDevice(id: Int) async throws {
        try await deleteExpectOK("/api/notifications/apns/devices/\(id)")
    }
    func webPushDevices() async throws -> WebPushDevicesResponse {
        try await get("/api/notifications/devices")
    }
    func deleteWebPushDevice(id: Int) async throws {
        try await deleteExpectOK("/api/notifications/devices/\(id)")
    }
}
```

- [ ] **Step 3: Verify on macbuild**

Run on `macbuild`: `cd apps/ios && xcodegen generate && xcodebuild build -scheme Rawkoon -destination 'generic/platform=iOS Simulator' CODE_SIGNING_ALLOWED=NO`
Expected: BUILD SUCCEEDED.

- [ ] **Step 4: Commit**

```bash
git add apps/ios/Rawkoon/Models.swift apps/ios/Rawkoon/APIClient+Settings.swift
git commit -m "feat(ios): device DTOs + APNS/web-push list & delete methods"
```

---

## Task 12: iOS — `DevicesView` + SettingsView link

**Files:**
- Create: `apps/ios/Rawkoon/Views/DevicesView.swift`
- Modify: `apps/ios/Rawkoon/Views/SettingsView.swift` — add a "Devices" `NavigationLink` in the Account section; call `await model.refreshAdminIfNeeded()` in `.task`.

**Interfaces:**
- Consumes: `apnsDevices()`, `webPushDevices()`, `deleteApnsDevice(id:)`, `deleteWebPushDevice(id:)` (Task 11); `SettingsStateView` (Task 6); `model.api()`.
- Produces: `struct DevicesView: View` — three sections: **This device** (synthetic, non-deletable), **Other iOS devices** (APNS rows, swipe-delete+confirm), **Web browsers** (web-push rows, delete). Loads both lists independently with `try?` so one failure doesn't blank the other; keeps the synthetic row offline (spec §5 Phase 1).

- [ ] **Step 1: Implement `DevicesView`**

```swift
import SwiftUI

struct DevicesView: View {
    @Environment(AppModel.self) private var model
    @State private var apns: [ApnsDeviceDTO] = []
    @State private var web: [WebPushDeviceDTO] = []
    @State private var loading = true
    @State private var confirmDelete: PendingDelete?

    private struct PendingDelete: Identifiable { let id = UUID(); let kind: Kind; let deviceId: Int; enum Kind { case apns, web } }

    var body: some View {
        Form {
            Section("This device") {
                VStack(alignment: .leading, spacing: 2) {
                    Text(UIDevice.current.name)
                    Text("iOS \(UIDevice.current.systemVersion) · this device")
                        .font(.footnote).foregroundStyle(Theme.muted)
                }.listRowBackground(Theme.raised)
            }
            if !apns.isEmpty {
                Section("Other iOS devices") {
                    ForEach(apns) { d in deviceRow(d.deviceName ?? "iPhone", sub: iosSub(d)) {
                        confirmDelete = .init(kind: .apns, deviceId: d.id)
                    } }
                }
            }
            if !web.isEmpty {
                Section("Web browsers") {
                    ForEach(web) { d in deviceRow(webName(d), sub: "Web push") {
                        confirmDelete = .init(kind: .web, deviceId: d.id)
                    } }
                }
            }
        }
        .scrollContentBackground(.hidden)
        .background(Theme.base)
        .navigationTitle("Devices")
        .navigationBarTitleDisplayMode(.inline)
        .overlay { if loading && apns.isEmpty && web.isEmpty { ProgressView().tint(Theme.apricot) } }
        .task { await load() }
        .refreshable { await load() }
        .confirmationDialog("Remove this device?", isPresented: .constant(confirmDelete != nil), presenting: confirmDelete) { pending in
            Button("Remove", role: .destructive) { Task { await remove(pending) } }
            Button("Cancel", role: .cancel) { confirmDelete = nil }
        } message: { _ in Text("It will stop receiving notifications.") }
    }

    private func deviceRow(_ name: String, sub: String, onDelete: @escaping () -> Void) -> some View {
        HStack {
            VStack(alignment: .leading, spacing: 2) {
                Text(name)
                Text(sub).font(.footnote).foregroundStyle(Theme.muted)
            }
            Spacer()
        }
        .listRowBackground(Theme.raised)
        .swipeActions { Button("Remove", role: .destructive, action: onDelete) }
    }

    private func iosSub(_ d: ApnsDeviceDTO) -> String {
        ["iOS \(d.osVersion ?? "?")", d.appVersion.map { "Rawkoon \($0)" }].compactMap { $0 }.joined(separator: " · ")
    }
    private func webName(_ d: WebPushDeviceDTO) -> String {
        d.deviceName ?? [d.browserName, d.osName].compactMap { $0 }.joined(separator: " · ")
    }

    private func load() async {
        guard let client = model.api() else { loading = false; return }
        apns = (try? await client.apnsDevices())?.devices ?? apns
        web = (try? await client.webPushDevices())?.devices ?? web
        loading = false
    }
    private func remove(_ p: PendingDelete) async {
        confirmDelete = nil
        guard let client = model.api() else { return }
        switch p.kind {
        case .apns: try? await client.deleteApnsDevice(id: p.deviceId)
        case .web: try? await client.deleteWebPushDevice(id: p.deviceId)
        }
        await load()
    }
}
```

- [ ] **Step 2: Wire the link + admin refresh into `SettingsView`**

In the Account `Section`, add `NavigationLink { DevicesView() } label: { Label("Devices", systemImage: "iphone") }`. In the view's existing `.task { … }`, add `await model.refreshAdminIfNeeded()`. Do not disturb existing rows.

- [ ] **Step 3: Verify on macbuild + smoke**

Run on `macbuild`: `swiftformat --lint apps/ios && swiftlint --config apps/ios/.swiftlint.yml && cd apps/ios && xcodegen generate && xcodebuild build -scheme Rawkoon -destination 'generic/platform=iOS Simulator' CODE_SIGNING_ALLOWED=NO`
Expected: lint clean, BUILD SUCCEEDED. Smoke on a simulator/device against a dev server: open Settings → Devices, confirm the list loads and a delete round-trips.

- [ ] **Step 4: Commit**

```bash
git add apps/ios/Rawkoon/Views/DevicesView.swift apps/ios/Rawkoon/Views/SettingsView.swift
git commit -m "feat(ios): Devices roster screen (APNS + web push) with delete"
```

---

## Task 13: Phase 1 gate — full macbuild + web suite

**Files:** none (verification only).

- [ ] **Step 1: Full web checks**

Run (repo root): `bun run typecheck && bun run typecheck:native && bun run lint && bun run test`
Expected: all green.

- [ ] **Step 2: Full iOS gate on macbuild**

Run on `macbuild` (pull first, confirm HEAD matches the pushed commit — stale-git trap): `swiftformat --lint apps/ios && swiftlint --config apps/ios/.swiftlint.yml && cd apps/ios && swift test && xcodegen generate && xcodebuild build -scheme Rawkoon -destination 'generic/platform=iOS Simulator' CODE_SIGNING_ALLOWED=NO`
Expected: format/lint clean, RawkoonKit tests PASS, BUILD SUCCEEDED.

- [ ] **Step 3: Confirm no version bump**

Run: `git diff origin/main -- apps/ios/project.yml | grep -i MARKETING_VERSION || echo "no version change (correct)"`
Expected: "no version change (correct)".

- [ ] **Step 4: Update the board**

Move task #969 note: Phase 1 complete, all gates green, no release. Record the macbuild commit SHA.

---

## Self-Review

**Spec coverage (Phase 1 scope):** RawkoonKit pure logic (Tasks 1–4 ✓ SettingsDirty, SecretBody, SettingsValidation, ConditionRules) · APIClient generics + file split (Task 5 ✓) · reusable components (Task 6 ✓) · `refreshAdminIfNeeded` (Task 7 ✓) · web ApnsDevice type/hooks/UI/locales (Tasks 8–10 ✓) · iOS device DTOs/methods/DevicesView (Tasks 11–12 ✓) · phase gate (Task 13 ✓). Deferred to later phases by design: the full ConditionBuilder editor (Phase 4), all integration/media/books/admin screens (Phases 2–5).

**Placeholder scan:** the two "confirm field names / package dir against source" notes (Tasks 1, 8, 11) are verification instructions, not placeholders — they exist because the wire field names must be copied from the live handler (spec §4.3 drift rule), and the code blocks give the concrete shape to adjust.

**Type consistency:** `ApnsDevice` (web, snake_case) mirrors `ApnsDeviceDTO` (iOS, camelCase via `.convertFromSnakeCase`); `deleteExpectOK` defined once (Task 5), consumed in Task 11; `refreshAdminIfNeeded` defined Task 7, called Task 12; `ConditionRules.operators(for:)` defined Task 4, consumed by the ConditionBuilder shell in Task 6.

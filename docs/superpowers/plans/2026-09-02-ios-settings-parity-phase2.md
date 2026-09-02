# iOS Settings Parity — Phase 2 (Shared Components + Simple Integrations) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans (or subagent-driven-development). Steps use `- [ ]` checkboxes.

**Goal:** Build the shared SwiftUI settings component library (deferred from Phase 1) and the single-object integration forms — General, TMDB, Jellyfin, Local AI, Prowlarr/Jackett, Download client + hook, Audnexus + Google Books — each editable natively against the same endpoints the web uses.

**Architecture:** Native SwiftUI `Form` screens on the existing three layers. Reusable field components in `Views/Settings/`. New APIClient methods in `APIClient+Settings.swift`. Pure validation/body logic in `RawkoonKit` where non-trivial.

**Tech Stack:** Swift 6 / SwiftUI / iOS 18 / Xcode 26. Verification is macbuild only for the app target; RawkoonKit logic via `swift test`.

**Spec:** `docs/superpowers/specs/2026-09-02-ios-settings-full-parity-design.md` — §0 Design Contract (BINDING), §4.4 secrets, §4.7 component signatures, §5 Phase 2 per-screen field lists. This plan implements Phase 2 only.

## Global Constraints

- **Approach A, house style, spec §4.7 components only, same endpoints, no behavior change to existing screens, no release, macbuild gate, English inline strings.** (Design Contract §0 — copied verbatim into every task.)
- **Secrets:** GET DTO carries only a "…is set" bool (or nothing); editable field starts empty; `SecretField` shows a masked placeholder; **omit the secret from the PUT body when empty** (never send null) via a manual `encode(to:)`/`[String:Any]`. Blank + none-stored → server 400, map to an inline field error. (Spec §4.4)
- **DTOs:** `nonisolated … Decodable/Encodable, Sendable`; optional for anything not provably present; `String`-backed for growing enums; decode via `mediaDecoder` except the Download-Client Hook (camelCase → plain-casing helpers).
- **macbuild gate command:** `macbuild:/tmp/rawkoon-macbuild-gate.sh` (checkout branch → `swift test` → `xcodebuild -derivedDataPath /tmp/rawkoon-dd-fresh`). An xcodebuild error whose line content doesn't match the on-disk file is a stale-cache lie — the fresh derivedDataPath is mandatory.

---

## File Structure

**Components (built once, reused by every form):**
- Create `apps/ios/Rawkoon/Views/Settings/SettingsComponents.swift` — `LabeledTextFieldRow`, `SecretFieldRow`, `ToggleRow`, `PickerRow<T>`, `SegmentedRow<T>`, `MultiSelectRow<T>`, `NumberFieldRow`, `TestConnectionButton`.
- Create `apps/ios/Rawkoon/Views/Settings/SettingsFormScaffold.swift` — `SettingsStateView` (loading/error/empty), `SaveButton` toolbar helper.

**Forms (one file each, under `Views/Settings/integrations/`):**
- `GeneralSettingsView.swift`, `TmdbIntegrationView.swift`, `JellyfinIntegrationView.swift`, `LocalAiIntegrationView.swift`, `IndexerManagerIntegrationView.swift`, `DownloadClientEditView.swift`, `DownloadClientHookView.swift`, `BooksProviderView.swift` (Audnexus + Google Books).

**Wiring:**
- Modify `apps/ios/Rawkoon/Views/SettingsView.swift` — admin sub-sections with NavigationLinks; make the existing readonly `IndexersView`/`DownloadClientView` reachable-or-replaced per spec.
- Modify `apps/ios/Rawkoon/APIClient+Settings.swift` — Phase-2 methods.
- Modify `apps/ios/Rawkoon/Models.swift` — Phase-2 DTOs.
- RawkoonKit: extend `SecretBody` usage; add `IntegrationBody` helpers + tests where a body has secret-omission or explicit-null semantics.

---

## Slice A — Component library + General settings

### Task A1: Shared components

**Files:** Create `Views/Settings/SettingsComponents.swift`, `Views/Settings/SettingsFormScaffold.swift`.

**Interfaces (produced):** exactly the spec §4.7 signatures. Implement in the house style (`Theme` tokens, `Form`/`Section`-friendly). Verification is compilation + first use by A2.

- [ ] **Step 1: Implement `SettingsComponents.swift`** — all listed components. Reference implementation for the field rows:

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
                .foregroundStyle(Theme.text)
        }
        .listRowBackground(Theme.raised)
    }
}

struct SecretFieldRow: View {
    let title: String
    @Binding var input: String
    var isStored: Bool = false
    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(title).font(.footnote).foregroundStyle(Theme.muted)
            SecureField(isStored ? "•••••• (stored — leave blank to keep)" : "Required",
                        text: $input)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled(true)
                .foregroundStyle(Theme.text)
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
                Text(title).foregroundStyle(Theme.text)
                if let subtitle { Text(subtitle).font(.footnote).foregroundStyle(Theme.muted) }
            }
        }
        .tint(Theme.apricot)
        .listRowBackground(Theme.raised)
    }
}

struct PickerRow<T: Hashable>: View {
    let title: String
    @Binding var selection: T
    let options: [(value: T, label: String)]
    var body: some View {
        Picker(title, selection: $selection) {
            ForEach(options, id: \.value) { Text($0.label).tag($0.value) }
        }
        .tint(Theme.apricot)
        .listRowBackground(Theme.raised)
    }
}

struct NumberFieldRow: View {
    let title: String
    @Binding var value: Int?
    var range: ClosedRange<Int>? = nil
    var suffix: String? = nil
    @State private var text = ""
    var body: some View {
        HStack {
            Text(title).foregroundStyle(Theme.text)
            Spacer()
            TextField("—", text: $text)
                .keyboardType(.numberPad)
                .multilineTextAlignment(.trailing)
                .frame(maxWidth: 96)
                .foregroundStyle(Theme.text)
                .onChange(of: text) { _, new in
                    if new.isEmpty { value = nil; return }
                    if var n = Int(new.filter(\.isNumber)) {
                        if let range { n = min(max(n, range.lowerBound), range.upperBound) }
                        value = n
                    }
                }
            if let suffix { Text(suffix).foregroundStyle(Theme.muted) }
        }
        .listRowBackground(Theme.raised)
        .onAppear { text = value.map(String.init) ?? "" }
    }
}

struct TestConnectionButton: View {
    var title: String = "Test connection"
    let action: () async -> TestOutcome
    @State private var state: TestState = .idle
    enum TestState: Equatable { case idle, running, ok(String?), failed(String) }
    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Button {
                Task { state = .running; state = await mapped(action()) }
            } label: {
                HStack {
                    if state == .running { ProgressView().tint(Theme.apricot) }
                    Text(title)
                }
            }
            .disabled(state == .running)
            switch state {
            case .ok(let msg): Text(msg ?? "Connected").font(.footnote).foregroundStyle(Theme.apricot)
            case .failed(let msg): Text(msg).font(.footnote).foregroundStyle(Theme.terracotta)
            default: EmptyView()
            }
        }
        .listRowBackground(Theme.raised)
    }
    private func mapped(_ o: TestOutcome) -> TestState {
        switch o { case .success(let m): .ok(m); case .failure(let m): .failed(m) }
    }
}

enum TestOutcome { case success(String?), failure(String) }
```

Implement `SegmentedRow<T>` (a `.pickerStyle(.segmented)` wrapper) and `MultiSelectRow<T>` (a `NavigationLink` pushing a checklist with `minSelection` enforced) to their §4.7 signatures in the same file.

- [ ] **Step 2: Implement `SettingsFormScaffold.swift`**

```swift
import SwiftUI

/// Loading / error / empty state wrapper used by every settings screen.
struct SettingsStateView<Content: View>: View {
    let isLoading: Bool
    let error: String?
    let retry: () -> Void
    @ViewBuilder var content: () -> Content
    var body: some View {
        if isLoading {
            HStack { Spacer(); ProgressView().tint(Theme.apricot); Spacer() }
                .listRowBackground(Theme.raised)
        } else if let error {
            VStack(spacing: 8) {
                Text(error).foregroundStyle(Theme.terracotta)
                Button("Retry", action: retry).tint(Theme.apricot)
            }
            .listRowBackground(Theme.raised)
        } else {
            content()
        }
    }
}
```

- [ ] **Step 3: macbuild gate** — `scp` gate script (already at `/tmp/rawkoon-macbuild-gate.sh`) and run `ssh macbuild 'bash /tmp/rawkoon-macbuild-gate.sh'`. Add a `#Preview` per component so the compiler exercises them even before A2 references them. Expected: `swift test` green + BUILD SUCCEEDED.

- [ ] **Step 4: Commit** `feat(ios): shared settings form components`.

### Task A2: General settings

**Files:** Create `Views/Settings/integrations/GeneralSettingsView.swift`; modify `APIClient+Settings.swift`, `Models.swift`, `SettingsView.swift`.

**Interfaces:**
- Produces DTO `AppSettingsDTO { countryCode: String; upcomingWindowMonths: Int; upcomingLanguages: String; booksEnabled: Bool? }` + `AppSettingsResponseDTO { settings: AppSettingsDTO }`; request `UpdateGeneralSettingsBody { countryCode: String?; upcomingWindowMonths: Int?; upcomingLanguages: String? }` (never sends `booksEnabled` — Books owns it).
- Methods `generalSettings() -> AppSettingsResponseDTO` (GET `/api/settings`), `updateGeneralSettings(_:) async throws` (PATCH `/api/settings`, `patchExpectOK`).

- [ ] **Step 1: DTOs + methods** — add to `Models.swift` and `APIClient+Settings.swift`:

```swift
// Models.swift
nonisolated struct AppSettingsDTO: Decodable, Sendable {
    let countryCode: String
    let upcomingWindowMonths: Int
    let upcomingLanguages: String
    let booksEnabled: Bool?
}
nonisolated struct AppSettingsResponseDTO: Decodable, Sendable { let settings: AppSettingsDTO }
nonisolated struct UpdateGeneralSettingsBody: Encodable, Sendable {
    let countryCode: String?
    let upcomingWindowMonths: Int?
    let upcomingLanguages: String?
}
```
```swift
// APIClient+Settings.swift
func generalSettings() async throws -> AppSettingsResponseDTO { try await get("/api/settings") }
func updateGeneralSettings(_ body: UpdateGeneralSettingsBody) async throws {
    try await patchExpectOK("/api/settings", body: body)
}
```

- [ ] **Step 2: Implement `GeneralSettingsView`** — a `Form` with: country `PickerRow` (ISO-2 list — reuse any existing country source, else a static list), look-ahead `PickerRow` 3/6/12/24 months, languages `MultiSelectRow` (en/fr/de/es/it/pt/ja/ko, **min 1** via `SettingsValidation.hasMinSelection`), a Save button (disabled unless dirty & valid) that calls `updateGeneralSettings` and shows an inline error via `SettingsStateView`. CSV split/join in the view. Load with `.task`; admin-gated (self-guard `if !model.isAdmin { ContentUnavailableView("Admin only", systemImage: "lock") }`).

- [ ] **Step 3: Wire NavigationLink** into a new admin "General" row in `SettingsView`.

- [ ] **Step 4: macbuild gate** — run the gate script; expected green + BUILD SUCCEEDED. Smoke: edit country on a dev server, confirm it round-trips on the web General tab.

- [ ] **Step 5: Commit** `feat(ios): editable General settings`.

---

## Slice B — TMDB, Jellyfin, Local AI

Each is a single-object GET/PUT admin form using the A1 components. Full field lists + endpoints + edge cases are in spec §5 Phase 2 (TMDB / Jellyfin / Local AI). Follow the A2 pattern (DTO + method + view + link + gate).

### Task B1: TMDB — `TmdbIntegrationView.swift`
- Methods `tmdbIntegration()` (GET `/api/integrations/tmdb`), `saveTmdbIntegration(_:)` (PUT). GET DTO has no secret (write-only key, no flag → placeholder "Leave blank to keep existing key"). Fields: Enabled `ToggleRow`, API key `SecretFieldRow`, Popularity threshold `NumberFieldRow` 0–100. Save body **omits `apiKey` when blank** (`SecretBody`/manual encode). No Test button.
- [ ] Steps: DTO+method → view → link → macbuild gate → commit `feat(ios): editable TMDB integration`.

### Task B2: Jellyfin — `JellyfinIntegrationView.swift`
- Methods `jellyfinIntegration()` / `saveJellyfinIntegration(_:)` (GET/PUT `/api/integrations/jellyfin`). Fields: Enabled, Website URL (`LabeledTextFieldRow` `.URL`), API key `SecretFieldRow`. **No test endpoint** — no Test button. Secret omitted when blank.
- [ ] Steps: DTO+method → view → link (replace/augment the existing readonly Jellyfin view if present) → macbuild gate → commit `feat(ios): editable Jellyfin integration`.

### Task B3: Local AI — `LocalAiIntegrationView.swift`
- Methods `localAiIntegration()` / `saveLocalAiIntegration(_:)` (GET/PUT) + `testLocalAi()` (GET `/api/integrations/local-ai/test`). Fields: Enabled, Base URL, Model, `TestConnectionButton`. No secret. Test endpoint returns **404** (disabled/unconfigured) or **502** (unreachable) with `{ error }` — give `testLocalAi()` a bespoke impl that decodes the error body on non-2xx and surfaces it; on success show "Connected — N models" and warn if `modelAvailable == false`.
- [ ] Steps: DTO+methods → view → link → macbuild gate → commit `feat(ios): editable Local AI integration`.

**Slice B gate:** run the macbuild gate once after B1–B3 land (or per task); expected green.

---

## Slice C — Prowlarr/Jackett, Download client + hook, Books provider

### Task C1: Indexer managers — `IndexerManagerIntegrationView.swift`
One view parameterized by `enum IndexerManagerKind { case prowlarr, jackett }`. Methods per kind: `prowlarrIntegration()`/`saveProwlarrIntegration(_:)`/`prowlarrIndexers()` and the Jackett trio (GET/PUT `/api/integrations/{kind}`, GET `.../indexers`). Fields: Enabled, Website URL, API key `SecretFieldRow`, **RSS indexers** `MultiSelectRow` of slugs from `.../indexers`. `.../indexers` returns `[]` until enabled+saved — show "Save and enable to choose RSS indexers", refetch after save. Footnote on enable: "This is now the active indexer manager." Do not disturb the existing readonly `IndexersView` (different endpoint `/api/medias/indexers`).
- [ ] Steps: DTOs+methods → view → two admin links (Prowlarr, Jackett) → macbuild gate → commit `feat(ios): editable Prowlarr/Jackett integrations`.

### Task C2: Download client — make editable + `DownloadClientHookView.swift`
- `DownloadClientEditView`: methods `downloadClient()` (exists) / `saveDownloadClient(_:)` (PUT `/api/integrations/download-client`) / `testDownloadClient()` (POST `.../test`). Fields: Enabled, Client `PickerRow` qBittorrent/Transmission/Deluge (drives username visibility — hide for deluge), Website URL, Username, Password `SecretFieldRow` (placeholder from `passwordSet`), Label (default "rawkoon"), Save path, `TestConnectionButton`. Keep the existing live-speed header. Test returns `{ ok, error? }` at **200 even on failure** — decode and show `error`.
- `DownloadClientHookView`: **camelCase wire** — use `getPlain`/`putPlain`/`postPlainExpectOK`. Methods `downloadClientHook()` / `saveDownloadClientHook(_:)` (GET/PUT `.../hook`) / `rotateDownloadClientHook()` (POST `.../hook/rotate`). Fields: status `StatusBadge` + text, Callback URL (nullable), Auto-configure toggle, Active-hooked seconds `NumberFieldRow` (≥1), Save/Cancel, Rotate secret (destructive confirm "Old callback URLs stop working", refresh whole object from rotate response), copyable scripts (`.textSelection`).
- [ ] Steps: DTOs+methods (mediaEncoder for client, plain for hook) → two views → link → macbuild gate → commit `feat(ios): editable Download client + hook`.

### Task C3: Books provider — `BooksProviderView.swift` (Audnexus + Google Books)
- Audnexus: `audnexusIntegration()` / `updateAudnexusIntegration(_:)` / `testAudnexus()` (GET/PUT/POST `.../audnexus(/test)`). Fields: Enabled, Region `PickerRow` (11 fixed: us/ca/uk/fr/de/es/it/au/br/in/jp), Server URL (no secret), Save, `TestConnectionButton` using typed base_url+region.
- Google Books: `googleBooksIntegration()` / `updateGoogleBooksIntegration(_:)` / `testGoogleBooks()`. API key `SecretFieldRow` (`hasApiKey` → "Key is stored"); Save always sends `enabled: true`, clears field on success; Test sends `apiKey: field.isEmpty ? nil : field`.
- [ ] Steps: DTOs+methods → view → admin "Books provider" link (full Books tab is Phase 3) → macbuild gate → commit `feat(ios): editable Books providers (Audnexus + Google Books)`.

---

## Task Z: Phase 2 gate

- [ ] Full macbuild gate on the final commit: `swift test` + `xcodebuild -derivedDataPath /tmp/rawkoon-dd-fresh` → BUILD SUCCEEDED on the confirmed HEAD sha.
- [ ] Confirm no `MARKETING_VERSION` change: `git diff origin/main -- apps/ios/project.yml | grep -i MARKETING_VERSION || echo ok`.
- [ ] Board note: Phase 2 complete, gates green, macbuild sha recorded.

## Self-Review

- **Spec coverage (Phase 2):** components (A1) · General (A2) · TMDB (B1) · Jellyfin (B2) · Local AI (B3) · Prowlarr/Jackett (C1) · Download client + hook (C2) · Audnexus + Google Books (C3). Matches spec §5 Phase 2 screen list. Media/Books non-provider settings, CRUD editors, and admin/account are later phases.
- **Secret handling** is called out on every form that has one (TMDB, Jellyfin, download-client password, Google Books) — omit-when-empty, never null.
- **Type consistency:** every method returns a named `…DTO`/`…Response` defined in its task; the plain-casing helpers (Phase 1) are used only by the hook (C2).

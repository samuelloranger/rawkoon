import RawkoonKit
import SwiftUI

/// Seeding rules (admin): whether Rawkoon stops seeding torrents on its own, the
/// public/private "ratio X or Y days" targets, and behind Advanced the per-indexer
/// overrides, blocked file extensions and the free-space floor. `GET/PATCH
/// /api/library/post-processing/settings` (seeding key subset), `GET
/// /api/downloads/seeding?preview=1` and `/api/downloads/seed-rules`.
struct SeedingSettingsView: View {
    @Environment(AppModel.self) private var model

    @State private var loading = true
    @State private var loadError: String?
    @State private var saving = false
    @State private var saveError: String?

    @State private var enabled = false
    @State private var publicRatio = ""
    @State private var publicDays = ""
    /// What each days field was prefilled with and the minutes behind it, so an untouched field is
    /// saved exactly as stored instead of being re-read from its rounded text.
    @State private var storedPublicTime = StoredSeedTime(text: "", minutes: nil)
    @State private var storedPrivateTime = StoredSeedTime(text: "", minutes: nil)
    @State private var privateRatio = ""
    @State private var privateDays = ""
    @State private var blockedText = ""
    @State private var minFreeSpaceGb: Int? = 10
    @State private var advancedOpen = false
    @State private var fileOperation = "hardlink"
    @State private var preview: SeedingPreviewDTO?
    @State private var indexers: [IndexerSeedRuleRowDTO] = []

    private struct FormValues: Equatable {
        var enabled: Bool
        var publicRatio: String
        var publicDays: String
        var privateRatio: String
        var privateDays: String
        var blockedExtensions: [String]
        var minFreeSpaceGb: Int?
    }

    @State private var loaded = FormValues(
        enabled: false, publicRatio: "", publicDays: "", privateRatio: "", privateDays: "",
        blockedExtensions: [], minFreeSpaceGb: 10
    )

    private var current: FormValues {
        FormValues(
            enabled: enabled, publicRatio: publicRatio, publicDays: publicDays,
            privateRatio: privateRatio, privateDays: privateDays,
            blockedExtensions: BlockedExtensions.parse(blockedText), minFreeSpaceGb: minFreeSpaceGb
        )
    }

    private struct StoredSeedTime: Equatable {
        let text: String
        let minutes: Int?
    }

    private var publicRule: SeedRule? {
        rule(ratio: publicRatio, days: publicDays, stored: storedPublicTime)
    }

    private var privateRule: SeedRule? {
        rule(ratio: privateRatio, days: privateDays, stored: storedPrivateTime)
    }

    /// A ratio and a day count make one rule; either one being unreadable makes the rule invalid.
    private func rule(ratio: String, days: String, stored: StoredSeedTime) -> SeedRule? {
        let minutes: Int?
        switch SeedTimeDays.resolve(text: days, loadedText: stored.text, loadedMinutes: stored.minutes) {
        case .invalid: return nil
        case .none: minutes = nil
        case let .minutes(value): minutes = value
        }
        return SeedRuleLogic.rule(ratio: SeedRuleLogic.parseRatio(ratio), seedTimeMins: minutes)
    }

    private var isDirty: Bool {
        current != loaded
    }

    private var canSave: Bool {
        isDirty && publicRule != nil && privateRule != nil
    }

    var body: some View {
        Group {
            if !model.isAdmin {
                ContentUnavailableView("Admin only", systemImage: "lock")
                    .rawkoonLivingSymbol(.empty)
            } else {
                form
            }
        }
        .navigationTitle("Seeding")
        .navigationBarTitleDisplayMode(.inline)
    }

    private var form: some View {
        Form {
            SettingsStateView(isLoading: loading, error: loadError, retry: { Task { await load() } }) {
                Section {
                    ToggleRow(
                        "Stop seeding when the target is met",
                        isOn: $enabled,
                        subtitle: "When off, a torrent is only removed on import if it already reached the public ratio."
                    )
                    if let held = preview?.torrents.count {
                        Text("\(held) seeding")
                            .font(.footnote).foregroundStyle(Theme.muted)
                            .listRowBackground(Theme.raised)
                    }
                    if !enabled, let release = preview?.wouldReleaseNow, release.count > 0 {
                        Text("\(release.count) would stop seeding now, \(formattedBytes(release.bytes)).")
                            .font(.footnote).foregroundStyle(Theme.apricot)
                            .listRowBackground(Theme.raised)
                    }
                    if fileOperation == "move" {
                        Text("Imports move files out of the client, so torrents stop seeding on import. Switch to hardlinks to keep seeding.")
                            .font(.footnote).foregroundStyle(Theme.muted)
                            .listRowBackground(Theme.raised)
                    }
                } footer: {
                    Text("After import, Rawkoon keeps each torrent seeding until it reaches its ratio, then removes it from the client. Your library copy is a hardlink, so it stays in place.")
                }

                ratioSection(title: "Public trackers", ratio: $publicRatio, days: $publicDays, rule: publicRule)
                ratioSection(
                    title: "Private trackers", ratio: $privateRatio, days: $privateDays, rule: privateRule,
                    isPrivate: true
                )

                Section {
                    DisclosureGroup("Advanced", isExpanded: $advancedOpen) {
                        advancedRows
                    }
                }
                .listRowBackground(Theme.raised)

                if let saveError {
                    Section { Text(saveError).foregroundStyle(Theme.danger) }
                        .listRowBackground(Theme.raised)
                }
            }
        }
        .scrollContentBackground(.hidden)
        .readableWidth()
        .background(Theme.base)
        .tint(Theme.apricot)
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                if saving {
                    ProgressView().tint(Theme.apricot)
                } else {
                    Button("Save") { Task { await save() } }
                        .disabled(!canSave)
                        .requiresConnection(model.isOffline)
                }
            }
        }
        .task { await load() }
    }

    /// Per-indexer overrides, the files a download may not contain, and the free-space floor.
    @ViewBuilder
    private var advancedRows: some View {
        Text("Indexers").font(.footnote).foregroundStyle(Theme.muted)
        if indexers.isEmpty {
            Text("No indexers found. Connect Prowlarr or Jackett first.")
                .foregroundStyle(Theme.muted)
        }
        ForEach(indexers) { row in
            SeedIndexerRuleRow(row: row) { await reloadRules() }
        }
        Text("An indexer Rawkoon can't reach counts as private, so nothing is removed too early by mistake.")
            .font(.footnote).foregroundStyle(Theme.muted)
        LabeledTextFieldRow(title: "Blocked file extensions", text: $blockedText, placeholder: "exe, scr, bat", mono: true)
        Text("A download containing one of these is rejected and blocklisted.")
            .font(.footnote).foregroundStyle(Theme.muted)
        NumberFieldRow("Keep free (GB)", value: $minFreeSpaceGb, range: 0 ... 100_000)
        Text("Automatic and manual grabs are refused if they would leave less than this free on the download disk. 0 turns the check off.")
            .font(.footnote).foregroundStyle(Theme.muted)
    }

    private func ratioSection(
        title: LocalizedStringKey,
        ratio: Binding<String>,
        days: Binding<String>,
        rule: SeedRule?,
        isPrivate: Bool = false
    ) -> some View {
        Section {
            LabeledTextFieldRow(title: "Ratio", text: ratio, placeholder: "none", keyboard: .decimalPad)
            LabeledTextFieldRow(title: "Days", text: days, placeholder: "none", keyboard: .decimalPad)
            Group {
                if let rule {
                    seedRuleSentence(rule)
                } else {
                    Text("Enter positive numbers, or leave a field empty.").foregroundStyle(Theme.terracotta)
                }
            }
            .font(.footnote).foregroundStyle(Theme.muted)
            .listRowBackground(Theme.raised)
        } header: {
            HStack(spacing: 4) {
                if isPrivate {
                    Image(systemName: "lock.fill").imageScale(.small)
                }
                Text(title)
            }
        }
    }

    private func formattedBytes(_ bytes: Int64) -> String {
        ByteCountFormatter.string(fromByteCount: bytes, countStyle: .file)
    }

    private func load() async {
        guard let client = model.api() else {
            loading = false
            return
        }
        loading = true
        loadError = nil
        do {
            let settings = try await client.postProcessingSettings().settings
            enabled = settings.seedSweepEnabled ?? false
            let minRatio = settings.minSeedRatio ?? 0
            publicRatio = SeedRuleLogic.ratioText(minRatio > 0 ? minRatio : nil)
            publicDays = SeedTimeDays.text(forMinutes: settings.publicSeedTimeMins)
            storedPublicTime = StoredSeedTime(text: publicDays, minutes: settings.publicSeedTimeMins)
            privateRatio = SeedRuleLogic.ratioText(settings.privateSeedRatio)
            privateDays = SeedTimeDays.text(forMinutes: settings.privateSeedTimeMins)
            storedPrivateTime = StoredSeedTime(text: privateDays, minutes: settings.privateSeedTimeMins)
            blockedText = BlockedExtensions.text(settings.blockedExtensions ?? [])
            minFreeSpaceGb = settings.minFreeSpaceGb ?? 10
            fileOperation = settings.fileOperation ?? "hardlink"
            loaded = current
            async let previewCall = client.seedingPreview()
            async let rulesCall = client.seedRules()
            preview = try? await previewCall
            indexers = await (try? rulesCall.indexers) ?? []
        } catch {
            loadError = settingsErrorMessage(error)
        }
        loading = false
    }

    private func reloadRules() async {
        guard let client = model.api() else { return }
        indexers = await (try? client.seedRules().indexers) ?? indexers
        preview = try? await client.seedingPreview()
    }

    private func save() async {
        guard let client = model.api(), let pub = publicRule, let priv = privateRule else { return }
        saving = true
        saveError = nil
        do {
            try await client.updateSeedSettings(
                UpdateSeedSettingsBody(
                    seedSweepEnabled: enabled,
                    // 0 is the existing "no public ratio target".
                    minSeedRatio: pub.ratio ?? 0,
                    publicSeedTimeMins: pub.seedTimeMins,
                    privateSeedRatio: priv.ratio,
                    privateSeedTimeMins: priv.seedTimeMins,
                    blockedExtensions: BlockedExtensions.parse(blockedText),
                    minFreeSpaceGb: minFreeSpaceGb
                )
            )
            loaded = current
            await reloadRules()
        } catch {
            saveError = settingsErrorMessage(error)
        }
        saving = false
    }
}

/// One sentence describing what a rule does, shared by the defaults and the overrides.
@MainActor
func seedRuleSentence(_ rule: SeedRule) -> Text {
    switch SeedRuleLogic.summary(rule) {
    case .releaseOnImport:
        Text("Stops seeding on import. Nothing is seeded.")
    case let .ratio(ratio):
        Text("Stops seeding once ratio \(SeedRuleLogic.formatRatio(ratio)) is reached.")
    case let .time(minutes):
        Text("Stops seeding after \(seedDurationText(minutes)).")
    case let .ratioOrTime(ratio, minutes):
        Text("Stops seeding at ratio \(SeedRuleLogic.formatRatio(ratio)) or after \(seedDurationText(minutes)), whichever comes first.")
    }
}

/// A localized "3 days" / "1.5 hours" for a target time.
func seedDurationText(_ minutes: Int) -> String {
    let formatter = DateComponentsFormatter()
    formatter.unitsStyle = .full
    formatter.maximumUnitCount = 1
    formatter.allowedUnits = SeedRuleLogic.duration(minutes: minutes).isDays ? [.day] : [.hour, .minute]
    return formatter.string(from: TimeInterval(minutes * 60)) ?? "\(minutes) min"
}

import RawkoonKit
import SwiftUI

/// Sharing rules (admin): whether Rawkoon releases torrents on its own, the
/// public/private ratio targets and per-indexer overrides. `GET/PATCH
/// /api/library/post-processing/settings` (sharing key subset), `GET
/// /api/downloads/seeding?preview=1` and `/api/downloads/seed-rules`.
struct SeedingSettingsView: View {
    @Environment(AppModel.self) private var model

    @State private var loading = true
    @State private var loadError: String?
    @State private var saving = false
    @State private var saveError: String?

    @State private var enabled = false
    @State private var publicRatio = ""
    @State private var privateRatio = ""
    @State private var fileOperation = "hardlink"
    @State private var preview: SeedingPreviewDTO?
    @State private var indexers: [IndexerSeedRuleRowDTO] = []

    private struct FormValues: Equatable {
        var enabled: Bool
        var publicRatio: String
        var privateRatio: String
    }

    @State private var loaded = FormValues(enabled: false, publicRatio: "", privateRatio: "")

    private var current: FormValues {
        FormValues(enabled: enabled, publicRatio: publicRatio, privateRatio: privateRatio)
    }

    private var publicRule: SeedRule? {
        SeedRuleLogic.rule(ratio: SeedRuleLogic.parseRatio(publicRatio))
    }

    private var privateRule: SeedRule? {
        SeedRuleLogic.rule(ratio: SeedRuleLogic.parseRatio(privateRatio))
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
            } else {
                form
            }
        }
        .navigationTitle("Sharing")
        .navigationBarTitleDisplayMode(.inline)
    }

    private var form: some View {
        Form {
            SettingsStateView(isLoading: loading, error: loadError, retry: { Task { await load() } }) {
                Section {
                    ToggleRow(
                        "Release torrents automatically",
                        isOn: $enabled,
                        subtitle: "When off, a torrent is only removed on import if it already reached the public ratio."
                    )
                    if let held = preview?.torrents.count {
                        Text("\(held) being shared")
                            .font(.footnote).foregroundStyle(Theme.muted)
                            .listRowBackground(Theme.raised)
                    }
                    if !enabled, let release = preview?.wouldReleaseNow, release.count > 0 {
                        Text("\(release.count) would be released now, \(formattedBytes(release.bytes)).")
                            .font(.footnote).foregroundStyle(Theme.apricot)
                            .listRowBackground(Theme.raised)
                    }
                    if fileOperation == "move" {
                        Text("Imports move files out of the client, so torrents are released on import. Switch to hardlinks to share.")
                            .font(.footnote).foregroundStyle(Theme.muted)
                            .listRowBackground(Theme.raised)
                    }
                } footer: {
                    Text("After import, Rawkoon keeps each torrent sharing until it reaches its ratio, then removes it from the client. Your library copy is a hardlink, so it stays in place.")
                }

                ratioSection(title: "Public trackers", text: $publicRatio, rule: publicRule)
                ratioSection(title: "Private trackers", text: $privateRatio, rule: privateRule, isPrivate: true)

                Section {
                    if indexers.isEmpty {
                        Text("No indexers found. Connect Prowlarr or Jackett first.")
                            .foregroundStyle(Theme.muted).listRowBackground(Theme.raised)
                    }
                    ForEach(indexers) { row in
                        SeedIndexerRuleRow(row: row) { await reloadRules() }
                    }
                } header: {
                    Text("Indexers")
                } footer: {
                    Text("An indexer Rawkoon can't reach counts as private, so nothing is removed too early by mistake.")
                }

                if let saveError {
                    Section { Text(saveError).foregroundStyle(Theme.terracotta) }
                        .listRowBackground(Theme.raised)
                }
            }
        }
        .scrollContentBackground(.hidden)
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

    private func ratioSection(
        title: LocalizedStringKey,
        text: Binding<String>,
        rule: SeedRule?,
        isPrivate: Bool = false
    ) -> some View {
        Section {
            LabeledTextFieldRow(title: "Ratio", text: text, placeholder: "none", keyboard: .decimalPad)
            Group {
                if let rule {
                    seedRuleSentence(rule)
                } else {
                    Text("Enter a positive number, or leave it empty.").foregroundStyle(Theme.terracotta)
                }
            }
            .font(.footnote).foregroundStyle(Theme.muted)
            .listRowBackground(Theme.raised)
        } header: {
            HStack(spacing: 4) {
                if isPrivate { Image(systemName: "lock.fill").imageScale(.small) }
                Text(title)
            }
        }
    }

    private func formattedBytes(_ bytes: Int64) -> String {
        ByteCountFormatter.string(fromByteCount: bytes, countStyle: .file)
    }

    private func load() async {
        guard let client = model.api() else { loading = false; return }
        loading = true; loadError = nil
        do {
            let settings = try await client.postProcessingSettings().settings
            enabled = settings.seedSweepEnabled ?? false
            let minRatio = settings.minSeedRatio ?? 0
            publicRatio = SeedRuleLogic.ratioText(minRatio > 0 ? minRatio : nil)
            privateRatio = SeedRuleLogic.ratioText(settings.privateSeedRatio)
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
        saving = true; saveError = nil
        do {
            try await client.updateSeedSettings(
                UpdateSeedSettingsBody(
                    seedSweepEnabled: enabled,
                    // 0 is the existing "no public ratio target".
                    minSeedRatio: pub.ratio ?? 0,
                    privateSeedRatio: priv.ratio
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
        Text("Released on import. Nothing is shared.")
    case let .ratio(ratio):
        Text("Released once ratio \(SeedRuleLogic.formatRatio(ratio)) is reached.")
    case let .time(minutes):
        Text("Released after \(seedDurationText(minutes)) of sharing.")
    case let .ratioOrTime(ratio, minutes):
        Text("Released at ratio \(SeedRuleLogic.formatRatio(ratio)) or after \(seedDurationText(minutes)) of sharing, whichever comes first.")
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

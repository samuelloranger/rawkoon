import RawkoonKit
import SwiftUI

/// The two indexer managers Rawkoon can search through.
enum IndexerManagerKind: CaseIterable, Hashable {
    case prowlarr, jackett
    var path: String {
        self == .prowlarr ? "prowlarr" : "jackett"
    }

    var title: LocalizedStringKey {
        self == .prowlarr ? "Prowlarr" : "Jackett"
    }

    /// The manager's name as plain text, for sentences.
    var localizedName: LocalizedStringResource {
        self == .prowlarr ? "Prowlarr" : "Jackett"
    }
}

/// Prowlarr / Jackett integration (admin), shown under the switch on the Indexers screen. One view, two kinds. `GET/PUT
/// /api/integrations/{kind}` + `GET .../indexers` for the RSS multiselect (which
/// returns data only once the manager is enabled and saved).
struct IndexerManagerIntegrationView<Extra: View>: View {
    let kind: IndexerManagerKind
    /// Called after a successful save with whether the connection is enabled.
    var onSaved: (Bool) -> Void = { _ in }
    /// More sections the host adds under the manager's own (the list of indexers it serves).
    @ViewBuilder var extraSections: () -> Extra
    @Environment(AppModel.self) private var model

    @State private var loading = true
    @State private var loadError: String?
    @State private var saving = false
    @State private var saveError: String?

    @State private var enabled = false
    @State private var websiteURL = ""
    @State private var apiKeyInput = ""
    @State private var selected: Set<String> = []
    @State private var indexerOptions: [(value: String, label: String)] = []

    private struct FormValues: Equatable {
        var enabled: Bool
        var websiteURL: String
        var selected: Set<String>
    }

    @State private var loaded = FormValues(enabled: false, websiteURL: "", selected: [])

    private var current: FormValues {
        FormValues(enabled: enabled, websiteURL: websiteURL, selected: selected)
    }

    private var isDirty: Bool {
        SettingsDirty.isDirty(loaded: loaded, draft: current, secretEntered: !apiKeyInput.isEmpty)
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
    }

    private var form: some View {
        Form {
            SettingsStateView(isLoading: loading, error: loadError, retry: { Task { await load() } }) {
                Section {
                    ToggleRow("Enabled", isOn: $enabled)
                    LabeledTextFieldRow(title: "Website URL", text: $websiteURL,
                                        placeholder: "http://\(kind.path):9696", keyboard: .URL)
                    SecretFieldRow(title: "API key", input: $apiKeyInput, isStored: true)
                }
                Section {
                    if indexerOptions.isEmpty {
                        Text("Save and enable the connection to choose RSS indexers.")
                            .font(.footnote).foregroundStyle(Theme.muted)
                            .listRowBackground(Theme.raised)
                    } else {
                        MultiSelectRow(title: "RSS indexers", selected: $selected, options: indexerOptions)
                    }
                } header: {
                    Text("RSS indexers")
                }
                extraSections()
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
                    Button("Save") { Task { await save() } }.disabled(!isDirty).requiresConnection(model.isOffline)
                }
            }
        }
        .task { await load() }
    }

    private func load() async {
        guard let client = model.api() else { loading = false; return }
        loading = true; loadError = nil
        do {
            let integration = try await client.indexerManager(kind.path).integration
            enabled = integration.enabled
            websiteURL = integration.websiteUrl ?? ""
            selected = Set(integration.rssIndexers ?? [])
            apiKeyInput = ""
            loaded = current
            await loadIndexerOptions()
        } catch {
            loadError = settingsErrorMessage(error)
        }
        loading = false
    }

    private func loadIndexerOptions() async {
        guard let client = model.api() else { return }
        guard let response = try? await client.indexerManagerIndexers(kind.path) else { return }
        indexerOptions = response.indexers.compactMap { option in
            let value = option.slug ?? option.name
            guard let value, !value.isEmpty else { return nil }
            return (value: value, label: option.name ?? value)
        }
    }

    private func save() async {
        guard let client = model.api() else { return }
        saving = true; saveError = nil
        do {
            try await client.saveIndexerManager(
                kind.path,
                body: SaveIndexerManagerBody(
                    websiteUrl: websiteURL,
                    apiKey: apiKeyInput,
                    enabled: enabled,
                    rssIndexers: selected.sorted()
                )
            )
            apiKeyInput = ""
            loaded = current
            await loadIndexerOptions()
            onSaved(enabled)
        } catch {
            saveError = settingsErrorMessage(error)
        }
        saving = false
    }
}

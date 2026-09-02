import RawkoonKit
import SwiftUI

/// TMDB integration (admin). `GET/PUT /api/integrations/tmdb`. The API never
/// returns the key; an empty `api_key` on save keeps the stored one.
struct TmdbIntegrationView: View {
    @Environment(AppModel.self) private var model

    @State private var loading = true
    @State private var loadError: String?
    @State private var saving = false
    @State private var saveError: String?

    @State private var enabled = false
    @State private var apiKeyInput = ""
    @State private var threshold: Int? = 15

    private struct FormValues: Equatable {
        var enabled: Bool
        var threshold: Int?
    }

    @State private var loaded = FormValues(enabled: false, threshold: 15)

    private var current: FormValues {
        FormValues(enabled: enabled, threshold: threshold)
    }

    private var isDirty: Bool {
        SettingsDirty.isDirty(loaded: loaded, draft: current, secretEntered: !apiKeyInput.isEmpty)
    }

    var body: some View {
        Group {
            if !model.isAdmin {
                ContentUnavailableView("Admin only", systemImage: "lock")
            } else {
                form
            }
        }
        .navigationTitle("TMDB")
        .navigationBarTitleDisplayMode(.inline)
    }

    private var form: some View {
        Form {
            SettingsStateView(isLoading: loading, error: loadError, retry: { Task { await load() } }) {
                Section {
                    ToggleRow("Enabled", isOn: $enabled)
                    SecretFieldRow(title: "API key", input: $apiKeyInput, isStored: true)
                    NumberFieldRow("Popularity threshold", value: $threshold, range: 0 ... 100)
                } footer: {
                    Text("Discovery source for movies and TV. Leave the key blank to keep the stored one.")
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
                    Button("Save") { Task { await save() } }.disabled(!isDirty)
                }
            }
        }
        .task { await load() }
    }

    private func load() async {
        guard let client = model.api() else { loading = false; return }
        loading = true; loadError = nil
        do {
            let integration = try await client.tmdbIntegration().integration
            enabled = integration.enabled
            threshold = integration.popularityThreshold ?? 15
            apiKeyInput = ""
            loaded = current
        } catch {
            loadError = settingsErrorMessage(error)
        }
        loading = false
    }

    private func save() async {
        guard let client = model.api() else { return }
        saving = true; saveError = nil
        do {
            try await client.saveTmdbIntegration(
                SaveTmdbBody(enabled: enabled, apiKey: apiKeyInput, popularityThreshold: threshold ?? 15)
            )
            apiKeyInput = ""
            loaded = current
        } catch {
            saveError = settingsErrorMessage(error)
        }
        saving = false
    }
}

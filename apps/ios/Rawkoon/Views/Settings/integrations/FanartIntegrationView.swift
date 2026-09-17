import RawkoonKit
import SwiftUI

/// fanart.tv integration (admin). `GET/PUT /api/integrations/fanart`. The API
/// never returns the key; an empty `api_key` on save keeps the stored one. The
/// server rejects enabling with no key ever stored.
struct FanartIntegrationView: View {
    @Environment(AppModel.self) private var model

    @State private var loading = true
    @State private var loadError: String?
    @State private var saving = false
    @State private var saveError: String?

    @State private var enabled = false
    @State private var apiKeyInput = ""
    @State private var hasApiKey = false

    private struct FormValues: Equatable {
        var enabled: Bool
    }

    @State private var loaded = FormValues(enabled: false)

    private var current: FormValues {
        FormValues(enabled: enabled)
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
        .navigationTitle("fanart.tv")
        .navigationBarTitleDisplayMode(.inline)
    }

    private var form: some View {
        Form {
            SettingsStateView(isLoading: loading, error: loadError, retry: { Task { await load() } }) {
                Section {
                    ToggleRow("Enabled", isOn: $enabled)
                    SecretFieldRow(title: "API key", input: $apiKeyInput, isStored: hasApiKey)
                } footer: {
                    Text("Higher-quality posters and backdrops. Leave the key blank to keep the stored one.")
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
            let integration = try await client.fanartIntegration().integration
            enabled = integration.enabled
            hasApiKey = integration.apiKeySet ?? false
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
            try await client.saveFanartIntegration(
                SaveFanartBody(enabled: enabled, apiKey: apiKeyInput)
            )
            if !apiKeyInput.isEmpty {
                hasApiKey = true
            }
            apiKeyInput = ""
            loaded = current
        } catch {
            saveError = settingsErrorMessage(error)
        }
        saving = false
    }
}

import RawkoonKit
import SwiftUI

/// Jellyfin integration (admin). `GET/PUT /api/integrations/jellyfin`. No test
/// endpoint. Empty `api_key` on save keeps the stored one.
struct JellyfinIntegrationView: View {
    @Environment(AppModel.self) private var model

    @State private var loading = true
    @State private var loadError: String?
    @State private var saving = false
    @State private var saveError: String?

    @State private var enabled = false
    @State private var websiteURL = ""
    @State private var apiKeyInput = ""

    private struct FormValues: Equatable {
        var enabled: Bool
        var websiteURL: String
    }

    @State private var loaded = FormValues(enabled: false, websiteURL: "")

    private var current: FormValues {
        FormValues(enabled: enabled, websiteURL: websiteURL)
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
        .navigationTitle("Jellyfin")
        .navigationBarTitleDisplayMode(.inline)
    }

    private var form: some View {
        Form {
            SettingsStateView(isLoading: loading, error: loadError, retry: { Task { await load() } }) {
                Section {
                    ToggleRow("Enabled", isOn: $enabled)
                    LabeledTextFieldRow(title: "Website URL", text: $websiteURL,
                                        placeholder: "https://jellyfin.example.com", keyboard: .URL)
                    SecretFieldRow(title: "API key", input: $apiKeyInput, isStored: true)
                } footer: {
                    Text("Media server for library sync. Leave the key blank to keep the stored one.")
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
            let integration = try await client.jellyfinIntegration().integration
            enabled = integration.enabled
            websiteURL = integration.websiteUrl ?? ""
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
            try await client.saveJellyfinIntegration(
                SaveJellyfinBody(enabled: enabled, websiteUrl: websiteURL, apiKey: apiKeyInput)
            )
            apiKeyInput = ""
            loaded = current
        } catch {
            saveError = settingsErrorMessage(error)
        }
        saving = false
    }
}

import RawkoonKit
import SwiftUI

/// Local AI integration (admin). `GET/PUT /api/integrations/local-ai` + a test
/// that reads the *saved* config. No secret.
struct LocalAiIntegrationView: View {
    @Environment(AppModel.self) private var model

    @State private var loading = true
    @State private var loadError: String?
    @State private var saving = false
    @State private var saveError: String?

    @State private var enabled = false
    @State private var baseURL = ""
    @State private var modelName = ""

    private struct FormValues: Equatable {
        var enabled: Bool
        var baseURL: String
        var modelName: String
    }

    @State private var loaded = FormValues(enabled: false, baseURL: "", modelName: "")

    private var current: FormValues {
        FormValues(enabled: enabled, baseURL: baseURL, modelName: modelName)
    }

    private var isDirty: Bool {
        current != loaded
    }

    var body: some View {
        Group {
            if !model.isAdmin {
                ContentUnavailableView("Admin only", systemImage: "lock")
            } else {
                form
            }
        }
        .navigationTitle("Local AI")
        .navigationBarTitleDisplayMode(.inline)
    }

    private var form: some View {
        Form {
            SettingsStateView(isLoading: loading, error: loadError, retry: { Task { await load() } }) {
                Section {
                    ToggleRow("Enabled", isOn: $enabled)
                    LabeledTextFieldRow(title: "Base URL", text: $baseURL,
                                        placeholder: "http://localhost:8080", keyboard: .URL)
                    LabeledTextFieldRow(title: "Model", text: $modelName, placeholder: "model name")
                } footer: {
                    Text("Optional local LLM used for metadata assists.")
                }
                Section {
                    TestConnectionButton {
                        await testConnection()
                    }
                } footer: {
                    Text("Tests the saved configuration.")
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

    private func testConnection() async -> TestOutcome {
        guard let client = model.api() else { return .failure("Not signed in.") }
        do {
            let result = try await client.testLocalAi()
            if let error = result.error {
                return .failure(error)
            }
            let count = result.models?.count ?? 0
            if result.modelAvailable == false {
                return .success("Connected \u{2014} \(count) models (configured model not found)")
            }
            return .success("Connected \u{2014} \(count) models")
        } catch {
            return .failure(settingsErrorMessage(error))
        }
    }

    private func load() async {
        guard let client = model.api() else { loading = false; return }
        loading = true; loadError = nil
        do {
            let integration = try await client.localAiIntegration().integration
            enabled = integration.enabled
            baseURL = integration.baseUrl ?? ""
            modelName = integration.model ?? ""
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
            try await client.saveLocalAiIntegration(
                SaveLocalAiBody(enabled: enabled, baseUrl: baseURL, model: modelName)
            )
            loaded = current
        } catch {
            saveError = settingsErrorMessage(error)
        }
        saving = false
    }
}

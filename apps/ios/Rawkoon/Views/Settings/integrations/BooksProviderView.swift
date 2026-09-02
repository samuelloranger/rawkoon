import RawkoonKit
import SwiftUI

/// Book metadata providers (admin): Audnexus + Google Books. Each saves to its own
/// endpoint. The full Books tab (paths, profiles, sources) is Phase 3.
struct BooksProviderView: View {
    @Environment(AppModel.self) private var model

    @State private var loading = true
    @State private var loadError: String?

    // Audnexus
    @State private var audnexusEnabled = false
    @State private var audnexusRegion = "us"
    @State private var audnexusURL = ""
    @State private var audnexusSaving = false
    @State private var audnexusError: String?

    // Google Books
    @State private var googleHasKey = false
    @State private var googleKeyInput = ""
    @State private var googleSaving = false
    @State private var googleError: String?

    private static let regionOptions: [(value: String, label: String)] = [
        ("us", "United States"), ("ca", "Canada"), ("uk", "United Kingdom"), ("fr", "France"),
        ("de", "Germany"), ("es", "Spain"), ("it", "Italy"), ("au", "Australia"),
        ("br", "Brazil"), ("in", "India"), ("jp", "Japan"),
    ]

    var body: some View {
        Group {
            if !model.isAdmin {
                ContentUnavailableView("Admin only", systemImage: "lock")
            } else {
                form
            }
        }
        .navigationTitle("Book providers")
        .navigationBarTitleDisplayMode(.inline)
    }

    private var form: some View {
        Form {
            SettingsStateView(isLoading: loading, error: loadError, retry: { Task { await load() } }) {
                Section {
                    ToggleRow("Enabled", isOn: $audnexusEnabled)
                    PickerRow(title: "Region", selection: $audnexusRegion, options: Self.regionOptions)
                    LabeledTextFieldRow(title: "Server URL", text: $audnexusURL,
                                        placeholder: "https://api.audnex.us", keyboard: .URL)
                    TestConnectionButton(title: "Test Audnexus") { await testAudnexus() }
                    Button("Save Audnexus") { Task { await saveAudnexus() } }
                        .disabled(audnexusSaving)
                        .listRowBackground(Theme.raised)
                    if let audnexusError {
                        Text(audnexusError).foregroundStyle(Theme.terracotta)
                            .listRowBackground(Theme.raised)
                    }
                } header: {
                    Text("Audnexus")
                }

                Section {
                    SecretFieldRow(title: "API key", input: $googleKeyInput, isStored: googleHasKey)
                    TestConnectionButton(title: "Test Google Books") { await testGoogleBooks() }
                    Button("Save Google Books") { Task { await saveGoogleBooks() } }
                        .disabled(googleSaving)
                        .listRowBackground(Theme.raised)
                    if let googleError {
                        Text(googleError).foregroundStyle(Theme.terracotta)
                            .listRowBackground(Theme.raised)
                    }
                } header: {
                    Text("Google Books")
                } footer: {
                    Text(googleHasKey ? "A key is stored. Leave blank to keep it." : "Add a key to enable Google Books.")
                }
            }
        }
        .scrollContentBackground(.hidden)
        .background(Theme.base)
        .tint(Theme.apricot)
        .task { await load() }
    }

    private func load() async {
        guard let client = model.api() else { loading = false; return }
        loading = true; loadError = nil
        do {
            let audnexus = try await client.audnexusIntegration().integration
            audnexusEnabled = audnexus.enabled
            audnexusRegion = audnexus.region ?? "us"
            audnexusURL = audnexus.baseUrl ?? ""
            let google = try await client.googleBooksIntegration().integration
            googleHasKey = google.hasApiKey ?? false
            googleKeyInput = ""
        } catch {
            loadError = settingsErrorMessage(error)
        }
        loading = false
    }

    private func testAudnexus() async -> TestOutcome {
        guard let client = model.api() else { return .failure("Not signed in.") }
        do {
            let result = try await client.testAudnexus(AudnexusTestBody(baseUrl: audnexusURL, region: audnexusRegion))
            if result.success == true {
                return .success("Connected")
            }
            return .failure(result.error ?? "Could not connect.")
        } catch { return .failure(settingsErrorMessage(error)) }
    }

    private func saveAudnexus() async {
        guard let client = model.api() else { return }
        audnexusSaving = true; audnexusError = nil
        do {
            try await client.updateAudnexusIntegration(
                SaveAudnexusBody(enabled: audnexusEnabled, baseUrl: audnexusURL, region: audnexusRegion)
            )
        } catch { audnexusError = settingsErrorMessage(error) }
        audnexusSaving = false
    }

    private func testGoogleBooks() async -> TestOutcome {
        guard let client = model.api() else { return .failure("Not signed in.") }
        do {
            let body = GoogleBooksTestBody(apiKey: googleKeyInput.isEmpty ? nil : googleKeyInput)
            let result = try await client.testGoogleBooks(body)
            if result.success == true {
                return .success("Connected")
            }
            return .failure(result.error ?? "Could not connect.")
        } catch { return .failure(settingsErrorMessage(error)) }
    }

    private func saveGoogleBooks() async {
        guard let client = model.api() else { return }
        googleSaving = true; googleError = nil
        do {
            try await client.updateGoogleBooksIntegration(
                SaveGoogleBooksBody(apiKey: googleKeyInput.isEmpty ? nil : googleKeyInput, enabled: true)
            )
            googleKeyInput = ""
            googleHasKey = true
        } catch { googleError = settingsErrorMessage(error) }
        googleSaving = false
    }
}

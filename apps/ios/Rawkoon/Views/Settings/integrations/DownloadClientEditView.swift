import RawkoonKit
import SwiftUI

/// Download client integration (admin), editable. `GET/PUT
/// /api/integrations/download-client` + test. Empty password keeps the stored one.
struct DownloadClientEditView: View {
    @Environment(AppModel.self) private var model

    @State private var loading = true
    @State private var loadError: String?
    @State private var saving = false
    @State private var saveError: String?

    @State private var enabled = false
    @State private var clientType = "qbittorrent"
    @State private var websiteURL = ""
    @State private var username = ""
    @State private var passwordInput = ""
    @State private var label = "rawkoon"
    @State private var savePath = ""

    private struct FormValues: Equatable {
        var enabled: Bool
        var clientType: String
        var websiteURL: String
        var username: String
        var label: String
        var savePath: String
    }

    @State private var loaded = FormValues(
        enabled: false, clientType: "qbittorrent", websiteURL: "", username: "", label: "rawkoon", savePath: ""
    )

    private static let clientOptions: [(value: String, label: String)] = [
        ("qbittorrent", "qBittorrent"), ("transmission", "Transmission"), ("deluge", "Deluge"),
    ]

    private var current: FormValues {
        FormValues(enabled: enabled, clientType: clientType, websiteURL: websiteURL,
                   username: username, label: label, savePath: savePath)
    }

    private var isDirty: Bool {
        SettingsDirty.isDirty(loaded: loaded, draft: current, secretEntered: !passwordInput.isEmpty)
    }

    private var body_: SaveDownloadClientBody {
        SaveDownloadClientBody(
            clientType: clientType, websiteUrl: websiteURL, username: username,
            password: passwordInput, label: label, savePath: savePath, enabled: enabled
        )
    }

    var body: some View {
        Group {
            if !model.isAdmin {
                ContentUnavailableView("Admin only", systemImage: "lock")
            } else {
                form
            }
        }
        .navigationTitle("Download client")
        .navigationBarTitleDisplayMode(.inline)
    }

    private var form: some View {
        Form {
            SettingsStateView(isLoading: loading, error: loadError, retry: { Task { await load() } }) {
                Section {
                    ToggleRow("Enabled", isOn: $enabled)
                    PickerRow(title: "Client", selection: $clientType, options: Self.clientOptions)
                    LabeledTextFieldRow(title: "Website URL", text: $websiteURL,
                                        placeholder: "http://localhost:8080", keyboard: .URL)
                    if clientType != "deluge" {
                        LabeledTextFieldRow(title: "Username", text: $username)
                    }
                    SecretFieldRow(title: "Password", input: $passwordInput, isStored: true)
                    LabeledTextFieldRow(title: "Label", text: $label)
                    LabeledTextFieldRow(title: "Save path", text: $savePath, mono: true)
                }
                Section {
                    TestConnectionButton { await testConnection() }
                }
                Section {
                    NavigationLink {
                        DownloadClientHookView()
                    } label: {
                        Label("Completion hook", systemImage: "link")
                    }
                    .listRowBackground(Theme.raised)
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
            let result = try await client.testDownloadClient(body_)
            if result.ok == true {
                return .success("Connected")
            }
            return .failure(result.error ?? "Could not connect.")
        } catch {
            return .failure(settingsErrorMessage(error))
        }
    }

    private func load() async {
        guard let client = model.api() else { loading = false; return }
        loading = true; loadError = nil
        do {
            let config = try await client.downloadClientConfig().integration
            enabled = config.enabled
            clientType = config.clientType ?? "qbittorrent"
            websiteURL = config.websiteUrl ?? ""
            username = config.username ?? ""
            label = config.label ?? "rawkoon"
            savePath = config.savePath ?? ""
            passwordInput = ""
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
            try await client.saveDownloadClient(body_)
            passwordInput = ""
            loaded = current
        } catch {
            saveError = settingsErrorMessage(error)
        }
        saving = false
    }
}

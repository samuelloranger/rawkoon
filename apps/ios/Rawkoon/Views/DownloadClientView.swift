import RawkoonKit
import SwiftUI

/// Admin-only: shows the configured download client integration and live speed.
struct DownloadClientView: View {
    @Environment(AppModel.self) private var model

    @State private var integration: DownloadClientIntegration?
    @State private var speed: SpeedResponse?
    @State private var loading = false
    @State private var errorMessage: String?
    @State private var unauthorized = false

    var body: some View {
        content
            .background(Theme.base)
            .navigationTitle("Download client")
            .navigationBarTitleDisplayMode(.inline)
            .task { await load() }
    }

    @ViewBuilder
    private var content: some View {
        if loading {
            VStack {
                Spacer()
                ProgressView().tint(Theme.apricot)
                Spacer()
            }
        } else if unauthorized {
            ContentUnavailableView(
                "Admin only",
                systemImage: "lock",
                description: Text("Download client settings need an admin account.")
            )
        } else if let errorMessage {
            ContentUnavailableView(
                "Something went wrong",
                systemImage: "exclamationmark.triangle",
                description: Text(errorMessage)
            )
        } else if let integration {
            Form {
                if let speed, speed.connected {
                    Section {
                        speedHeader(speed)
                    }
                    .listRowBackground(Theme.raised)
                }

                Section {
                    HStack {
                        Text("Status")
                            .foregroundStyle(Theme.text)
                        Spacer()
                        StatusBadge(
                            text: integration.enabled ? "Connected" : "Disabled",
                            tint: integration.enabled ? Theme.seed : Theme.muted
                        )
                    }
                } header: {
                    Text("Integration")
                }
                .listRowBackground(Theme.raised)

                Section {
                    if let clientType = integration.clientType, !clientType.isEmpty {
                        detailRow("Client", clientType)
                    }
                    if let label = integration.label, !label.isEmpty {
                        detailRow("Label", label)
                    }
                    if let websiteUrl = integration.websiteUrl, !websiteUrl.isEmpty {
                        detailRow("Website", websiteUrl)
                    }
                    if let username = integration.username, !username.isEmpty {
                        detailRow("Username", username)
                    }
                    if let savePath = integration.savePath, !savePath.isEmpty {
                        detailRow("Save path", savePath)
                    }
                    HStack {
                        Text("Password set")
                            .foregroundStyle(Theme.text)
                        Spacer()
                        Text((integration.passwordSet ?? false) ? "Yes" : "No")
                            .font(.system(.body, design: .monospaced))
                            .foregroundStyle(Theme.muted)
                    }
                } header: {
                    Text("Details")
                }
                .listRowBackground(Theme.raised)
            }
            .scrollContentBackground(.hidden)
            .background(Theme.base)
            .tint(Theme.apricot)
        } else {
            ContentUnavailableView(
                "No download client",
                systemImage: "arrow.down.circle",
                description: Text("No download client is configured yet.")
            )
        }
    }

    private func speedHeader(_ speed: SpeedResponse) -> some View {
        HStack(spacing: 14) {
            Label(Formatters.speed(speed.dlSpeed, useAll: true), systemImage: "arrow.down")
            Label(Formatters.speed(speed.ulSpeed, useAll: true), systemImage: "arrow.up")
            Spacer()
        }
        .font(.system(.caption, design: .monospaced))
        .foregroundStyle(Theme.faint)
    }

    private func detailRow(_ title: String, _ value: String) -> some View {
        HStack(alignment: .top) {
            Text(title)
                .foregroundStyle(Theme.text)
            Spacer(minLength: 12)
            Text(value)
                .font(.system(.body, design: .monospaced))
                .foregroundStyle(Theme.muted)
                .multilineTextAlignment(.trailing)
        }
    }

    private func load() async {
        loading = true
        errorMessage = nil
        unauthorized = false
        defer { loading = false }

        guard let client = model.api() else {
            errorMessage = "Not signed in."
            return
        }

        do {
            let response = try await client.downloadClient()
            integration = response.integration
        } catch APIError.unauthorized {
            unauthorized = true
            return
        } catch let error as APIError {
            errorMessage = message(for: error)
            return
        } catch {
            errorMessage = "Network error. Check your connection."
            return
        }

        // Best-effort: speed header is optional, never blocks the main content.
        speed = try? await client.speed()
    }

    private func message(for error: APIError) -> String {
        switch error {
        case .unauthorized:
            return "Admin only."
        case let .http(status):
            return "Server error (\(status))."
        case .decode:
            return "Could not parse server response."
        case .transport:
            return "Network error. Check your connection."
        }
    }
}

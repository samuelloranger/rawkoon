import SwiftUI

/// Admin-only: lists configured indexers and their enabled/protocol/privacy state.
struct IndexersView: View {
    @Environment(AppModel.self) private var model

    @State private var indexers: [Indexer] = []
    @State private var loading = false
    @State private var errorMessage: String?
    @State private var unauthorized = false

    var body: some View {
        ScrollView {
            content
        }
        .background(Theme.base)
        .navigationTitle("Indexers")
        .navigationBarTitleDisplayMode(.inline)
        .task { await load() }
    }

    @ViewBuilder
    private var content: some View {
        if loading {
            ProgressView().tint(Theme.apricot).padding(.top, 28)
        } else if unauthorized {
            ContentUnavailableView(
                "Admin only",
                systemImage: "lock",
                description: Text("Indexer settings need an admin account.")
            )
            .padding(.top, 28)
        } else if let errorMessage {
            ContentUnavailableView(
                "Something went wrong",
                systemImage: "exclamationmark.triangle",
                description: Text(errorMessage)
            )
            .padding(.top, 28)
        } else if indexers.isEmpty {
            ContentUnavailableView(
                "No indexers",
                systemImage: "server.rack",
                description: Text("No indexers are configured yet.")
            )
            .padding(.top, 28)
        } else {
            LazyVStack(spacing: 10) {
                ForEach(indexers) { indexer in
                    indexerRow(indexer)
                }
            }
            .padding(16)
        }
    }

    private func indexerRow(_ indexer: Indexer) -> some View {
        HStack(alignment: .top, spacing: 10) {
            VStack(alignment: .leading, spacing: 6) {
                Text(indexer.name)
                    .font(.display(16))
                    .foregroundStyle(Theme.textStrong)
                    .lineLimit(2)

                HStack(spacing: 6) {
                    if let protocolType = indexer.protocolType, !protocolType.isEmpty {
                        chip(protocolType)
                    }
                    if let privacy = indexer.privacy, !privacy.isEmpty {
                        chip(privacy)
                    }
                }
            }

            Spacer(minLength: 8)

            StatusBadge(
                text: LocalizedStringKey(indexer.enabled ? "Enabled" : "Disabled"),
                tint: indexer.enabled ? Theme.seed : Theme.muted
            )
        }
        .padding(12)
        .background(Theme.raised, in: RoundedRectangle(cornerRadius: 13))
        .overlay(RoundedRectangle(cornerRadius: 13).strokeBorder(Theme.border, lineWidth: 1))
    }

    private func chip(_ text: String) -> some View {
        Text(text.uppercased())
            .font(.system(.caption2, design: .monospaced))
            .foregroundStyle(Theme.faint)
            .padding(.horizontal, 8)
            .padding(.vertical, 3)
            .background(Theme.inset, in: Capsule())
    }

    private func load() async {
        loading = true
        errorMessage = nil
        unauthorized = false
        defer { loading = false }

        guard let client = model.api() else {
            errorMessage = String(localized: "Not signed in.")
            return
        }

        do {
            let response = try await client.indexers()
            indexers = response.indexers
        } catch APIError.unauthorized {
            unauthorized = true
        } catch let error as APIError {
            errorMessage = message(for: error)
        } catch {
            errorMessage = String(localized: "Network error. Check your connection.")
        }
    }

    private func message(for error: APIError) -> String {
        switch error {
        case .unauthorized:
            String(localized: "Admin only.")
        case let .http(status):
            String(localized: "Server error (\(status)).")
        case .decode:
            String(localized: "Could not parse server response.")
        case .transport:
            String(localized: "Network error. Check your connection.")
        }
    }
}

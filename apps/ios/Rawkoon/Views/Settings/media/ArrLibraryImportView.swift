import SwiftUI

/// Radarr/Sonarr library import (admin). Starts a migration job and follows its
/// progress over the JSON-SSE status stream. `POST /api/library/migrate` +
/// `GET /api/library/migrate/status` (event-stream).
struct ArrLibraryImportView: View {
    @Environment(AppModel.self) private var model

    @State private var source = "both"
    @State private var radarrURL = ""
    @State private var radarrKey = ""
    @State private var sonarrURL = ""
    @State private var sonarrKey = ""

    @State private var starting = false
    @State private var startError: String?
    @State private var status: MigrateStatusDTO?
    @State private var streamTask: Task<Void, Never>?

    private static let sourceOptions: [(value: String, label: String)] = [
        ("both", "Both"), ("radarr", "Radarr"), ("sonarr", "Sonarr"),
    ]

    private var showRadarr: Bool { source == "both" || source == "radarr" }
    private var showSonarr: Bool { source == "both" || source == "sonarr" }

    private var isRunning: Bool {
        guard let state = status?.state else { return false }
        return state == "active" || state == "waiting" || state == "delayed"
    }

    var body: some View {
        Group {
            if !model.isAdmin {
                ContentUnavailableView("Admin only", systemImage: "lock")
            } else {
                form
            }
        }
        .navigationTitle("Import")
        .navigationBarTitleDisplayMode(.inline)
        .task { await followStatus() }
        .onDisappear { streamTask?.cancel() }
    }

    private var form: some View {
        Form {
            Section {
                SegmentedRow(title: "Source", selection: $source, options: Self.sourceOptions)
            }
            if showRadarr {
                Section {
                    LabeledTextFieldRow(title: "Radarr URL", text: $radarrURL, keyboard: .URL)
                    SecretFieldRow(title: "Radarr API key", input: $radarrKey)
                } header: { Text("Radarr") }
            }
            if showSonarr {
                Section {
                    LabeledTextFieldRow(title: "Sonarr URL", text: $sonarrURL, keyboard: .URL)
                    SecretFieldRow(title: "Sonarr API key", input: $sonarrKey)
                } header: { Text("Sonarr") }
            }
            Section {
                Button("Start import") { Task { await start() } }
                    .disabled(starting || isRunning)
                    .listRowBackground(Theme.raised)
                if let startError {
                    Text(startError).foregroundStyle(Theme.terracotta).listRowBackground(Theme.raised)
                }
                if let status, let state = status.state, state != "unknown" {
                    Text(statusLine(status)).font(.footnote).foregroundStyle(Theme.muted)
                        .listRowBackground(Theme.raised)
                }
            } header: {
                Text("Progress")
            }
        }
        .scrollContentBackground(.hidden)
        .background(Theme.base)
        .tint(Theme.apricot)
    }

    private func statusLine(_ status: MigrateStatusDTO) -> String {
        let state = status.state ?? "?"
        if let progress = status.progress, let total = progress.total, total > 0 {
            let imported = progress.imported ?? 0
            return "\(state) \u{2022} \(progress.current ?? 0)/\(total) \u{2022} \(imported) imported"
        }
        if let error = status.error { return "failed \u{2022} \(error)" }
        return state
    }

    private func start() async {
        guard let client = model.api() else { return }
        starting = true; startError = nil
        do {
            _ = try await client.startLibraryMigrate(
                MigrateBody(
                    source: source,
                    radarrUrl: showRadarr ? nilIfEmpty(radarrURL) : nil,
                    radarrApiKey: showRadarr ? nilIfEmpty(radarrKey) : nil,
                    sonarrUrl: showSonarr ? nilIfEmpty(sonarrURL) : nil,
                    sonarrApiKey: showSonarr ? nilIfEmpty(sonarrKey) : nil
                )
            )
        } catch {
            startError = settingsErrorMessage(error)
        }
        starting = false
    }

    private func followStatus() async {
        streamTask?.cancel()
        guard let client = model.api() else { return }
        streamTask = Task {
            let stream = await client.libraryMigrateStatusStream()
            do {
                for try await update in stream {
                    if Task.isCancelled { break }
                    status = update
                }
            } catch {
                // Stream ended or failed; keep the last status.
            }
        }
    }

    private func nilIfEmpty(_ value: String) -> String? {
        let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmed.isEmpty ? nil : trimmed
    }
}

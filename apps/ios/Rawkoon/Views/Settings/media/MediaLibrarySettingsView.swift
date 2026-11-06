import SwiftUI

/// Folders & import (admin): post-processing paths, with naming templates behind Advanced, plus
/// a scan card and a language-reindex card. `GET/PATCH
/// /api/library/post-processing/settings` (media key subset only).
struct MediaLibrarySettingsView: View {
    @Environment(AppModel.self) private var model

    @State private var loading = true
    @State private var loadError: String?
    @State private var saving = false
    @State private var saveError: String?

    @State private var ppEnabled = false
    @State private var moviesPath = ""
    @State private var showsPath = ""
    @State private var downloadsPath = ""
    @State private var fileOperation = "hardlink"
    @State private var movieTemplate = ""
    @State private var episodeTemplate = ""

    @State private var scanPath = ""
    @State private var scanType = "movie"
    @State private var scanning = false
    @State private var scanResult: ScanResultDTO?
    @State private var scanError: String?

    @State private var reindexStatus: ReindexStatusDTO?
    @State private var reindexTask: Task<Void, Never>?

    private struct FormValues: Equatable {
        var ppEnabled: Bool
        var moviesPath: String
        var showsPath: String
        var downloadsPath: String
        var fileOperation: String
        var movieTemplate: String
        var episodeTemplate: String
    }

    @State private var loaded = FormValues(
        ppEnabled: false, moviesPath: "", showsPath: "", downloadsPath: "",
        fileOperation: "hardlink", movieTemplate: "", episodeTemplate: ""
    )

    private var current: FormValues {
        FormValues(ppEnabled: ppEnabled, moviesPath: moviesPath, showsPath: showsPath,
                   downloadsPath: downloadsPath, fileOperation: fileOperation, movieTemplate: movieTemplate,
                   episodeTemplate: episodeTemplate)
    }

    private var isDirty: Bool {
        current != loaded
    }

    private static let fileOpOptions: [(value: String, label: LocalizedStringKey)] = [
        ("hardlink", "Hardlink"), ("move", "Move"),
    ]
    private static let scanTypeOptions: [(value: String, label: LocalizedStringKey)] = [
        ("movie", "Movie"), ("show", "Show"),
    ]

    var body: some View {
        Group {
            if !model.isAdmin {
                ContentUnavailableView("Admin only", systemImage: "lock")
                    .rawkoonLivingSymbol(.empty)
            } else {
                form
            }
        }
        .navigationTitle("Folders & import")
        .navigationBarTitleDisplayMode(.inline)
        .onDisappear { reindexTask?.cancel() }
    }

    private var form: some View {
        Form {
            SettingsStateView(isLoading: loading, error: loadError, retry: { Task { await load() } }) {
                Section {
                    ToggleRow("Post-processing enabled", isOn: $ppEnabled)
                } footer: {
                    Text("Import completed downloads into the library.")
                }
                Section {
                    LabeledTextFieldRow(title: "Movies path", text: $moviesPath, keyboard: .URL, mono: true)
                    LabeledTextFieldRow(title: "Shows path", text: $showsPath, keyboard: .URL, mono: true)
                    LabeledTextFieldRow(title: "Downloads path", text: $downloadsPath, keyboard: .URL, mono: true)
                } header: { Text("Paths") }
                Section {
                    DisclosureGroup("Advanced") {
                        PickerRow(title: "File operation", selection: $fileOperation, options: Self.fileOpOptions)
                        LabeledTextFieldRow(title: "Movie template", text: $movieTemplate, mono: true)
                        LabeledTextFieldRow(title: "Episode template", text: $episodeTemplate, mono: true)
                    }
                } footer: {
                    Text("How imported files are placed and named.")
                }
                .listRowBackground(Theme.raised)

                Section {
                    LabeledTextFieldRow(title: "Scan path", text: $scanPath, keyboard: .URL, mono: true)
                    PickerRow(title: "Type", selection: $scanType, options: Self.scanTypeOptions)
                    Button("Run scan") { Task { await runScan() } }
                        .disabled(scanning || scanPath.isEmpty)
                        .requiresConnection(model.isOffline)
                        .listRowBackground(Theme.raised)
                    if scanning {
                        ProgressView().tint(Theme.apricot).listRowBackground(Theme.raised)
                    }
                    if let scanResult {
                        Text("Matched \(scanResult.matched) \u{2022} \(scanResult.unmatched.count) unmatched")
                            .font(.footnote).foregroundStyle(Theme.muted)
                            .listRowBackground(Theme.raised)
                    }
                    if let scanError {
                        Text(scanError).foregroundStyle(Theme.danger).listRowBackground(Theme.raised)
                    }
                } header: { Text("Scan") }

                Section {
                    AsyncButton("Reindex languages", action: startReindex)
                        .disabled(reindexActive)
                        .requiresConnection(model.isOffline)
                        .listRowBackground(Theme.raised)
                    if let status = reindexStatus, let state = status.state, state != "unknown" {
                        Text(reindexStatusLine(status)).font(.footnote).foregroundStyle(Theme.muted)
                            .listRowBackground(Theme.raised)
                    }
                } header: { Text("Language reindex") }

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
        .task {
            await load()
            await refreshReindex()
        }
    }

    private var reindexActive: Bool {
        guard let state = reindexStatus?.state else { return false }
        return state == "active" || state == "waiting" || state == "delayed"
    }

    private func reindexStatusLine(_ status: ReindexStatusDTO) -> String {
        let state = status.state ?? "?"
        if let progress = status.progress, let total = progress.total, total > 0 {
            return "\(state) \u{2022} \(progress.current ?? 0)/\(total)"
        }
        return state
    }

    private func load() async {
        guard let client = model.api() else { loading = false; return }
        loading = true; loadError = nil
        do {
            let settings = try await client.postProcessingSettings().settings
            ppEnabled = settings.postProcessingEnabled ?? false
            moviesPath = settings.moviesLibraryPath ?? ""
            showsPath = settings.showsLibraryPath ?? ""
            downloadsPath = settings.downloadsPath ?? ""
            fileOperation = settings.fileOperation ?? "hardlink"
            movieTemplate = settings.movieTemplate ?? ""
            episodeTemplate = settings.episodeTemplate ?? ""
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
            try await client.updateMediaSettings(
                UpdateMediaSettingsBody(
                    postProcessingEnabled: ppEnabled,
                    moviesLibraryPath: nilIfEmpty(moviesPath),
                    showsLibraryPath: nilIfEmpty(showsPath),
                    downloadsPath: nilIfEmpty(downloadsPath),
                    fileOperation: fileOperation,
                    movieTemplate: movieTemplate,
                    episodeTemplate: episodeTemplate,
                    activeIndexerManager: nil,
                    defaultMovieQualityProfileId: nil,
                    defaultShowQualityProfileId: nil,
                    minFreeSpaceGb: nil
                )
            )
            loaded = current
        } catch {
            saveError = settingsErrorMessage(error)
        }
        saving = false
    }

    private func runScan() async {
        guard let client = model.api() else { return }
        scanning = true; scanError = nil; scanResult = nil
        do {
            scanResult = try await client.scanLibrary(path: scanPath, type: scanType)
        } catch {
            scanError = settingsErrorMessage(error)
        }
        scanning = false
    }

    private func startReindex() async {
        guard let client = model.api() else { return }
        do {
            _ = try await client.startReindexLanguages()
            await pollReindex()
        } catch {
            model.toast(String(localized: "Couldn't start reindex."), style: .error)
        }
    }

    private func refreshReindex() async {
        guard let client = model.api() else { return }
        reindexStatus = try? await client.reindexLanguagesStatus()
        if reindexActive {
            await pollReindex()
        }
    }

    private func pollReindex() async {
        reindexTask?.cancel()
        reindexTask = Task {
            guard let client = model.api() else { return }
            while !Task.isCancelled {
                reindexStatus = try? await client.reindexLanguagesStatus()
                if !reindexActive {
                    break
                }
                try? await Task.sleep(for: .seconds(3))
            }
        }
    }

    private func nilIfEmpty(_ value: String) -> String? {
        let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmed.isEmpty ? nil : trimmed
    }
}

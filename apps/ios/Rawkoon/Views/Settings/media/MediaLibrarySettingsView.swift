import SwiftUI

/// Media library settings (admin): post-processing paths/templates/options, plus
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
    @State private var minSeedRatioText = "0"
    @State private var activeManager: String? = nil
    @State private var defaultMovieProfile: Int? = nil
    @State private var defaultShowProfile: Int? = nil
    @State private var profiles: [QualityProfile] = []

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
        var minSeedRatioText: String
        var activeManager: String?
        var defaultMovieProfile: Int?
        var defaultShowProfile: Int?
    }

    @State private var loaded = FormValues(
        ppEnabled: false, moviesPath: "", showsPath: "", downloadsPath: "",
        fileOperation: "hardlink", movieTemplate: "", episodeTemplate: "",
        minSeedRatioText: "0", activeManager: nil, defaultMovieProfile: nil, defaultShowProfile: nil
    )

    private var current: FormValues {
        FormValues(ppEnabled: ppEnabled, moviesPath: moviesPath, showsPath: showsPath,
                   downloadsPath: downloadsPath, fileOperation: fileOperation, movieTemplate: movieTemplate,
                   episodeTemplate: episodeTemplate, minSeedRatioText: minSeedRatioText,
                   activeManager: activeManager, defaultMovieProfile: defaultMovieProfile,
                   defaultShowProfile: defaultShowProfile)
    }

    private var isDirty: Bool {
        current != loaded
    }

    private var profileOptions: [(value: Int?, label: String)] {
        [(nil, "None")] + profiles.map { (Optional($0.id), $0.name) }
    }

    private static let fileOpOptions: [(value: String, label: LocalizedStringKey)] = [
        ("hardlink", "Hardlink"), ("move", "Move"),
    ]
    private var managerOptions: [(value: String?, label: LocalizedStringKey)] {
        [(nil, "None"), ("prowlarr", "Prowlarr"), ("jackett", "Jackett")]
    }

    private static let scanTypeOptions: [(value: String, label: LocalizedStringKey)] = [
        ("movie", "Movie"), ("show", "Show"),
    ]

    var body: some View {
        Group {
            if !model.isAdmin {
                ContentUnavailableView("Admin only", systemImage: "lock")
            } else {
                form
            }
        }
        .navigationTitle("Library")
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
                    PickerRow(title: "File operation", selection: $fileOperation, options: Self.fileOpOptions)
                    LabeledTextFieldRow(title: "Movie template", text: $movieTemplate, mono: true)
                    LabeledTextFieldRow(title: "Episode template", text: $episodeTemplate, mono: true)
                    LabeledTextFieldRow(title: "Min seed ratio", text: $minSeedRatioText, keyboard: .decimalPad)
                    PickerRow(title: "Active indexer manager", selection: $activeManager, options: managerOptions)
                    PickerRow(title: "Default movie profile", selection: $defaultMovieProfile, options: profileOptions)
                    PickerRow(title: "Default show profile", selection: $defaultShowProfile, options: profileOptions)
                } header: { Text("Import") }

                Section {
                    LabeledTextFieldRow(title: "Scan path", text: $scanPath, keyboard: .URL, mono: true)
                    PickerRow(title: "Type", selection: $scanType, options: Self.scanTypeOptions)
                    Button("Run scan") { Task { await runScan() } }
                        .disabled(scanning || scanPath.isEmpty)
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
                        Text(scanError).foregroundStyle(Theme.terracotta).listRowBackground(Theme.raised)
                    }
                } header: { Text("Scan") }

                Section {
                    AsyncButton("Reindex languages", action: startReindex)
                        .disabled(reindexActive)
                        .listRowBackground(Theme.raised)
                    if let status = reindexStatus, let state = status.state, state != "unknown" {
                        Text(reindexStatusLine(status)).font(.footnote).foregroundStyle(Theme.muted)
                            .listRowBackground(Theme.raised)
                    }
                } header: { Text("Language reindex") }

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
            async let settingsCall = client.postProcessingSettings()
            async let profilesCall = client.qualityProfiles()
            let settings = try await settingsCall.settings
            profiles = await (try? profilesCall.profiles) ?? []
            ppEnabled = settings.postProcessingEnabled ?? false
            moviesPath = settings.moviesLibraryPath ?? ""
            showsPath = settings.showsLibraryPath ?? ""
            downloadsPath = settings.downloadsPath ?? ""
            fileOperation = settings.fileOperation ?? "hardlink"
            movieTemplate = settings.movieTemplate ?? ""
            episodeTemplate = settings.episodeTemplate ?? ""
            minSeedRatioText = String(settings.minSeedRatio ?? 0)
            activeManager = settings.activeIndexerManager
            defaultMovieProfile = settings.defaultMovieQualityProfileId
            defaultShowProfile = settings.defaultShowQualityProfileId
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
                    minSeedRatio: Double(minSeedRatioText) ?? 0,
                    activeIndexerManager: activeManager,
                    defaultMovieQualityProfileId: defaultMovieProfile,
                    defaultShowQualityProfileId: defaultShowProfile
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

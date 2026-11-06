import SwiftUI

/// Defaults (admin): the quality profile a new movie, show or book starts with.
/// `GET/PATCH /api/library/post-processing/settings` (default profile keys only).
struct LibraryDefaultsView: View {
    @Environment(AppModel.self) private var model

    @State private var loading = true
    @State private var loadError: String?
    @State private var saving = false
    @State private var saveError: String?

    @State private var movieProfile: Int?
    @State private var showProfile: Int?
    @State private var bookProfile: Int?
    @State private var loaded = Picks(movie: nil, show: nil, book: nil)
    @State private var mediaProfiles: [QualityProfile] = []
    @State private var bookProfiles: [BookQualityProfile] = []

    private struct Picks: Equatable {
        var movie: Int?
        var show: Int?
        var book: Int?
    }

    private var current: Picks {
        Picks(movie: movieProfile, show: showProfile, book: bookProfile)
    }

    private var mediaOptions: [(value: Int?, label: String)] {
        [(nil, String(localized: "None"))] + mediaProfiles.map { (Optional($0.id), $0.name) }
    }

    private var bookOptions: [(value: Int?, label: String)] {
        [(nil, String(localized: "None"))] + bookProfiles.map { (Optional($0.id), $0.name) }
    }

    var body: some View {
        Group {
            if model.isAdmin {
                form
            } else {
                ContentUnavailableView("Admin only", systemImage: "lock")
                    .rawkoonLivingSymbol(.empty)
            }
        }
        .navigationTitle("Defaults")
        .navigationBarTitleDisplayMode(.inline)
    }

    private var form: some View {
        Form {
            SettingsStateView(isLoading: loading, error: loadError, retry: { Task { await load() } }) {
                Section {
                    PickerRow(title: "Default movie profile", selection: $movieProfile, options: mediaOptions)
                    PickerRow(title: "Default show profile", selection: $showProfile, options: mediaOptions)
                    if model.booksEnabled {
                        PickerRow(title: "Default book profile", selection: $bookProfile, options: bookOptions)
                    }
                } footer: {
                    Text("A new title uses its default profile unless you pick another when adding it. Without one, a new title accepts any release.")
                }
                if let saveError {
                    Section { Text(saveError).foregroundStyle(Theme.danger) }
                        .listRowBackground(Theme.raised)
                }
            }
        }
        .settingsScreenStyle()
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                if saving {
                    ProgressView().tint(Theme.apricot)
                } else {
                    Button("Save") { Task { await save() } }
                        .disabled(current == loaded)
                        .requiresConnection(model.isOffline)
                }
            }
        }
        .task { await load() }
    }

    private func load() async {
        guard let client = model.api() else {
            loading = false
            return
        }
        loading = true
        loadError = nil
        do {
            let settings = try await client.postProcessingSettings().settings
            mediaProfiles = await (try? client.qualityProfiles().profiles) ?? []
            if model.booksEnabled {
                bookProfiles = await (try? client.bookQualityProfiles().profiles) ?? []
            }
            movieProfile = settings.defaultMovieQualityProfileId
            showProfile = settings.defaultShowQualityProfileId
            bookProfile = settings.defaultBookQualityProfileId
            loaded = current
        } catch {
            loadError = settingsErrorMessage(error)
        }
        loading = false
    }

    private func save() async {
        guard let client = model.api() else { return }
        saving = true
        saveError = nil
        do {
            try await client.updateDefaultProfiles(
                UpdateDefaultProfilesBody(
                    defaultMovieQualityProfileId: movieProfile,
                    defaultShowQualityProfileId: showProfile,
                    // Hidden with books off: keep what is stored instead of clearing it.
                    defaultBookQualityProfileId: model.booksEnabled ? bookProfile : loaded.book
                )
            )
            loaded = current
        } catch {
            saveError = settingsErrorMessage(error)
        }
        saving = false
    }
}

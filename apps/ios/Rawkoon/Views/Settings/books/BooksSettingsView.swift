import SwiftUI

/// Books settings (admin), non-CRUD: enable the feature, order metadata sources,
/// and set book file paths / templates / Audiobookshelf. Book quality-profile
/// CRUD is Phase 4 (only the read is used here for the default picker).
struct BooksSettingsView: View {
    @Environment(AppModel.self) private var model

    @State private var loading = true
    @State private var loadError: String?

    @State private var booksEnabled = false
    @State private var togglingEnabled = false

    @State private var order: [String] = []
    @State private var savingOrder = false
    @State private var orderError: String?

    @State private var booksPath = ""
    @State private var audiobooksPath = ""
    @State private var bookTemplate = ""
    @State private var audiobookTemplate = ""
    @State private var defaultBookProfile: Int? = nil
    @State private var absURL = ""
    @State private var absAudiobookLib = ""
    @State private var absEbookLib = ""
    @State private var savingFiles = false
    @State private var filesError: String?

    @State private var profiles: [BookQualityProfile] = []

    private static let allSources: [(id: String, label: String)] = [
        ("local", "On this server"), ("audnexus", "Audnexus"),
        ("googlebooks", "Google Books"), ("openlibrary", "Open Library"),
    ]

    private func label(for source: String) -> String {
        Self.allSources.first { $0.id == source }?.label ?? source
    }

    private var disabledSources: [String] {
        Self.allSources.map(\.id).filter { !order.contains($0) }
    }

    private var profileOptions: [(value: Int?, label: String)] {
        [(nil, "None")] + profiles.map { (Optional($0.id), $0.name) }
    }

    var body: some View {
        Group {
            if !model.isAdmin {
                ContentUnavailableView("Admin only", systemImage: "lock")
            } else {
                form
            }
        }
        .navigationTitle("Books")
        .navigationBarTitleDisplayMode(.inline)
    }

    private var form: some View {
        Form {
            SettingsStateView(isLoading: loading, error: loadError, retry: { Task { await load() } }) {
                Section {
                    Toggle(isOn: Binding(get: { booksEnabled }, set: { setBooksEnabled($0) })) {
                        Text("Books enabled").foregroundStyle(Theme.text)
                    }
                    .tint(Theme.apricot)
                    .disabled(togglingEnabled)
                    .listRowBackground(Theme.raised)
                } header: { Text("General") }

                metadataSection
                filesSection
            }
        }
        .scrollContentBackground(.hidden)
        .background(Theme.base)
        .tint(Theme.apricot)
        .task { await load() }
    }

    private var metadataSection: some View {
        Section {
            ForEach(Array(order.enumerated()), id: \.element) { index, source in
                HStack {
                    Text(label(for: source)).foregroundStyle(Theme.text)
                    Spacer()
                    Button { move(index, by: -1) } label: { Image(systemName: "chevron.up") }
                        .disabled(index == 0).buttonStyle(.borderless)
                    Button { move(index, by: 1) } label: { Image(systemName: "chevron.down") }
                        .disabled(index == order.count - 1).buttonStyle(.borderless)
                }
                .listRowBackground(Theme.raised)
                .swipeActions {
                    Button("Disable", role: .destructive) { order.removeAll { $0 == source } }
                }
            }
            ForEach(disabledSources, id: \.self) { source in
                Button { order.append(source) } label: {
                    HStack {
                        Text(label(for: source)).foregroundStyle(Theme.muted)
                        Spacer()
                        Image(systemName: "plus.circle").foregroundStyle(Theme.apricot)
                    }
                }
                .listRowBackground(Theme.raised)
            }
            Button("Save order") { Task { await saveOrder() } }
                .disabled(savingOrder)
                .listRowBackground(Theme.raised)
            if let orderError {
                Text(orderError).foregroundStyle(Theme.terracotta).listRowBackground(Theme.raised)
            }
        } header: {
            Text("Metadata sources")
        } footer: {
            Text("Enabled sources, in priority order. Swipe to disable.")
        }
    }

    private var filesSection: some View {
        Section {
            LabeledTextFieldRow(title: "Books path", text: $booksPath, keyboard: .URL, mono: true)
            LabeledTextFieldRow(title: "Audiobooks path", text: $audiobooksPath, keyboard: .URL, mono: true)
            LabeledTextFieldRow(title: "Book template", text: $bookTemplate, mono: true)
            LabeledTextFieldRow(title: "Audiobook template", text: $audiobookTemplate, mono: true)
            PickerRow(title: "Default book profile", selection: $defaultBookProfile, options: profileOptions)
            LabeledTextFieldRow(title: "Audiobookshelf URL", text: $absURL, keyboard: .URL)
            LabeledTextFieldRow(title: "ABS audiobook library ID", text: $absAudiobookLib)
            LabeledTextFieldRow(title: "ABS ebook library ID", text: $absEbookLib)
            Button("Save files") { Task { await saveFiles() } }
                .disabled(savingFiles)
                .listRowBackground(Theme.raised)
            if let filesError {
                Text(filesError).foregroundStyle(Theme.terracotta).listRowBackground(Theme.raised)
            }
        } header: {
            Text("Files & Audiobookshelf")
        }
    }

    private func move(_ index: Int, by offset: Int) {
        let target = index + offset
        guard order.indices.contains(index), order.indices.contains(target) else { return }
        order.swapAt(index, target)
    }

    private func setBooksEnabled(_ value: Bool) {
        let previous = booksEnabled
        booksEnabled = value
        Task {
            togglingEnabled = true
            do { try await model.api()?.updateBooksEnabled(value) }
            catch { booksEnabled = previous }
            togglingEnabled = false
        }
    }

    private func load() async {
        guard let client = model.api() else { loading = false; return }
        loading = true; loadError = nil
        do {
            let settings = try await client.postProcessingSettings().settings
            let sources = try await client.bookMetadataSources().order
            let general = try await client.generalSettings().settings
            profiles = (try? await client.bookQualityProfiles().profiles) ?? []
            booksEnabled = general.booksEnabled ?? false
            order = sources
            booksPath = settings.booksLibraryPath ?? ""
            audiobooksPath = settings.audiobooksLibraryPath ?? ""
            bookTemplate = settings.bookTemplate ?? ""
            audiobookTemplate = settings.audiobookTemplate ?? ""
            defaultBookProfile = settings.defaultBookQualityProfileId
            absURL = settings.audiobookshelfUrl ?? ""
            absAudiobookLib = settings.audiobookshelfAudiobookLibraryId ?? ""
            absEbookLib = settings.audiobookshelfEbookLibraryId ?? ""
        } catch {
            loadError = settingsErrorMessage(error)
        }
        loading = false
    }

    private func saveOrder() async {
        guard let client = model.api() else { return }
        savingOrder = true; orderError = nil
        do { try await client.updateBookMetadataSources(order: order) }
        catch { orderError = settingsErrorMessage(error) }
        savingOrder = false
    }

    private func saveFiles() async {
        guard let client = model.api() else { return }
        savingFiles = true; filesError = nil
        do {
            try await client.updateBookFiles(
                UpdateBookFilesBody(
                    booksLibraryPath: nilIfEmpty(booksPath),
                    audiobooksLibraryPath: nilIfEmpty(audiobooksPath),
                    bookTemplate: bookTemplate,
                    audiobookTemplate: audiobookTemplate,
                    defaultBookQualityProfileId: defaultBookProfile,
                    audiobookshelfUrl: nilIfEmpty(absURL),
                    audiobookshelfAudiobookLibraryId: nilIfEmpty(absAudiobookLib),
                    audiobookshelfEbookLibraryId: nilIfEmpty(absEbookLib)
                )
            )
        } catch {
            filesError = settingsErrorMessage(error)
        }
        savingFiles = false
    }

    private func nilIfEmpty(_ value: String) -> String? {
        let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmed.isEmpty ? nil : trimmed
    }
}

import SwiftUI

/// Books settings (admin), non-CRUD: enable the feature, order metadata sources,
/// and set book file paths / templates. The default book profile lives on
/// Library & import > Defaults.
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
    @State private var savingFiles = false
    @State private var filesError: String?

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

    var body: some View {
        Group {
            if !model.isAdmin {
                ContentUnavailableView("Admin only", systemImage: "lock")
                    .rawkoonLivingSymbol(.empty)
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
                    .requiresConnection(model.isOffline)
                    .listRowBackground(Theme.raised)
                } header: { Text("General") }

                metadataSection
                filesSection
            }
        }
        .scrollContentBackground(.hidden)
        .readableWidth()
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
                        .accessibilityLabel(Text("Move up"))
                    Button { move(index, by: 1) } label: { Image(systemName: "chevron.down") }
                        .disabled(index == order.count - 1).buttonStyle(.borderless)
                        .accessibilityLabel(Text("Move down"))
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
                .requiresConnection(model.isOffline)
                .listRowBackground(Theme.raised)
            if let orderError {
                Text(orderError).foregroundStyle(Theme.danger).listRowBackground(Theme.raised)
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
            Button("Save files") { Task { await saveFiles() } }
                .disabled(savingFiles)
                .requiresConnection(model.isOffline)
                .listRowBackground(Theme.raised)
            if let filesError {
                Text(filesError).foregroundStyle(Theme.danger).listRowBackground(Theme.raised)
            }
        } header: {
            Text("Files")
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
            do {
                try await model.api()?.updateBooksEnabled(value)
                model.booksEnabled = value
            } catch {
                booksEnabled = previous
                model.toast(String(localized: "Couldn't update books setting."), style: .error)
            }
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
            booksEnabled = general.booksEnabled ?? false
            order = sources
            booksPath = settings.booksLibraryPath ?? ""
            audiobooksPath = settings.audiobooksLibraryPath ?? ""
            bookTemplate = settings.bookTemplate ?? ""
            audiobookTemplate = settings.audiobookTemplate ?? ""
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
                    defaultBookQualityProfileId: nil
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

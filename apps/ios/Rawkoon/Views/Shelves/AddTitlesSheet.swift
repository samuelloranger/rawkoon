import RawkoonKit
import SwiftUI

/// Add titles to a shelf: search the library first, then TMDB for what it lacks,
/// so a shelf can hold a film before it is requested.
struct AddTitlesSheet: View {
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss

    let shelfId: Int
    /// The titles the shelf already holds, so the sheet doesn't offer them twice.
    let onShelf: [ShelfEntry]
    var onAdded: (ShelfEntry) -> Void

    @State private var query = ""
    @State private var library: [LibraryMedia] = []
    @State private var tmdb: [TmdbSearchItem] = []
    @State private var searching = false
    @State private var searchFailed = false
    @State private var adding: Int?
    @State private var error: String?

    private struct Candidate: Identifiable {
        let tmdbId: Int
        let type: String
        let title: String
        let year: Int?
        let posterUrl: String?
        let inLibrary: Bool

        var id: String {
            "\(type)-\(tmdbId)"
        }
    }

    private var held: Set<String> {
        Set(onShelf.map { "\($0.type)-\($0.tmdbId)" })
    }

    private var candidates: [Candidate] {
        var seen = Set<String>()
        var out: [Candidate] = []
        for item in library {
            let candidate = Candidate(
                tmdbId: item.tmdbId,
                type: item.type == "show" ? "show" : "movie",
                title: item.title,
                year: item.year,
                posterUrl: item.posterUrl,
                inLibrary: true
            )
            if seen.insert(candidate.id).inserted {
                out.append(candidate)
            }
        }
        for item in tmdb {
            let candidate = Candidate(
                tmdbId: item.tmdbId,
                type: item.mediaType == "tv" ? "show" : "movie",
                title: item.title,
                year: item.releaseYear,
                posterUrl: item.posterUrl,
                inLibrary: item.alreadyExists ?? false
            )
            if seen.insert(candidate.id).inserted {
                out.append(candidate)
            }
        }
        return out
    }

    var body: some View {
        NavigationStack {
            List {
                if query.trimmingCharacters(in: .whitespaces).count < 2 {
                    Text("Type at least two letters.")
                        .foregroundStyle(Theme.muted)
                } else if searching, candidates.isEmpty {
                    HStack {
                        ProgressView()
                        Text("Searching…")
                            .foregroundStyle(Theme.muted)
                    }
                } else if candidates.isEmpty, searchFailed {
                    Text("Couldn't search. Check your connection and try again.")
                        .foregroundStyle(Theme.muted)
                } else if candidates.isEmpty {
                    Text("Nothing found.")
                        .foregroundStyle(Theme.muted)
                } else {
                    ForEach(candidates) { candidate in
                        row(candidate)
                    }
                }
            }
            .listStyle(.plain)
            .scrollContentBackground(.hidden)
            .background(Theme.base)
            .navigationTitle("Add titles")
            .navigationBarTitleDisplayMode(.inline)
            .searchable(text: $query, prompt: Text("Search movies and shows"))
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Done") { dismiss() }
                }
            }
            .task(id: query) { await search() }
            .alert(
                "Couldn't add the title",
                isPresented: Binding(get: { error != nil }, set: {
                    if !$0 {
                        error = nil
                    }
                })
            ) {
                Button("OK", role: .cancel) {}
            } message: {
                Text(error ?? "")
            }
        }
    }

    private func row(_ candidate: Candidate) -> some View {
        HStack(spacing: 10) {
            CachedAsyncImage(url: model.absoluteURL(candidate.posterUrl), targetSize: CGSize(width: 60, height: 90)) { image in
                image.resizable().scaledToFill()
            } placeholder: {
                Theme.inset
            }
            .frame(width: 36, height: 54)
            .clipShape(RoundedRectangle(cornerRadius: 5))
            VStack(alignment: .leading, spacing: 2) {
                Text(verbatim: candidate.title)
                    .foregroundStyle(Theme.textStrong)
                    .lineLimit(1)
                Text(verbatim: subtitle(candidate))
                    .font(.caption)
                    .foregroundStyle(Theme.muted)
                    .lineLimit(1)
            }
            Spacer(minLength: 6)
            if held.contains(candidate.id) {
                Text("On this shelf")
                    .font(.caption.weight(.medium))
                    .foregroundStyle(Theme.muted)
            } else {
                Button {
                    Task { await add(candidate) }
                } label: {
                    if adding == candidate.tmdbId {
                        ProgressView()
                    } else {
                        Image(systemName: "plus.circle.fill")
                            .foregroundStyle(Theme.apricot)
                    }
                }
                .buttonStyle(.plain)
                .disabled(adding != nil)
                .accessibilityLabel("Add \(candidate.title)")
                .requiresConnection(model.isOffline)
            }
        }
    }

    /// "2010 · Movie · In library", the line under a result's name.
    private func subtitle(_ candidate: Candidate) -> String {
        var parts: [String] = []
        if let year = candidate.year {
            parts.append(String(year))
        }
        parts.append(candidate.type == "show" ? String(localized: "Show") : String(localized: "Movie"))
        parts.append(candidate.inLibrary ? String(localized: "In library") : String(localized: "Not in library"))
        return parts.joined(separator: " · ")
    }

    private func search() async {
        let text = query.trimmingCharacters(in: .whitespaces)
        guard text.count >= 2, let client = model.api() else {
            library = []
            tmdb = []
            return
        }
        // Typing a letter at a time shouldn't fire a request per keystroke
        try? await Task.sleep(for: .milliseconds(300))
        guard !Task.isCancelled else { return }
        searching = true
        defer { searching = false }
        async let libraryResult = try? client.libraryList(q: text, page: 1, limit: 8)
        async let tmdbResult = try? client.tmdbSearch(q: text)
        let (libraryPage, tmdbPage) = await (libraryResult, tmdbResult)
        // A newer keystroke has taken over; don't overwrite its results with these
        guard !Task.isCancelled else { return }
        library = libraryPage?.items ?? []
        tmdb = tmdbPage?.items ?? []
        searchFailed = libraryPage == nil && tmdbPage == nil
    }

    private func add(_ candidate: Candidate) async {
        guard let client = model.api() else { return }
        adding = candidate.tmdbId
        defer { adding = nil }
        do {
            let entry = try await client.addShelfEntry(
                shelfId: shelfId,
                tmdbId: candidate.tmdbId,
                type: candidate.type
            )
            onAdded(entry)
            model.toast(String(localized: "Title added."), style: .success)
        } catch let apiError as APIError {
            error = apiError.userMessage(unauthorized: String(localized: "Sign in required."))
        } catch {
            self.error = String(localized: "Can't reach the server. Try again in a moment.")
        }
    }
}

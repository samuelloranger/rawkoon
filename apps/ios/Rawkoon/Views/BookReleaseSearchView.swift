import SwiftUI

/// Add an audiobook (or ebook) edition to a book, then search indexers and grab
/// a release — mirrors the web book-detail flow. Presented as a sheet.
struct BookReleaseSearchView: View {
    @Environment(AppModel.self) private var model

    let bookId: Int
    let kind: String // "audiobook" | "ebook"
    let title: String

    @State private var releases: [BookRelease] = []
    @State private var loading = true
    @State private var errorMessage: String?
    @State private var grabError: String?
    @State private var grabbing: String?
    @State private var grabbed: Set<String> = []
    @State private var showRejected = false

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            Capsule().fill(Theme.apricotSoft.opacity(0.35))
                .frame(width: 38, height: 5)
                .frame(maxWidth: .infinity)
                .padding(.top, 10).padding(.bottom, 12)

            Text("Add \(kind == "audiobook" ? "audiobook" : "ebook")")
                .font(.display(20)).foregroundStyle(Theme.textStrong)
            Text(title)
                .font(.system(.caption, design: .monospaced))
                .foregroundStyle(Theme.faint)
                .padding(.bottom, 12)

            content
        }
        .padding(.horizontal, 16)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
        .background(Theme.base)
        .task { await start() }
    }

    @ViewBuilder
    private var content: some View {
        if loading {
            centered { ProgressView().tint(Theme.apricot); Text("Searching…").foregroundStyle(Theme.muted) }
        } else if let errorMessage, releases.isEmpty {
            centered {
                ContentUnavailableView("Search failed", systemImage: "wifi.slash", description: Text(errorMessage))
            }
        } else if visibleReleases.isEmpty {
            centered {
                ContentUnavailableView("No releases", systemImage: "magnifyingglass",
                                       description: Text("Nothing grabbable found for this book."))
            }
        } else {
            if let grabError {
                Text(grabError)
                    .font(.subheadline)
                    .foregroundStyle(Theme.terracotta)
                    .padding(.bottom, 8)
            }
            ScrollView {
                LazyVStack(spacing: 8) {
                    ForEach(visibleReleases) { release in
                        releaseRow(release)
                    }
                    if hasRejected {
                        Button(showRejected ? "Hide rejected" : "Show rejected") { showRejected.toggle() }
                            .font(.subheadline).foregroundStyle(Theme.muted)
                            .padding(.vertical, 8)
                    }
                }
                .padding(.bottom, 24)
            }
        }
    }

    private var visibleReleases: [BookRelease] {
        showRejected ? releases : releases.filter { $0.rejected != true }
    }

    private var hasRejected: Bool {
        releases.contains { $0.rejected == true }
    }

    private func releaseRow(_ release: BookRelease) -> some View {
        VStack(alignment: .leading, spacing: 7) {
            Text(release.title)
                .font(.subheadline)
                .foregroundStyle(release.rejected == true ? Theme.muted : Theme.text)
                .lineLimit(2)
            HStack(spacing: 8) {
                if let format = release.format {
                    chip(format.uppercased())
                }
                Text(sizeText(release.sizeBytes)).font(.system(.caption2, design: .monospaced)).foregroundStyle(Theme.muted)
                Label("\(release.seeders ?? 0)", systemImage: "arrow.up")
                    .font(.system(.caption2, design: .monospaced)).foregroundStyle(Theme.seed)
                Spacer(minLength: 4)
                grabButton(release)
            }
            if let indexer = release.indexer {
                Text("\(indexer) · \(release.age ?? 0)d")
                    .font(.system(.caption2, design: .monospaced)).foregroundStyle(Theme.faint)
            }
            if release.rejected == true, let reason = release.rejections?.first {
                Text(reason).font(.caption2).foregroundStyle(Theme.terracotta).lineLimit(1)
            }
        }
        .padding(11)
        .background(Theme.raised, in: RoundedRectangle(cornerRadius: 12))
        .overlay(RoundedRectangle(cornerRadius: 12).strokeBorder(Theme.border, lineWidth: 1))
    }

    @ViewBuilder
    private func grabButton(_ release: BookRelease) -> some View {
        if grabbed.contains(release.guid) {
            Label("Grabbed", systemImage: "checkmark").font(.caption2.weight(.bold)).foregroundStyle(Theme.seed)
        } else if grabbing == release.guid {
            ProgressView().tint(Theme.apricot)
        } else {
            Button("Grab") { Task { await grab(release) } }
                .font(.caption.weight(.bold)).foregroundStyle(Theme.onAccent)
                .padding(.horizontal, 14)
                .frame(minHeight: 44)
                .background(Theme.terracotta, in: Capsule())
                .disabled(release.downloadUrl == nil && release.magnetUrl == nil)
        }
    }

    private func chip(_ text: String) -> some View {
        Text(text)
            .font(.system(.caption2, design: .monospaced))
            .foregroundStyle(Theme.apricotSoft)
            .padding(.horizontal, 7).padding(.vertical, 3)
            .background(Theme.apricot.opacity(0.12), in: RoundedRectangle(cornerRadius: 6))
    }

    private func centered(@ViewBuilder _ c: () -> some View) -> some View {
        VStack(spacing: 10) { c() }.frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    private func sizeText(_ bytes: Int?) -> String {
        guard let bytes else { return "—" }
        return ByteCountFormatter.string(fromByteCount: Int64(bytes), countStyle: .file)
    }

    // MARK: Actions

    private func start() async {
        guard let client = model.api() else { errorMessage = "Not logged in."; loading = false; return }
        // Ensure the edition exists (400 if it already does — that's fine).
        try? await client.addBookEdition(bookId: bookId, kind: kind)
        do {
            releases = try await client.bookReleaseSearch(bookId: bookId, kind: kind).releases
        } catch APIError.unauthorized {
            errorMessage = "Admin only."
        } catch {
            errorMessage = "Could not search releases."
        }
        loading = false
    }

    private func grab(_ release: BookRelease) async {
        guard let client = model.api() else { return }
        grabbing = release.guid
        defer { grabbing = nil }
        do {
            try await client.bookGrab(bookId: bookId, kind: kind, body: BookGrabBody(
                releaseTitle: release.title,
                downloadUrl: release.downloadUrl,
                magnetUrl: release.magnetUrl,
                indexer: release.indexer
            ))
            grabbed.insert(release.guid)
            grabError = nil
            await model.loadLibrary()
        } catch {
            grabError = "Grab refused (already downloading?)."
        }
    }
}

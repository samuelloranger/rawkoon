import Foundation
import RawkoonKit
import SwiftUI

struct BookView: View {
    @EnvironmentObject private var model: AppModel

    let book: BookListItem

    @State private var manifest: BookManifest?
    @State private var loadingManifest = false
    @State private var loadingPlayer = false
    @State private var showingPlayer = false
    @State private var showingAddAudiobook = false

    private var editionId: Int? { book.audiobookEditionId }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 18) {
                header
                if book.hasAudiobook {
                    actionButtons
                    chaptersList
                }
                if book.hasEbook {
                    ebookCard
                }
                if !book.hasAudiobook {
                    addAudiobookButton
                }
            }
            .padding(16)
        }
        .background(Theme.base)
        .navigationTitle(book.title)
        .navigationBarTitleDisplayMode(.inline)
        .task {
            if book.hasAudiobook && manifest == nil { await fetchManifest() }
        }
        .sheet(isPresented: $showingPlayer) {
            if let manifest, let summary = book.audiobookSummary {
                PlayerView(summary: summary, manifest: manifest)
                    .environmentObject(model)
            }
        }
        .sheet(isPresented: $showingAddAudiobook) {
            BookReleaseSearchView(bookId: book.bookId, kind: "audiobook", title: book.title)
                .environmentObject(model)
        }
    }

    private var addAudiobookButton: some View {
        Button {
            showingAddAudiobook = true
        } label: {
            Label("Add audiobook", systemImage: "plus.circle")
                .frame(maxWidth: .infinity).frame(height: 22)
        }
        .buttonStyle(.bordered)
        .tint(Theme.apricot)
    }

    // MARK: Header

    private var header: some View {
        HStack(alignment: .top, spacing: 14) {
            BookCover(url: book.coverURL, size: 96, corner: 12)
                .shadow(color: .black.opacity(0.5), radius: 12, y: 8)

            VStack(alignment: .leading, spacing: 6) {
                Text(book.title)
                    .font(.display(20))
                    .foregroundStyle(Theme.textStrong)
                    .lineLimit(3)
                if let author = book.author, !author.isEmpty {
                    Text(author).font(.subheadline).foregroundStyle(Theme.muted)
                }
                HStack(spacing: 6) {
                    if book.hasAudiobook { chip("Audiobook", tint: Theme.apricot) }
                    if book.hasEbook { chip("EPUB", tint: Theme.importing) }
                }
                .padding(.top, 2)
                if book.hasAudiobook {
                    Text(durationLine)
                        .font(.system(.caption, design: .monospaced))
                        .foregroundStyle(Theme.faint)
                }
            }
            Spacer(minLength: 0)
        }
    }

    private func chip(_ text: String, tint: Color) -> some View {
        Text(text)
            .font(.system(.caption2, design: .monospaced))
            .foregroundStyle(tint)
            .padding(.horizontal, 7).padding(.vertical, 3)
            .background(tint.opacity(0.12), in: Capsule())
            .overlay(Capsule().strokeBorder(tint.opacity(0.3), lineWidth: 1))
    }

    private var durationLine: String {
        let secs = manifest?.totalDurationSecs ?? book.audiobookDurationSecs ?? 0
        let count = manifest?.chapters.count
        var parts = [formatDuration(secs)]
        if let count { parts.append("\(count) chapters") }
        return parts.joined(separator: " · ")
    }

    // MARK: Ebook-only

    private var ebookCard: some View {
        VStack(alignment: .leading, spacing: 8) {
            Label("EPUB", systemImage: "book.closed")
                .font(.display(16))
                .foregroundStyle(Theme.textStrong)
            Text("This book is available as an ebook. Read it from the Rawkoon web app or your desktop — the phone app plays audiobooks offline.")
                .font(.subheadline)
                .foregroundStyle(Theme.muted)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(14)
        .background(Theme.raised, in: RoundedRectangle(cornerRadius: 14))
        .overlay(RoundedRectangle(cornerRadius: 14).strokeBorder(Theme.border, lineWidth: 1))
    }

    // MARK: Audiobook actions

    private var actionButtons: some View {
        VStack(spacing: 10) {
            Button {
                Task {
                    guard let editionId else { return }
                    loadingPlayer = true
                    await model.openPlayer(editionId: editionId)
                    loadingPlayer = false
                    if model.errorMessage == nil { showingPlayer = true }
                }
            } label: {
                Group {
                    if loadingPlayer {
                        ProgressView().tint(Theme.onAccent)
                    } else {
                        Label("Play", systemImage: "play.fill")
                    }
                }
                .frame(maxWidth: .infinity).frame(height: 26)
            }
            .buttonStyle(.borderedProminent)
            .tint(Theme.apricot)
            .foregroundStyle(Theme.onAccent)
            .fontWeight(.semibold)
            .disabled(!canPlay || loadingManifest)

            downloadButton
        }
    }

    @ViewBuilder
    private var downloadButton: some View {
        let plan = editionId.flatMap { model.downloadPlans[$0] }
        if let plan, !plan.isComplete {
            VStack(alignment: .leading, spacing: 8) {
                HStack {
                    Text("Downloading").font(.subheadline.weight(.semibold)).foregroundStyle(Theme.textStrong)
                    Spacer()
                    Text("\(Int(plan.progressFraction() * 100))%")
                        .font(.system(.caption, design: .monospaced)).foregroundStyle(Theme.apricot)
                }
                DuskProgress(value: plan.progressFraction())
            }
            .padding(12).frame(maxWidth: .infinity)
            .background(Theme.raised, in: RoundedRectangle(cornerRadius: 13))
            .overlay(RoundedRectangle(cornerRadius: 13).strokeBorder(Theme.borderStrong, lineWidth: 1))
        } else if plan?.isComplete == true {
            Button {} label: {
                Label("Downloaded", systemImage: "checkmark.circle.fill")
                    .frame(maxWidth: .infinity).frame(height: 22)
            }
            .buttonStyle(.bordered).tint(Theme.seed).disabled(true)
        } else {
            Button {
                Task { if let editionId { await model.startDownload(editionId: editionId) } }
            } label: {
                Label("Download", systemImage: "arrow.down.circle")
                    .frame(maxWidth: .infinity).frame(height: 22)
            }
            .buttonStyle(.bordered).tint(Theme.apricot)
        }
    }

    // MARK: Chapters — spine rail

    private var chaptersList: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("Chapters").font(.display(17)).foregroundStyle(Theme.textStrong)
            if loadingManifest {
                ProgressView().tint(Theme.apricot)
            } else if let manifest {
                VStack(spacing: 4) {
                    ForEach(manifest.chapters.sorted(by: { $0.index < $1.index }), id: \.fileId) { chapter in
                        SpineRow(
                            index: chapter.index,
                            title: chapter.title,
                            downloaded: isChapterDownloaded(chapter),
                            current: false
                        )
                    }
                }
            } else {
                Text("Chapters couldn't load. Pull to refresh, or check the server.")
                    .font(.subheadline).foregroundStyle(Theme.muted)
            }
        }
    }

    private var canPlay: Bool {
        guard let manifest else { return false }
        return !manifest.chapters.isEmpty
    }

    private func fetchManifest() async {
        guard let editionId else { return }
        loadingManifest = true
        defer { loadingManifest = false }
        do { manifest = try await model.manifest(editionId) }
        catch { model.errorMessage = "Could not load manifest." }
    }

    private func isChapterDownloaded(_ chapter: ManifestChapter) -> Bool {
        guard let editionId else { return false }
        if model.downloadPlans[editionId]?.states[chapter.fileId] == .verified { return true }
        return FileStore.exists(editionId: editionId, fileId: chapter.fileId, ext: chapterExtension(chapter))
    }

    private func chapterExtension(_ chapter: ManifestChapter) -> String {
        let ext = URL(string: chapter.url)?.pathExtension ?? ""
        return ext.isEmpty ? "bin" : ext
    }

    private func formatDuration(_ seconds: Double) -> String {
        guard seconds.isFinite, seconds > 0 else { return "0:00" }
        let total = Int(seconds.rounded())
        let hours = total / 3600
        let minutes = (total % 3600) / 60
        if hours > 0 { return "\(hours)h \(String(format: "%02dm", minutes))" }
        return "\(minutes)m"
    }
}

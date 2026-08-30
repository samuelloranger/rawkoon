import Foundation
import RawkoonKit
import SwiftUI

struct BookView: View {
    @EnvironmentObject private var model: AppModel

    let summary: LibrarySummary

    @State private var manifest: BookManifest?
    @State private var loadingManifest = false
    @State private var loadingPlayer = false
    @State private var showingPlayer = false

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 18) {
                header
                actionButtons
                chaptersList
            }
            .padding(16)
        }
        .background(Theme.base)
        .navigationTitle(summary.title)
        .navigationBarTitleDisplayMode(.inline)
        .task {
            if manifest == nil {
                await fetchManifest()
            }
        }
        .sheet(isPresented: $showingPlayer) {
            if let manifest {
                PlayerView(summary: summary, manifest: manifest)
                    .environmentObject(model)
            }
        }
    }

    // MARK: Header

    private var header: some View {
        HStack(alignment: .top, spacing: 14) {
            BookCover(url: summary.coverURL, size: 96, corner: 12)
                .shadow(color: .black.opacity(0.5), radius: 12, y: 8)

            VStack(alignment: .leading, spacing: 6) {
                Text(summary.title)
                    .font(.display(20))
                    .foregroundStyle(Theme.textStrong)
                    .lineLimit(3)
                if let author = summary.author, !author.isEmpty {
                    Text(author)
                        .font(.subheadline)
                        .foregroundStyle(Theme.muted)
                }
                Text(durationLine)
                    .font(.system(.caption, design: .monospaced))
                    .foregroundStyle(Theme.faint)
                    .padding(.top, 2)
            }
            Spacer(minLength: 0)
        }
    }

    private var durationLine: String {
        let secs = manifest?.totalDurationSecs ?? summary.durationSecs ?? 0
        let count = manifest?.chapters.count
        var parts = [formatDuration(secs)]
        if let count { parts.append("\(count) chapters") }
        return parts.joined(separator: " · ")
    }

    // MARK: Actions

    private var actionButtons: some View {
        VStack(spacing: 10) {
            Button {
                Task {
                    loadingPlayer = true
                    await model.openPlayer(editionId: summary.editionId)
                    loadingPlayer = false
                    if model.errorMessage == nil {
                        showingPlayer = true
                    }
                }
            } label: {
                Group {
                    if loadingPlayer {
                        ProgressView().tint(Theme.onAccent)
                    } else {
                        Label(playLabel, systemImage: "play.fill")
                    }
                }
                .frame(maxWidth: .infinity)
                .frame(height: 26)
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
        let plan = model.downloadPlans[summary.editionId]
        if let plan, !plan.isComplete {
            VStack(alignment: .leading, spacing: 8) {
                HStack {
                    Text("Downloading")
                        .font(.subheadline.weight(.semibold))
                        .foregroundStyle(Theme.textStrong)
                    Spacer()
                    Text("\(Int(plan.progressFraction() * 100))%")
                        .font(.system(.caption, design: .monospaced))
                        .foregroundStyle(Theme.apricot)
                }
                DuskProgress(value: plan.progressFraction())
            }
            .padding(12)
            .frame(maxWidth: .infinity)
            .background(Theme.raised, in: RoundedRectangle(cornerRadius: 13))
            .overlay(RoundedRectangle(cornerRadius: 13).strokeBorder(Theme.borderStrong, lineWidth: 1))
        } else if plan?.isComplete == true {
            Button { } label: {
                Label("Downloaded", systemImage: "checkmark.circle.fill")
                    .frame(maxWidth: .infinity).frame(height: 22)
            }
            .buttonStyle(.bordered)
            .tint(Theme.seed)
            .disabled(true)
        } else {
            Button {
                Task { await model.startDownload(editionId: summary.editionId) }
            } label: {
                Label("Download", systemImage: "arrow.down.circle")
                    .frame(maxWidth: .infinity).frame(height: 22)
            }
            .buttonStyle(.bordered)
            .tint(Theme.apricot)
        }
    }

    private var playLabel: String {
        canPlay ? "Play" : "Play"
    }

    // MARK: Chapters — the spine rail

    private var chaptersList: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("Chapters")
                .font(.display(17))
                .foregroundStyle(Theme.textStrong)

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
                    .font(.subheadline)
                    .foregroundStyle(Theme.muted)
            }
        }
    }

    private var canPlay: Bool {
        guard let manifest else { return false }
        return !manifest.chapters.isEmpty
    }

    private func fetchManifest() async {
        loadingManifest = true
        defer { loadingManifest = false }
        do {
            manifest = try await model.manifest(summary.editionId)
        } catch {
            model.errorMessage = "Could not load manifest."
        }
    }

    private func isChapterDownloaded(_ chapter: ManifestChapter) -> Bool {
        if model.downloadPlans[summary.editionId]?.states[chapter.fileId] == .verified {
            return true
        }
        return FileStore.exists(
            editionId: summary.editionId,
            fileId: chapter.fileId,
            ext: chapterExtension(chapter)
        )
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

/// One chapter as a "spine": a lit bar for the current chapter, filled for a
/// downloaded one, hollow for not-yet. Order is the sequence, so this is honest
/// structure — not decoration.
struct SpineRow: View {
    let index: Int
    let title: String
    let downloaded: Bool
    let current: Bool

    var body: some View {
        HStack(spacing: 10) {
            spine
            Text(String(format: "%02d", index + 1))
                .font(.system(.caption2, design: .monospaced))
                .foregroundStyle(Theme.faint)
                .frame(width: 22, alignment: .leading)
            Text(title)
                .font(.subheadline)
                .fontWeight(current ? .semibold : .regular)
                .foregroundStyle(current ? Theme.textStrong : Theme.muted)
                .lineLimit(1)
            Spacer(minLength: 0)
        }
        .padding(.vertical, 2)
    }

    private var spine: some View {
        Group {
            if current {
                Capsule().fill(Theme.progress).frame(width: 4, height: 30)
                    .shadow(color: Theme.apricot.opacity(0.55), radius: 6)
            } else {
                Capsule().fill(downloaded ? Theme.faint : Theme.borderStrong)
                    .frame(width: 4, height: 22)
            }
        }
    }
}

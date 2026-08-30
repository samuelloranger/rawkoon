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
            VStack(alignment: .leading, spacing: 16) {
                header
                actionButtons
                chaptersList
            }
            .padding()
        }
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

    private var header: some View {
        HStack(alignment: .top, spacing: 12) {
            AsyncImage(url: summary.coverURL) { image in
                image.resizable().scaledToFill()
            } placeholder: {
                Color.gray.opacity(0.15)
            }
            .frame(width: 96, height: 96)
            .clipShape(RoundedRectangle(cornerRadius: 10))

            VStack(alignment: .leading, spacing: 6) {
                Text(summary.title)
                    .font(.title3.weight(.semibold))
                    .lineLimit(3)
                if let author = summary.author, !author.isEmpty {
                    Text(author)
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                }
                Text("Duration: \(formatDuration(manifest?.totalDurationSecs ?? summary.durationSecs ?? 0))")
                    .font(.footnote)
                    .foregroundStyle(.secondary)
            }
        }
    }

    private var actionButtons: some View {
        VStack(spacing: 10) {
            Button {
                Task {
                    await model.startDownload(editionId: summary.editionId)
                }
            } label: {
                if let plan = model.downloadPlans[summary.editionId], !plan.isComplete {
                    VStack(alignment: .leading, spacing: 6) {
                        Text("Downloading")
                        ProgressView(value: plan.progressFraction())
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                } else if model.downloadPlans[summary.editionId]?.isComplete == true {
                    Text("Downloaded")
                        .frame(maxWidth: .infinity)
                } else {
                    Text("Download")
                        .frame(maxWidth: .infinity)
                }
            }
            .buttonStyle(.borderedProminent)

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
                if loadingPlayer {
                    ProgressView()
                        .frame(maxWidth: .infinity)
                } else {
                    Text("Play")
                        .frame(maxWidth: .infinity)
                }
            }
            .buttonStyle(.bordered)
            .disabled(!canPlay || loadingManifest)
        }
    }

    private var chaptersList: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("Chapters")
                .font(.headline)

            if loadingManifest {
                ProgressView()
            } else if let manifest {
                ForEach(manifest.chapters.sorted(by: { $0.index < $1.index }), id: \.fileId) { chapter in
                    HStack(spacing: 8) {
                        Circle()
                            .fill(isChapterDownloaded(chapter) ? .green : .gray.opacity(0.4))
                            .frame(width: 8, height: 8)
                        Text("Chapter \(chapter.index + 1)")
                            .font(.subheadline.weight(.medium))
                        Text(chapter.title)
                            .font(.subheadline)
                            .foregroundStyle(.secondary)
                            .lineLimit(1)
                    }
                }
            } else {
                Text("Manifest unavailable.")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
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
        let secs = total % 60
        if hours > 0 {
            return String(format: "%d:%02d:%02d", hours, minutes, secs)
        }
        return String(format: "%d:%02d", minutes, secs)
    }
}

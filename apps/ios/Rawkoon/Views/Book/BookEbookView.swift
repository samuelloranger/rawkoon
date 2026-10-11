import Foundation
import RawkoonKit
import SwiftUI

struct BookEbookView: View {
    let page: BookView
    let state: BookEbookState

    var body: some View {
        ebookSection
    }

    private var model: AppModel {
        page.model
    }

    private var ebookEdition: BookEditionDetail? {
        page.ebookEdition
    }

    private var hasEbookEdition: Bool {
        page.hasEbookEdition
    }

    private var ebookFiles: [BookEditionFile] {
        state.ebookFiles
    }

    private var loadingEbookFiles: Bool {
        state.loadingEbookFiles
    }

    private var openingEbookFileId: Int? {
        state.openingEbookFileId
    }

    private var downloadingEbookFileIDs: Set<Int> {
        state.downloadingEbookFileIDs
    }

    private var ebookFilesError: String? {
        state.ebookFilesError
    }

    private var ebookResume: EbookResumeLabel {
        page.ebookResume
    }

    @ViewBuilder
    var ebookSection: some View {
        if hasEbookEdition {
            VStack(alignment: .leading, spacing: 14) {
                page.metricsCard(
                    title: "Ebook",
                    status: ebookEdition?.status ?? "wanted",
                    accent: Theme.muted,
                    metrics: ebookMetrics
                )
                ebookActions
                ebookFilesCard
                page.bookManagementCard(lane: .ebook)
            }
        } else {
            page.missingEditionCard(
                title: "Ebook edition missing",
                description: "Add an ebook edition to read files directly in Rawkoon.",
                buttonTitle: "Add ebook",
                tint: Theme.muted,
                action: { Task { await page.addEdition(kind: "ebook") } }
            )
        }
    }

    var ebookMetrics: [String] {
        var parts: [String] = []
        if let count = ebookEdition?.fileCount {
            parts.append(String(localized: "\(count) files"))
        }
        if let bestFormat = ebookEdition?.bestFormat {
            parts.append(bestFormat.uppercased())
        }
        if let size = Formatters.bytesStrict(ebookEdition?.totalSizeBytes) {
            parts.append(size)
        }
        let offlineCount = ebookFiles.filter { page.isEbookDownloaded($0) }.count
        if offlineCount > 0 {
            parts.append("\(offlineCount) offline")
        }
        return parts
    }

    var ebookActions: some View {
        VStack(alignment: .leading, spacing: 10) {
            let preferred = preferredEbookFile
            let preferredIsDownloaded = preferred.map(page.isEbookDownloaded) ?? false
            let preferredCanFetchRemote = preferred.flatMap { page.remoteEbookURL(for: $0) } != nil
            let preferredCanRead = preferredIsDownloaded || preferredCanFetchRemote

            Button {
                Task {
                    guard let file = preferredEbookFile else { return }
                    // "Read" means from the beginning — a finished book must not
                    // reopen on its last page.
                    await page.openEbook(file, startFromBeginning: ebookResume == .read)
                }
            } label: {
                Group {
                    switch ebookResume {
                    case .read:
                        Label("Read", systemImage: "book.pages")
                    case let .resumeChapter(title):
                        Label(String(localized: "Resume · \(title)"), systemImage: "book.pages")
                    case let .resumePercent(percent):
                        Label(String(localized: "Resume from \(percent)%"), systemImage: "book.pages")
                    }
                }
                .frame(maxWidth: .infinity).frame(minHeight: 44)
            }
            .buttonStyle(.borderedProminent)
            .tint(Theme.terracotta)
            .foregroundStyle(Theme.onAccent)
            .disabled(!preferredCanRead || loadingEbookFiles || openingEbookFileId != nil)

            if let preferred = preferredEbookFile {
                if preferredIsDownloaded {
                    Label("Saved for offline reading", systemImage: "checkmark.circle.fill")
                        .font(.caption)
                        .foregroundStyle(Theme.seed)
                } else if preferredCanFetchRemote {
                    Button {
                        page.startEbookDownload(preferred)
                    } label: {
                        Group {
                            if downloadingEbookFileIDs.contains(preferred.id) {
                                HStack(spacing: 8) {
                                    ProgressView().tint(Theme.muted)
                                    Text("Downloading...")
                                }
                            } else {
                                Label("Download primary file", systemImage: "arrow.down.circle")
                            }
                        }
                        .frame(maxWidth: .infinity).frame(minHeight: 44)
                    }
                    .buttonStyle(.bordered)
                    .tint(Theme.muted)
                    .disabled(downloadingEbookFileIDs.contains(preferred.id) || loadingEbookFiles)
                    .requiresConnection(model.isOffline)
                } else {
                    Text("This server does not expose secure ebook file downloads yet. Update Rawkoon on the server, then retry.")
                        .font(.caption)
                        .foregroundStyle(Theme.terracotta)
                }
            }

            if let ebookFilesError {
                Text(ebookFilesError)
                    .font(.caption)
                    .foregroundStyle(Theme.terracotta)
            }
        }
    }

    var ebookFilesCard: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("Files")
                .font(.sectionTitle)
                .foregroundStyle(Theme.textStrong)

            if loadingEbookFiles {
                ProgressView().tint(Theme.muted)
            } else if ebookFiles.isEmpty {
                Text("No ebook files imported yet. Search releases or rescan this edition.")
                    .font(.subheadline)
                    .foregroundStyle(Theme.muted)
            } else {
                ForEach(ebookFiles) { file in
                    HStack(alignment: .top, spacing: 10) {
                        let downloaded = page.isEbookDownloaded(file)
                        let downloading = downloadingEbookFileIDs.contains(file.id)
                        let loadingState = openingEbookFileId == file.id || downloading
                        let canFetchRemote = page.remoteEbookURL(for: file) != nil

                        VStack(alignment: .leading, spacing: 3) {
                            Text(file.fileName)
                                .font(.subheadline)
                                .foregroundStyle(Theme.textStrong)
                                .lineLimit(2)
                            Text(page.fileMeta(file))
                                .font(.system(.caption2, design: .monospaced))
                                .foregroundStyle(Theme.muted)
                        }
                        Spacer(minLength: 8)
                        if downloading {
                            HStack(spacing: 7) {
                                ProgressView().tint(Theme.muted)
                                Button("Cancel") {
                                    page.cancelEbookDownload(file)
                                }
                                .buttonStyle(.bordered)
                                .tint(Theme.terracotta)
                                .lineLimit(1)
                            }
                            .fixedSize()
                        } else if loadingState {
                            ProgressView().tint(Theme.muted)
                        } else {
                            // Actions hold their intrinsic width; the file name (which
                            // wraps to two lines) yields the remaining space, so labels
                            // like "Retirer" never break character-by-character.
                            HStack(spacing: 7) {
                                if downloaded {
                                    Button("Remove") {
                                        model.pendingConfirm = ConfirmRequest(
                                            title: String(localized: "Remove downloaded file?"),
                                            message: String(localized: "Deletes \(file.fileName) from this iPhone. You can download it again anytime."),
                                            confirmTitle: String(localized: "Remove Download")
                                        ) { page.removeEbookDownload(file) }
                                    }
                                    .buttonStyle(.bordered)
                                    .tint(Theme.terracotta)
                                    .lineLimit(1)
                                } else {
                                    Button("Download") {
                                        page.startEbookDownload(file)
                                    }
                                    .buttonStyle(.bordered)
                                    .tint(Theme.muted)
                                    .lineLimit(1)
                                    .disabled(!canFetchRemote)
                                    .requiresConnection(model.isOffline)
                                }

                                if isReadableEbook(file) {
                                    Button("Read") {
                                        Task { await page.openEbook(file) }
                                    }
                                    .buttonStyle(.bordered)
                                    .tint(Theme.muted)
                                    .lineLimit(1)
                                    .disabled(!downloaded && !canFetchRemote)
                                } else {
                                    StatusBadge(text: "Ebook only", tint: Theme.muted)
                                }
                            }
                            .fixedSize()
                        }
                    }
                    .padding(11)
                    .background(Theme.raised, in: RoundedRectangle(cornerRadius: 12))
                    .overlay(RoundedRectangle(cornerRadius: 12).strokeBorder(Theme.border, lineWidth: 1))
                }
            }
        }
    }

    /// The in-app reader unpacks EPUB only. Other formats in the library (the
    /// Harry Potter editions ship a .mobi beside each .epub) are downloadable
    /// but not readable here, and offering Read on them just produces a "not a
    /// valid EPUB container" error.
    func isReadableEbook(_ file: BookEditionFile) -> Bool {
        page.ebookExtension(for: file) == "epub" || file.format.lowercased() == "epub"
    }

    var preferredEbookFile: BookEditionFile? {
        ebookFiles
            .sorted { left, right in
                page.ebookFormatRank(left.format) < page.ebookFormatRank(right.format)
            }
            .first(where: isReadableEbook)
    }
}

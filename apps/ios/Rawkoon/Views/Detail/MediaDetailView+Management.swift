import RawkoonKit
import SwiftUI

extension MediaDetailView {
    // MARK: Files tab (admin, in-library)

    @ViewBuilder
    var filesSections: some View {
        if managementLoading, managementItem == nil {
            ProgressView().tint(Theme.muted)
                .frame(maxWidth: .infinity)
                .padding(.top, 8)
        } else if let managementError, managementItem == nil {
            VStack(spacing: 12) {
                ContentUnavailableView(
                    "Couldn't load files",
                    systemImage: "exclamationmark.triangle",
                    description: Text(managementError)
                )
                .rawkoonLivingSymbol(.error)
                Button {
                    Task { await refreshManagementData() }
                } label: {
                    Label("Try again", systemImage: "arrow.clockwise")
                }
                .buttonStyle(.bordered)
                .tint(Theme.apricot)
            }
            .padding(.top, 8)
        } else if managementItem != nil {
            if mediaType == "tv" {
                manageSeasonsButton
                manageSeasonsSection
            }
            // TV files fold into the seasons section; only movies keep a card.
            if mediaType != "tv" {
                managementFilesCard
            }
            managementDownloadsCard
            if let managementNotice {
                Text(managementNotice)
                    .font(.caption)
                    .foregroundStyle(Theme.apricotSoft)
                    .padding(.horizontal, 16)
            }
            if let managementError {
                Text(managementError)
                    .font(.caption)
                    .foregroundStyle(Theme.terracotta)
                    .padding(.horizontal, 16)
            }
        }
    }

    /// The selected profile's name for the field label, or "None".
    func qualityProfileName(for item: LibraryMedia) -> String {
        guard let id = item.qualityProfileId else { return String(localized: "None") }
        return qualityProfiles.first(where: { $0.id == id })?.name ?? String(localized: "None")
    }

    var managementFilesCard: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack {
                Text("Files")
                    .font(.sectionTitle)
                    .foregroundStyle(Theme.textStrong)
                Spacer()
                Text("\(mediaFiles.count)")
                    .font(.system(.caption, design: .monospaced))
                    .foregroundStyle(Theme.faint)
            }

            if mediaFiles.isEmpty {
                Text("No file metadata yet.")
                    .font(.subheadline)
                    .foregroundStyle(Theme.muted)
            } else {
                VStack(spacing: 8) {
                    ForEach(mediaFiles) { file in
                        fileRow(file, mode: .movie)
                    }
                }
            }
        }
        .padding(14)
        .background(Theme.raised, in: RoundedRectangle(cornerRadius: 14))
        .overlay(RoundedRectangle(cornerRadius: 14).strokeBorder(Theme.border, lineWidth: 1))
        .padding(.horizontal, 16)
    }

    func fileRow(_ file: LibraryFileInfo, mode: DetailFileRow.Mode) -> some View {
        DetailFileRow(
            file: file,
            mode: mode,
            isAdmin: model.isAdmin,
            onChanged: {
                if let libraryId {
                    store.invalidateLibraryRollup(itemID: libraryId)
                }
                Task { await refreshManagementData() }
            },
            onNotice: { managementNotice = $0; managementError = nil },
            onError: { managementError = $0 },
            onRequestDelete: { pendingMovieFileDelete = file },
            onReencode: {
                reencodeTarget = ReencodeTarget(selection: TranscodeSelection(fileIds: [file.id]), subtitle: file.fileName)
            }
        )
    }

    /// Library files keyed by season, for the seasons section. Empty unless
    /// admin + in-library (the only case `mediaFiles` is populated).
    var filesBySeason: [Int: [LibraryFileInfo]] {
        guard mediaFilesType == "show" else { return [:] }
        return Dictionary(grouping: mediaFiles) { $0.season ?? 0 }
    }

    var managementDownloadsCard: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack {
                Text("Download history")
                    .font(.sectionTitle)
                    .foregroundStyle(Theme.textStrong)
                Spacer()
                Button("Clear failed") {
                    Task { await clearFailedDownloadsAction() }
                }
                .font(.caption)
                .buttonStyle(.plain)
                .foregroundStyle(Theme.apricot)
                .disabled(applyingManagementChange)
                .requiresConnection(model.isOffline)
            }

            if downloads.isEmpty {
                Text("No download history yet.")
                    .font(.subheadline)
                    .foregroundStyle(Theme.muted)
            } else {
                VStack(spacing: 8) {
                    ForEach(liveDownloads) { row in
                        DetailDownloadRow(
                            row: row,
                            busy: pendingDownloadActionId == row.id,
                            onAction: { action in Task { await performDownloadAction(row.id, action: action) } },
                            onRemoveActive: { pendingDownloadRemoveId = row.id },
                            onDeleteEntry: { Task { await deleteDownloadEntryAction(row.id) } }
                        )
                    }
                }
            }
        }
        .padding(14)
        .background(Theme.raised, in: RoundedRectangle(cornerRadius: 14))
        .overlay(RoundedRectangle(cornerRadius: 14).strokeBorder(Theme.border, lineWidth: 1))
        .padding(.horizontal, 16)
    }
}

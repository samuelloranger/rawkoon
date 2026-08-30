import SwiftUI

/// Presented as a sheet from MediaDetailView. Interactive indexer search + grab.
struct ReleaseSearchView: View {
    @EnvironmentObject private var model: AppModel
    @Environment(\.dismiss) private var dismiss

    let query: String
    let libraryMediaId: Int?
    let tmdbId: Int?
    let mediaType: String

    init(query: String, libraryMediaId: Int?, tmdbId: Int?, mediaType: String) {
        self.query = query
        self.libraryMediaId = libraryMediaId
        self.tmdbId = tmdbId
        self.mediaType = mediaType
    }

    @State private var releases: [ReleaseItem] = []
    @State private var service: String?
    @State private var isLoading = false
    @State private var errorMessage: String?
    @State private var adminOnlyNote: String?
    @State private var grabbingGuid: String?
    @State private var grabbedGuids: Set<String> = []

    var body: some View {
        VStack(spacing: 0) {
            grabber

            VStack(alignment: .leading, spacing: 4) {
                Text("Releases")
                    .font(.display(22))
                    .foregroundStyle(Theme.textStrong)
                Text(query)
                    .font(.system(.caption, design: .monospaced))
                    .foregroundStyle(Theme.faint)
                    .lineLimit(1)
                if let service, !service.isEmpty {
                    Text(service)
                        .font(.system(.caption2, design: .monospaced))
                        .foregroundStyle(Theme.muted)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.horizontal, 16)
            .padding(.top, 6)
            .padding(.bottom, 12)

            if let adminOnlyNote {
                Text(adminOnlyNote)
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(Theme.terracotta)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(.horizontal, 16)
                    .padding(.bottom, 8)
            }

            content
        }
        .background(Theme.base)
        .task {
            await search()
        }
    }

    private var grabber: some View {
        Capsule()
            .fill(Theme.borderStrong)
            .frame(width: 40, height: 5)
            .padding(.top, 8)
    }

    @ViewBuilder
    private var content: some View {
        if isLoading {
            VStack(spacing: 10) {
                ProgressView().tint(Theme.apricot)
                Text("Searching…")
                    .font(.subheadline)
                    .foregroundStyle(Theme.muted)
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
        } else if let errorMessage {
            ContentUnavailableView {
                Label("Search failed", systemImage: "exclamationmark.triangle")
            } description: {
                Text(errorMessage)
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
        } else if releases.isEmpty {
            ContentUnavailableView.search
                .frame(maxWidth: .infinity, maxHeight: .infinity)
        } else {
            ScrollView {
                LazyVStack(spacing: 10) {
                    ForEach(sortedReleases) { release in
                        ReleaseRow(
                            release: release,
                            isGrabbing: grabbingGuid == release.guid,
                            isGrabbed: grabbedGuids.contains(release.guid),
                            onGrab: { await grab(release) }
                        )
                    }
                }
                .padding(16)
            }
        }
    }

    private var sortedReleases: [ReleaseItem] {
        releases.sorted { ($0.seeders ?? 0) > ($1.seeders ?? 0) }
    }

    private func search() async {
        guard let client = model.api() else {
            errorMessage = "Not connected."
            return
        }
        isLoading = true
        errorMessage = nil
        defer { isLoading = false }
        do {
            let response = try await client.interactiveSearch(
                q: query,
                libraryMediaId: libraryMediaId,
                tmdbId: tmdbId,
                mediaType: mediaType
            )
            releases = response.releases
            service = response.service
        } catch APIError.unauthorized {
            adminOnlyNote = "Admin only"
        } catch {
            errorMessage = "Couldn't load releases. Check the server."
        }
    }

    private func grab(_ release: ReleaseItem) async {
        guard let client = model.api() else { return }
        grabbingGuid = release.guid
        defer { grabbingGuid = nil }
        do {
            if let token = release.downloadToken {
                try await client.grabByToken(token)
            } else if let libraryMediaId, let downloadUrl = release.downloadUrl {
                try await client.grabByUrl(
                    libraryId: libraryMediaId,
                    body: GrabUrlBody(downloadUrl: downloadUrl, releaseTitle: release.title, episodeId: nil)
                )
            } else {
                errorMessage = "This release can't be grabbed."
                return
            }
            grabbedGuids.insert(release.guid)
        } catch APIError.unauthorized {
            adminOnlyNote = "Admin only"
        } catch {
            errorMessage = "Grab failed for \"\(release.title)\"."
        }
    }
}

// MARK: - Row

private struct ReleaseRow: View {
    let release: ReleaseItem
    let isGrabbing: Bool
    let isGrabbed: Bool
    let onGrab: () async -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(release.title)
                .font(.subheadline.weight(.medium))
                .foregroundStyle(Theme.text)
                .lineLimit(2)

            HStack(spacing: 8) {
                Text(quality)
                    .font(.system(.caption2, design: .monospaced))
                    .foregroundStyle(Theme.muted)
                    .padding(.horizontal, 8)
                    .padding(.vertical, 3)
                    .background(Theme.well, in: Capsule())

                if let sizeText {
                    Text(sizeText)
                        .font(.system(.caption2, design: .monospaced))
                        .foregroundStyle(Theme.muted)
                }

                Text("\(release.seeders ?? 0) up")
                    .font(.system(.caption2, design: .monospaced))
                    .foregroundStyle(Theme.seed)

                Spacer(minLength: 8)

                grabButton
            }

            Text("\(release.indexer ?? "") · \(release.age ?? 0)d")
                .font(.system(.caption2, design: .monospaced))
                .foregroundStyle(Theme.faint)
        }
        .padding(12)
        .background(Theme.raised, in: RoundedRectangle(cornerRadius: 12))
        .overlay(RoundedRectangle(cornerRadius: 12).strokeBorder(Theme.border, lineWidth: 1))
    }

    @ViewBuilder
    private var grabButton: some View {
        if isGrabbed {
            Label("Grabbed", systemImage: "checkmark.circle.fill")
                .font(.system(.caption, design: .monospaced))
                .foregroundStyle(Theme.seed)
        } else if isGrabbing {
            ProgressView()
                .tint(Theme.apricot)
                .frame(width: 20, height: 20)
        } else {
            Button {
                Task { await onGrab() }
            } label: {
                Text("Grab")
                    .font(.system(.caption, design: .monospaced).weight(.semibold))
                    .foregroundStyle(Theme.onAccent)
                    .padding(.horizontal, 12)
                    .padding(.vertical, 5)
                    .background(Theme.apricot, in: Capsule())
            }
        }
    }

    private var quality: String {
        let title = release.title.lowercased()
        let markers: [(String, String)] = [
            ("2160p", "2160p"),
            ("1080p", "1080p"),
            ("720p", "720p"),
            ("web-dl", "WEB-DL"),
            ("webdl", "WEB-DL"),
            ("bluray", "BluRay"),
            ("blu-ray", "BluRay"),
        ]
        for (needle, label) in markers where title.contains(needle) {
            return label
        }
        return release.protocolType ?? ""
    }

    private var sizeText: String? {
        guard let bytes = release.sizeBytes else { return nil }
        return ByteCountFormatter.string(fromByteCount: Int64(bytes), countStyle: .file)
    }
}

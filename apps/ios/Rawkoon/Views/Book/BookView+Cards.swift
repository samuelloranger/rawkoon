import Foundation
import RawkoonKit
import SwiftUI

extension BookView {
    /// Admin-only per-lane management, mirroring the media detail's Management
    /// card: release search (the card's primary action) plus a rescan. Keeps
    /// these off the reader/listener action stack above.
    @ViewBuilder
    func bookManagementCard(lane: BookDetailLane) -> some View {
        if model.isAdmin {
            let rescanning = lane == .audiobook ? rescanningManifest : rescanningEbook
            let rescanDisabled = lane == .audiobook
                ? (rescanningManifest || loadingManifest)
                : (rescanningEbook || loadingEbookFiles)
            VStack(alignment: .leading, spacing: 12) {
                Text("Management")
                    .font(.sectionTitle)
                    .foregroundStyle(Theme.textStrong)

                Button {
                    releaseSearchLane = lane == .audiobook ? .audiobook : .ebook
                } label: {
                    Label("Search releases", systemImage: "magnifyingglass")
                        .frame(maxWidth: .infinity)
                        .frame(minHeight: 44)
                }
                .buttonStyle(.borderedProminent)
                .tint(Theme.apricot)
                .foregroundStyle(Theme.onAccent)
                .fontWeight(.semibold)
                .requiresConnection(model.isOffline)

                Button {
                    Task {
                        if lane == .audiobook {
                            await recoverManifestAfterRescan()
                        } else {
                            await rescanEbookEdition()
                        }
                    }
                } label: {
                    Group {
                        if rescanning {
                            ProgressView().tint(Theme.muted)
                        } else {
                            Label("Rescan", systemImage: "arrow.clockwise")
                        }
                    }
                    .frame(maxWidth: .infinity)
                    .frame(minHeight: 44)
                }
                .buttonStyle(.bordered)
                .tint(Theme.muted)
                .disabled(rescanDisabled)
                .requiresConnection(model.isOffline)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(14)
            .background(Theme.raised, in: RoundedRectangle(cornerRadius: 14))
            .overlay(RoundedRectangle(cornerRadius: 14).strokeBorder(Theme.border, lineWidth: 1))
        }
    }

    var overviewCard: some View {
        Group {
            if let overview = detail?.overview, !overview.isEmpty {
                VStack(alignment: .leading, spacing: 8) {
                    Text("Overview")
                        .font(.sectionTitle)
                        .foregroundStyle(Theme.textStrong)
                    Text(HTMLText.plainText(overview))
                        .font(.subheadline)
                        .foregroundStyle(Theme.text)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(14)
                .background(Theme.raised, in: RoundedRectangle(cornerRadius: 14))
                .overlay(RoundedRectangle(cornerRadius: 14).strokeBorder(Theme.border, lineWidth: 1))
            }
        }
    }

    var metadataCard: some View {
        Group {
            if !metadataRows.isEmpty {
                VStack(alignment: .leading, spacing: 10) {
                    Text("Book info")
                        .font(.sectionTitle)
                        .foregroundStyle(Theme.textStrong)
                    ForEach(Array(metadataRows.enumerated()), id: \.offset) { entry in
                        let row = entry.element
                        HStack(alignment: .top) {
                            Text(row.label)
                                .font(.caption)
                                .foregroundStyle(Theme.faint)
                            Spacer(minLength: 12)
                            Text(row.value)
                                .font(.subheadline)
                                .foregroundStyle(Theme.text)
                                .multilineTextAlignment(.trailing)
                        }
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(14)
                .background(Theme.raised, in: RoundedRectangle(cornerRadius: 14))
                .overlay(RoundedRectangle(cornerRadius: 14).strokeBorder(Theme.border, lineWidth: 1))
            }
        }
    }

    var metadataRows: [(label: String, value: String)] {
        guard let detail else { return [] }
        var rows: [(String, String)] = []
        if let isbn = detail.isbn13, !isbn.isEmpty {
            rows.append(("ISBN-13", isbn))
        }
        if !detail.narrators.isEmpty {
            rows.append(("Narrators", detail.narrators.joined(separator: ", ")))
        }
        if let publisher = detail.publisher, !publisher.isEmpty {
            rows.append(("Publisher", publisher))
        }
        if let pages = detail.pageCount {
            rows.append(("Pages", String(pages)))
        }
        if let rating = detail.rating {
            if let count = detail.ratingCount {
                rows.append(("Rating", "\(String(format: "%.1f", rating)) (\(count))"))
            } else {
                rows.append(("Rating", String(format: "%.1f", rating)))
            }
        }
        if !detail.genres.isEmpty {
            rows.append(("Genres", detail.genres.joined(separator: " · ")))
        }
        return rows
    }
}

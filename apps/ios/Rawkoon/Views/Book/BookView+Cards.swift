import Foundation
import RawkoonKit
import SwiftUI

extension BookView {
    var overviewCard: some View {
        Group {
            if let overview = detail?.overview, !overview.isEmpty {
                VStack(alignment: .leading, spacing: 8) {
                    Text("Overview")
                        .font(.sectionTitle)
                        .foregroundStyle(Theme.textStrong)
                    Text(renderedOverviewText(overview))
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

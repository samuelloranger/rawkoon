import SwiftUI

struct LibraryView: View {
    @EnvironmentObject private var model: AppModel

    var body: some View {
        ScrollView {
            LazyVStack(spacing: 8) {
                ForEach(model.library) { item in
                    NavigationLink {
                        BookView(summary: item)
                    } label: {
                        LibraryRow(item: item, downloaded: isDownloaded(item))
                    }
                    .buttonStyle(.plain)
                }
            }
            .padding(.horizontal, 16)
            .padding(.top, 4)
        }
        .background(Theme.base)
        .navigationTitle("Library")
        .overlay {
            if model.loading && model.library.isEmpty {
                ProgressView().tint(Theme.apricot)
            } else if !model.loading && model.library.isEmpty {
                ContentUnavailableView(
                    "No books yet",
                    systemImage: "books.vertical",
                    description: Text("Books added on your Rawkoon server show up here.")
                )
            }
        }
        .task {
            if model.library.isEmpty {
                await model.loadLibrary()
            }
        }
        .refreshable {
            await model.loadLibrary()
        }
    }

    private func isDownloaded(_ item: LibrarySummary) -> Bool {
        model.downloadPlans[item.editionId]?.isComplete == true
    }
}

private struct LibraryRow: View {
    let item: LibrarySummary
    let downloaded: Bool

    var body: some View {
        HStack(spacing: 12) {
            BookCover(url: item.coverURL, size: 56, corner: 10)

            VStack(alignment: .leading, spacing: 4) {
                Text(item.title)
                    .font(.display(16))
                    .foregroundStyle(Theme.textStrong)
                    .lineLimit(2)
                if let author = item.author, !author.isEmpty {
                    Text(author)
                        .font(.subheadline)
                        .foregroundStyle(Theme.muted)
                        .lineLimit(1)
                }
            }

            Spacer(minLength: 12)

            if downloaded {
                StatusBadge(text: "Offline", tint: Theme.seed)
            }
        }
        .padding(12)
        .background(Theme.raised, in: RoundedRectangle(cornerRadius: 14))
        .overlay(
            RoundedRectangle(cornerRadius: 14).strokeBorder(Theme.border, lineWidth: 1)
        )
    }
}

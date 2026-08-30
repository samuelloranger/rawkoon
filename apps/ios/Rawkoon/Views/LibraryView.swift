import SwiftUI

struct LibraryView: View {
    @EnvironmentObject private var model: AppModel

    var body: some View {
        List(model.library) { item in
            NavigationLink {
                BookView(summary: item)
            } label: {
                HStack(spacing: 12) {
                    AsyncImage(url: item.coverURL) { image in
                        image.resizable().scaledToFill()
                    } placeholder: {
                        Color.gray.opacity(0.15)
                    }
                    .frame(width: 56, height: 56)
                    .clipShape(RoundedRectangle(cornerRadius: 8))

                    VStack(alignment: .leading, spacing: 4) {
                        Text(item.title)
                            .font(.headline)
                            .lineLimit(2)
                        if let author = item.author, !author.isEmpty {
                            Text(author)
                                .font(.subheadline)
                                .foregroundStyle(.secondary)
                                .lineLimit(1)
                        }
                    }

                    Spacer(minLength: 12)
                    if model.downloadPlans[item.editionId]?.isComplete == true {
                        Text("Downloaded")
                            .font(.caption2)
                            .padding(.horizontal, 8)
                            .padding(.vertical, 4)
                            .background(Capsule().fill(.green.opacity(0.2)))
                            .foregroundStyle(.green)
                    }
                }
                .padding(.vertical, 4)
            }
        }
        .navigationTitle("Library")
        .overlay {
            if model.loading && model.library.isEmpty {
                ProgressView()
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
}

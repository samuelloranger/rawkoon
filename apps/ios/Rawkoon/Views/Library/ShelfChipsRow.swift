import RawkoonKit
import SwiftUI

/// A horizontal row of pill links to the catalogue pages in `FindShelf`.
struct ShelfChipsRow: View {
    let shelves: [FindShelf]

    var body: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 8) {
                ForEach(shelves, id: \.self) { shelf in
                    NavigationLink {
                        shelf.destination
                    } label: {
                        Label(shelf.title, systemImage: shelf.symbol)
                            .font(.subheadline.weight(.medium))
                            .foregroundStyle(Theme.textStrong)
                            .padding(.horizontal, 14)
                            .frame(minHeight: 44)
                            .background(Theme.raised, in: Capsule())
                            .overlay(Capsule().strokeBorder(Theme.border, lineWidth: 1))
                    }
                    .buttonStyle(.rawkoonPressable)
                }
            }
            .padding(.horizontal, 16)
        }
    }
}

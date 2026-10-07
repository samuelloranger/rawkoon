import SwiftUI

/// The Management card's movie lamp: tap searches and grabs by itself, the
/// chevron (or a long press) offers the interactive release sheet instead.
struct MovieAutoSearchLamp: View {
    let isSearching: Bool
    let onAutoSearch: () -> Void
    let onChoose: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 0) {
                Menu {
                    options
                } label: {
                    mainLabel
                } primaryAction: {
                    onAutoSearch()
                }
                .accessibilityLabel(isSearching ? Text("Searching…") : Text("Auto search"))
                .accessibilityHint("Searches your indexers and grabs the best release. Touch and hold for more options.")

                Rectangle()
                    .fill(Theme.onAccent.opacity(0.28))
                    .frame(width: 1)
                    .padding(.vertical, 8)

                Menu {
                    options
                } label: {
                    Image(systemName: "chevron.down")
                        .font(.footnote.weight(.bold))
                        .frame(width: 46, height: 44)
                        .contentShape(Rectangle())
                }
                .accessibilityLabel("More search options")
            }
            .foregroundStyle(Theme.onAccent)
            .background(Theme.apricot.opacity(isSearching ? 0.7 : 1), in: RoundedRectangle(cornerRadius: 12))
            .clipShape(RoundedRectangle(cornerRadius: 12))
            .disabled(isSearching)

            if isSearching {
                Text("Checking your indexers and picking the best match. This can take a minute.")
                    .font(.caption)
                    .foregroundStyle(Theme.faint)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
    }

    private var mainLabel: some View {
        HStack(spacing: 8) {
            if isSearching {
                ProgressView().tint(Theme.onAccent)
                Text("Searching…")
            } else {
                Image(systemName: "bolt.fill")
                Text("Auto search")
            }
        }
        .font(.body.weight(.semibold))
        .frame(maxWidth: .infinity, minHeight: 44)
        .contentShape(Rectangle())
    }

    @ViewBuilder
    private var options: some View {
        Button(action: onAutoSearch) {
            Label("Auto search", systemImage: "bolt.fill")
        }
        Button(action: onChoose) {
            Label("Choose a release…", systemImage: "magnifyingglass")
        }
    }
}

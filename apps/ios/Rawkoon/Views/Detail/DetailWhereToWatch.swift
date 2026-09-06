import SwiftUI

/// Trailer launcher (opens YouTube externally — no in-app player) plus a
/// where-to-watch strip grouping streaming / rent / buy provider logos. The
/// parent only mounts this when there is a trailer or at least one provider.
struct DetailWhereToWatch: View {
    @Environment(AppModel.self) private var model
    @Environment(\.openURL) private var openURL

    let trailer: MediaTrailer?
    let providers: WatchProviders?

    /// Whether there is anything to show — the parent gates mounting on this.
    static func hasContent(trailer: MediaTrailer?, providers: WatchProviders?) -> Bool {
        let hasTrailer = (trailer?.key?.isEmpty == false)
        let hasProviders = !(providers?.streaming ?? []).isEmpty
            || !(providers?.rent ?? []).isEmpty
            || !(providers?.buy ?? []).isEmpty
        return hasTrailer || hasProviders
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            if let key = trailer?.key, !key.isEmpty {
                Button {
                    if let url = URL(string: "https://www.youtube.com/watch?v=\(key)") {
                        openURL(url)
                    }
                } label: {
                    Label("Watch trailer", systemImage: "play.rectangle.fill")
                }
                .buttonStyle(.bordered)
                .tint(Theme.muted)
            }

            providerGroup("Stream", items: providers?.streaming ?? [])
            providerGroup("Rent", items: providers?.rent ?? [])
            providerGroup("Buy", items: providers?.buy ?? [])
        }
        .padding(.horizontal, 16)
    }

    @ViewBuilder
    private func providerGroup(_ label: LocalizedStringKey, items: [StreamingProvider]) -> some View {
        if !items.isEmpty {
            VStack(alignment: .leading, spacing: 6) {
                Text(label)
                    .font(.system(.caption2, design: .monospaced))
                    .foregroundStyle(Theme.faint)
                    .textCase(.uppercase)
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 8) {
                        ForEach(items) { provider in
                            providerLogo(provider)
                        }
                    }
                }
            }
        }
    }

    private func providerLogo(_ provider: StreamingProvider) -> some View {
        AsyncImage(url: model.absoluteURL(provider.logoUrl)) { image in
            image.resizable().scaledToFill()
        } placeholder: {
            Theme.well
        }
        .frame(width: 40, height: 40)
        .clipShape(RoundedRectangle(cornerRadius: 9))
        .overlay(RoundedRectangle(cornerRadius: 9).strokeBorder(Theme.border, lineWidth: 1))
        .accessibilityLabel(Text(verbatim: provider.name))
    }
}

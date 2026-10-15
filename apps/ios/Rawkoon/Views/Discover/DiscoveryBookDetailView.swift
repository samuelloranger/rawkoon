import SwiftUI

/// Read-only detail for a bestseller not necessarily in the library: cover,
/// synopsis, external buy link, and an add-to-library action once enriched.
struct DiscoveryBookDetailView: View {
    @Environment(AppModel.self) private var model
    let book: BookDiscoveryBook

    @State private var adding = false
    @State private var added = false
    @State private var requesting = false
    @State private var requested = false

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 24) {
                hero
                actions
                summary
            }
            .padding(.horizontal, 20)
            .padding(.top, 8)
            .padding(.bottom, 40)
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .background(Theme.base)
        .navigationTitle(book.title)
        .navigationBarTitleDisplayMode(.inline)
    }

    /// A blurred cover bleeds full-width behind a sharp cover and title/author —
    /// the Now Playing "dusk glow" language, so the space beside the cover is
    /// filled by the art itself rather than left as dead margin.
    private var hero: some View {
        VStack(spacing: 14) {
            CachedAsyncImage(
                url: URL(string: book.coverUrl ?? ""),
                targetSize: CGSize(width: 200, height: 300)
            ) { image in
                image.resizable().scaledToFill()
            } placeholder: {
                Theme.raised.overlay(
                    Image(systemName: "book.closed")
                        .font(.system(size: 32))
                        .foregroundStyle(Theme.faint)
                )
            }
            .frame(width: 156, height: 234)
            .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: 14, style: .continuous)
                    .strokeBorder(.white.opacity(0.06), lineWidth: 1)
            )
            .shadow(color: .black.opacity(0.45), radius: 18, x: 0, y: 10)

            VStack(spacing: 6) {
                Text(rankLabel)
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(Theme.apricot)
                Text(book.title)
                    .font(.display(24))
                    .foregroundStyle(Theme.textStrong)
                    .multilineTextAlignment(.center)
                if let author = book.author {
                    Text(author)
                        .font(.subheadline)
                        .foregroundStyle(Theme.muted)
                        .multilineTextAlignment(.center)
                }
                if let meta = metaLine {
                    Text(meta)
                        .font(.caption)
                        .foregroundStyle(Theme.faint)
                }
            }
        }
        .frame(maxWidth: .infinity)
    }

    private var rankLabel: String {
        // Numeric interpolation only — no user-facing words to localize.
        "#\(book.rank)"
    }

    private var metaLine: String? {
        var parts: [String] = []
        if let year = book.publishedYear {
            parts.append(String(year))
        }
        if let host = sourceHost {
            parts.append(host)
        }
        return parts.isEmpty ? nil : parts.joined(separator: " · ")
    }

    private var sourceHost: String? {
        guard let s = book.sourceUrl, let u = URL(string: s), let h = u.host
        else { return nil }
        return h.replacingOccurrences(of: "www.", with: "")
    }

    /// Provider-agnostic external-link label — names the source's own host rather
    /// than hardcoding leslibraires (NYT points at a different domain).
    private var sourceLinkLabel: String {
        if let host = sourceHost {
            return String(localized: "View on \(host)")
        }
        return String(localized: "View source")
    }

    @ViewBuilder
    private var actions: some View {
        VStack(spacing: 12) {
            if book.alreadyInLibrary {
                Label("In library", systemImage: "checkmark.circle.fill")
                    .font(.subheadline.weight(.medium))
                    .foregroundStyle(Theme.seed)
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 12)
                    .background(Theme.seed.opacity(0.12), in: Capsule())
            } else if !model.isAdmin {
                requestAction
            } else if book.isbn13 != nil {
                Button {
                    Task { await add() }
                } label: {
                    HStack(spacing: 8) {
                        if adding {
                            ProgressView().tint(Theme.onAccent)
                        } else {
                            Image(systemName: added ? "checkmark" : "plus")
                        }
                        Text(added ? LocalizedStringKey("Added") : LocalizedStringKey("Add to library"))
                    }
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(Theme.onAccent)
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 14)
                    .background(Theme.apricot, in: Capsule())
                    .rawkoonMotion(RawkoonMotion.snappy, value: added)
                }
                // Forward only; the success toast already plays the haptic.
                .rawkoonCelebrate(
                    trigger: added,
                    ring: .roundedRect(cornerRadius: 24),
                    haptic: nil,
                    when: { !$0 && $1 }
                )
                .disabled(adding || added)
                .requiresConnection(model.isOffline)
            }

            if let sourceUrl = book.sourceUrl, let url = URL(string: sourceUrl) {
                Link(destination: url) {
                    Label(sourceLinkLabel, systemImage: "arrow.up.right")
                        .font(.subheadline)
                        .foregroundStyle(Theme.muted)
                }
            }
        }
    }

    /// Members request instead of adding. The request keys off a Google volume, so a
    /// pick the server could not match to one has nothing to request yet.
    @ViewBuilder
    private var requestAction: some View {
        if let state = book.request, !state.canRequestAgain {
            requestStatusLabel(status: state.status)
        } else if requested {
            requestStatusLabel(status: "pending")
        } else if book.volumeId != nil {
            Button {
                Task { await request() }
            } label: {
                HStack(spacing: 8) {
                    if requesting {
                        ProgressView().tint(Theme.onAccent)
                    } else {
                        Image(systemName: "plus")
                    }
                    Text(book.request == nil ? LocalizedStringKey("Request") : LocalizedStringKey("Request again"))
                }
                .font(.subheadline.weight(.semibold))
                .foregroundStyle(Theme.onAccent)
                .frame(maxWidth: .infinity)
                .padding(.vertical, 14)
                .background(Theme.apricot, in: Capsule())
            }
            .disabled(requesting)
            .requiresConnection(model.isOffline)
        }
    }

    private func requestStatusLabel(status: String) -> some View {
        let isDone = status == "approved" || status == "available"
        let tint = isDone ? Theme.seed : Theme.apricot
        return Group {
            switch status {
            case "approved": Label("Approved", systemImage: "checkmark.circle.fill")
            case "available": Label("Available", systemImage: "checkmark.circle.fill")
            default: Label("Requested", systemImage: "clock.fill")
            }
        }
        .font(.subheadline.weight(.medium))
        .foregroundStyle(tint)
        .frame(maxWidth: .infinity)
        .padding(.vertical, 12)
        .background(tint.opacity(0.12), in: Capsule())
    }

    @ViewBuilder
    private var summary: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("Summary")
                .font(.sectionTitle)
                .foregroundStyle(Theme.textStrong)
            if let overview = book.overview, !overview.isEmpty {
                Text(overview)
                    .font(.callout)
                    .foregroundStyle(Theme.text)
                    .lineSpacing(3)
            } else {
                Text("No summary yet for this title.")
                    .font(.callout)
                    .foregroundStyle(Theme.faint)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private func add() async {
        guard let client = model.api() else { return }
        adding = true
        defer { adding = false }
        do {
            try await client.addDiscoveryBook(book)
            added = true
            model.toast(String(localized: "Added to library."), style: .success)
            model.requestPushAuthorization()
        } catch {
            model.toast(settingsErrorMessage(error), style: .error)
        }
    }

    private func request() async {
        guard let client = model.api(), let volumeId = book.volumeId else { return }
        requesting = true
        defer { requesting = false }
        do {
            _ = try await client.createRequest(CreateRequestBody(
                tmdbId: nil,
                type: "book",
                title: book.title,
                posterUrl: book.coverUrl,
                year: book.publishedYear,
                googleVolumeId: volumeId,
                author: book.author
            ))
            requested = true
            model.toast(String(localized: "Requested — we'll notify you"), style: .success)
            model.requestPushAuthorization()
        } catch {
            let message = (error as? APIError)?.userMessage(unauthorized: String(localized: "Sign in required."))
                ?? String(localized: "Something went wrong.")
            model.toast(message, style: .error)
        }
    }
}

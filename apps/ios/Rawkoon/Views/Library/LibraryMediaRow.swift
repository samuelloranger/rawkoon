import RawkoonKit
import SwiftUI

/// A list-density library row: a mini 2:3 poster, title/year/type, and a
/// wrapping strip of curated meta pills (status, quality profile, size,
/// resolution+HDR) with an S·eps progress bar for shows. Codec, audio, and
/// language stay in the detail screen — the list stays scannable.
struct LibraryMediaRow: View {
    let media: LibraryMedia
    let posterURL: URL?
    let isBusy: Bool
    let menuItems: [MediaPosterMenuAction]
    let onMenuAction: (MediaPosterMenuAction) -> Void

    /// The mini poster grows with Dynamic Type instead of clipping.
    @ScaledMetric(relativeTo: .body) private var posterWidth: CGFloat = 46
    private var posterHeight: CGFloat {
        posterWidth * 3 / 2
    }

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            poster
            VStack(alignment: .leading, spacing: 6) {
                titleLine
                metaPills
                if let progress = episodeProgress {
                    episodeBar(progress)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            if isBusy {
                ProgressView().tint(Theme.apricot)
            }
        }
        .padding(12)
        .frame(minHeight: 44)
        .background(Theme.raised, in: RoundedRectangle(cornerRadius: 12))
        .overlay(RoundedRectangle(cornerRadius: 12).strokeBorder(Theme.border, lineWidth: 1))
        .contentShape(RoundedRectangle(cornerRadius: 12))
        .contextMenu {
            ForEach(menuItems, id: \.self) { menuButton($0) }
        }
    }

    private var poster: some View {
        Rectangle()
            .fill(Theme.well)
            .frame(width: posterWidth, height: posterHeight)
            .overlay {
                AsyncImage(url: posterURL) { image in
                    image.resizable().scaledToFill()
                } placeholder: {
                    Image(systemName: "photo")
                        .font(.caption)
                        .foregroundStyle(Theme.faint)
                }
            }
            .clipShape(RoundedRectangle(cornerRadius: 6))
            .overlay(
                RoundedRectangle(cornerRadius: 6).strokeBorder(.white.opacity(0.05), lineWidth: 1)
            )
    }

    private var titleLine: some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(media.title)
                .font(.subheadline.weight(.semibold))
                .foregroundStyle(Theme.textStrong)
                .lineLimit(2)
                .multilineTextAlignment(.leading)
            HStack(spacing: 6) {
                if let year = media.year {
                    Text(verbatim: String(year))
                        .font(.system(.caption2, design: .monospaced))
                }
                Text(media.type == "show" ? "Show" : "Movie")
                    .font(.caption2)
            }
            .foregroundStyle(Theme.muted)
        }
    }

    private var metaPills: some View {
        FlowLayout(spacing: 6) {
            statusBadge(media.status, tint: statusTint)
            if let profile = media.qualityProfile?.name, !profile.isEmpty {
                StatusBadge(verbatim: profile, tint: Theme.muted)
            }
            if let size = LibraryLedgerFormatters.formatBytes(media.totalSizeBytes) {
                StatusBadge(verbatim: size, tint: Theme.muted)
            }
            if let resolution = resolutionLabel {
                StatusBadge(verbatim: resolution, tint: Theme.muted)
            }
        }
    }

    @ViewBuilder
    private func episodeBar(_ progress: (seasons: Int, downloaded: Int, total: Int)) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(verbatim: episodeSummary(progress))
                .font(.system(.caption2, design: .monospaced))
                .foregroundStyle(Theme.muted)
            DuskProgress(value: Double(progress.downloaded) / Double(progress.total))
        }
    }

    // MARK: Derived data

    private var statusTint: Color {
        switch media.status {
        case "downloaded": Theme.seed
        case "downloading": Theme.importing
        default: Theme.muted
        }
    }

    /// Combines the source resolution with any HDR marker into one pill, e.g.
    /// "4K HDR10". Nil when the source resolution is unknown.
    private var resolutionLabel: String? {
        guard let res = LibraryLedgerFormatters.formatResolution(media.resolution) else { return nil }
        let hdr = media.hdrFormat?.trimmingCharacters(in: .whitespacesAndNewlines)
        if let hdr, !hdr.isEmpty {
            return "\(res) \(hdr)"
        }
        return res
    }

    /// Shows only: season count and downloaded/total episodes. Nil for movies
    /// and for shows the server reports no episodes for yet.
    private var episodeProgress: (seasons: Int, downloaded: Int, total: Int)? {
        guard media.type == "show", let total = media.episodeCount, total > 0 else { return nil }
        return (media.seasonCount ?? 0, media.downloadedEpisodeCount ?? 0, total)
    }

    private func episodeSummary(_ progress: (seasons: Int, downloaded: Int, total: Int)) -> String {
        if progress.seasons > 0 {
            return "S\(progress.seasons) · \(progress.downloaded)/\(progress.total)"
        }
        return "\(progress.downloaded)/\(progress.total)"
    }

    /// Mirrors the private `mediaPosterMenuButton` in Components.swift; the row
    /// needs its own context menu since that builder isn't visible here.
    @ViewBuilder
    private func menuButton(_ action: MediaPosterMenuAction) -> some View {
        switch action {
        case .toggleMonitored:
            Button { onMenuAction(action) } label: {
                Label("Toggle monitored", systemImage: "antenna.radiowaves.left.and.right")
            }
        case .searchReleases:
            Button { onMenuAction(action) } label: {
                Label("Search releases", systemImage: "magnifyingglass")
            }
        case .openDetails:
            Button { onMenuAction(action) } label: {
                Label("Open details", systemImage: "info.circle")
            }
        case .removeFromLibrary:
            Button(role: .destructive) { onMenuAction(action) } label: {
                Label("Remove from library", systemImage: "trash")
            }
        }
    }
}

/// A wrapping row: lays children left to right, breaking to a new line when the
/// current one is full. iOS 16+ `Layout`, safe on the iOS 18 deployment target,
/// so the meta pills wrap instead of clipping under large Dynamic Type.
private struct FlowLayout: Layout {
    var spacing: CGFloat = 6

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache _: inout ()) -> CGSize {
        let maxWidth = proposal.width ?? .infinity
        var rowWidth: CGFloat = 0
        var rowHeight: CGFloat = 0
        var totalWidth: CGFloat = 0
        var totalHeight: CGFloat = 0
        for subview in subviews {
            let size = subview.sizeThatFits(.unspecified)
            if rowWidth > 0, rowWidth + spacing + size.width > maxWidth {
                totalHeight += rowHeight + spacing
                totalWidth = max(totalWidth, rowWidth)
                rowWidth = size.width
                rowHeight = size.height
            } else {
                rowWidth += (rowWidth > 0 ? spacing : 0) + size.width
                rowHeight = max(rowHeight, size.height)
            }
        }
        totalHeight += rowHeight
        totalWidth = max(totalWidth, rowWidth)
        return CGSize(width: min(totalWidth, maxWidth), height: totalHeight)
    }

    func placeSubviews(in bounds: CGRect, proposal _: ProposedViewSize, subviews: Subviews, cache _: inout ()) {
        var x = bounds.minX
        var y = bounds.minY
        var rowHeight: CGFloat = 0
        for subview in subviews {
            let size = subview.sizeThatFits(.unspecified)
            if x > bounds.minX, x + size.width - bounds.minX > bounds.width {
                x = bounds.minX
                y += rowHeight + spacing
                rowHeight = 0
            }
            subview.place(at: CGPoint(x: x, y: y), anchor: .topLeading, proposal: ProposedViewSize(size))
            x += size.width + spacing
            rowHeight = max(rowHeight, size.height)
        }
    }
}

import RawkoonKit
import SwiftUI

struct ReleaseRow: View {
    @Environment(\.openURL) private var openURL

    let release: ReleaseItem
    let isGrabbing: Bool
    let isGrabbed: Bool
    let alreadyGrabbed: Bool
    let isBlocking: Bool
    let isBlocked: Bool
    let isAiPick: Bool
    let onGrab: () async -> Void
    let onBlock: () async -> Void

    private var isRejected: Bool {
        release.rejected == true
    }

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            // Left rail: brightness encodes the resolution tier, so quality reads
            // straight down the list edge without reading each footer.
            RoundedRectangle(cornerRadius: 2)
                .fill(tierColor)
                .frame(width: 4)
                .frame(maxHeight: .infinity)

            VStack(alignment: .leading, spacing: 10) {
                titleRow

                footerLine

                if isRejected {
                    rejectionReasons
                }

                if !isRejected, let breakdown = release.scoreBreakdown {
                    ScoreBreakdownPanel(breakdown: breakdown)
                }

                actionsRow
            }
        }
        .padding(12)
        .background(Theme.raised, in: RoundedRectangle(cornerRadius: 14))
        .overlay(
            RoundedRectangle(cornerRadius: 14)
                .strokeBorder(cardBorder, lineWidth: 1)
        )
    }

    /// Resolution tier → rail colour: brighter for higher quality.
    private var tierColor: Color {
        switch release.parsedQuality?.resolution {
        case let r? where r >= 2160:
            Theme.apricot
        case let r? where r >= 1080:
            Theme.apricotSoft
        case let r? where r >= 720:
            Theme.muted
        default:
            Theme.faint
        }
    }

    private var cardBorder: Color {
        if isRejected {
            return Theme.apricotSoft
        }
        if isAiPick {
            return Theme.apricot.opacity(0.5)
        }
        return Theme.border
    }

    /// Title with a leading sparkle when it is the AI pick; spans the full card.
    private var titleRow: some View {
        HStack(alignment: .firstTextBaseline, spacing: 5) {
            if isAiPick {
                Image(systemName: "sparkles")
                    .font(.system(size: 11))
                    .foregroundStyle(Theme.apricotSoft)
            }
            titleView
            Spacer(minLength: 0)
        }
    }

    /// Actions sit on their own row so the title can use the full card width:
    /// Block quiet on the left, Grab (the primary) reachable on the right.
    private var actionsRow: some View {
        HStack(spacing: 10) {
            blockButton
            Spacer(minLength: 8)
            grabButton
        }
    }

    @ViewBuilder
    private var titleView: some View {
        if let infoURL = release.infoURL, let url = URL(string: infoURL) {
            Button {
                openURL(url)
            } label: {
                Text(release.title)
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(Theme.textStrong)
                    .underline()
                    .lineLimit(2)
                    .multilineTextAlignment(.leading)
            }
            .buttonStyle(.plain)
        } else {
            Text(release.title)
                .font(.subheadline.weight(.semibold))
                .foregroundStyle(Theme.textStrong)
                .lineLimit(2)
        }
    }

    /// One quiet, colour-coded data line under the title: pack, quality, flags,
    /// size, seeders (green), score (apricot), then faint provenance. Wraps if long.
    private var footerLine: some View {
        FlowLayout(spacing: 8) {
            if let packLabel {
                footerRun(packLabel, Theme.apricotSoft)
            }
            if let resolution = release.parsedQuality?.resolution {
                footerRun("\(resolution)p", Theme.text, weight: .semibold)
            }
            if let secondarySpec {
                footerRun(secondarySpec, Theme.muted)
            }
            if let hdr = release.parsedQuality?.hdr, !hdr.isEmpty {
                footerRun(hdr, Theme.apricotSoft)
            }
            if release.freeleech == true {
                footerRun("FL", Theme.seed)
            }
            if let sizeText {
                footerRun(sizeText, Theme.text)
            }
            if release.seeders != nil || release.leechers != nil {
                seedRun
            }
            if let qualityScore = release.qualityScore {
                scoreRun(Int(qualityScore.rounded()))
            }
            if let metaText {
                footerRun(metaText, Theme.faint)
            }
        }
    }

    private func footerRun(_ text: String, _ color: Color, weight: Font.Weight = .regular) -> some View {
        Text(verbatim: text)
            .font(.system(.caption2, design: .monospaced).weight(weight))
            .foregroundStyle(color)
            .lineLimit(1)
            .fixedSize()
    }

    private var seedRun: some View {
        HStack(spacing: 3) {
            Image(systemName: "arrow.up")
                .font(.system(size: 8, weight: .bold))
            Text(verbatim: "\(release.seeders ?? 0)")
                .font(.system(.caption2, design: .monospaced))
            if let leechers = release.leechers {
                Text(verbatim: "/\(leechers)")
                    .font(.system(.caption2, design: .monospaced))
                    .foregroundStyle(Theme.muted)
            }
        }
        .foregroundStyle(seederColor)
        .fixedSize()
    }

    private func scoreRun(_ value: Int) -> some View {
        HStack(spacing: 3) {
            Image(systemName: "gauge.with.needle")
                .font(.system(size: 9))
            Text(verbatim: "\(value)")
                .font(.system(.caption2, design: .monospaced).weight(.semibold))
        }
        .foregroundStyle(Theme.apricotSoft)
        .fixedSize()
    }

    private var packLabel: String? {
        if release.isCompleteSeries == true {
            return "Intégrale"
        }
        if release.isSeasonPack == true {
            return "Season pack"
        }
        return nil
    }

    private var seederColor: Color {
        (release.seeders ?? 0) > 0 ? Theme.seed : Theme.muted
    }

    private var rejectionReasons: some View {
        VStack(alignment: .leading, spacing: 2) {
            let codes = release.qualityRejectionReasons ?? []
            if codes.isEmpty {
                if let reason = release.rejectionReason, !reason.isEmpty {
                    Text(reason)
                        .font(.caption2)
                        .foregroundStyle(Theme.terracotta)
                        .lineLimit(2)
                }
            } else {
                ForEach(codes, id: \.self) { code in
                    Text(ReleaseScoringLabels.rejectionLabel(code))
                        .font(.caption2)
                        .foregroundStyle(Theme.terracotta)
                        .lineLimit(2)
                }
            }
        }
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
                Group {
                    if alreadyGrabbed {
                        Label("Re-grab", systemImage: "arrow.triangle.2.circlepath")
                            .labelStyle(.titleAndIcon)
                    } else {
                        Label("Grab", systemImage: "arrow.down.circle")
                            .labelStyle(.titleOnly)
                    }
                }
                .font(.system(.caption, design: .monospaced).weight(.semibold))
                .foregroundStyle(Theme.onAccent)
                .padding(.horizontal, 14)
                .frame(minHeight: 44)
                .background(Theme.terracotta, in: Capsule())
            }
        }
    }

    @ViewBuilder
    private var blockButton: some View {
        if isBlocked {
            Label("Blocked", systemImage: "xmark.octagon.fill")
                .font(.system(.caption2, design: .monospaced))
                .foregroundStyle(Theme.muted)
                .lineLimit(1)
                .frame(minHeight: 44)
        } else if isBlocking {
            ProgressView()
                .tint(Theme.terracotta)
                .frame(width: 20, height: 20)
                .frame(minHeight: 44)
        } else {
            Button {
                Task { await onBlock() }
            } label: {
                Label("Block", systemImage: "xmark.octagon")
                    .font(.system(.caption2, design: .monospaced))
                    .lineLimit(1)
            }
            .buttonStyle(.bordered)
            .tint(Theme.muted)
            .controlSize(.small)
            .frame(minHeight: 44)
        }
    }

    /// Source and codec only (resolution is rendered separately as the anchor).
    private var secondarySpec: String? {
        guard let parsed = release.parsedQuality else {
            return nil
        }
        var parts: [String] = []
        if let source = parsed.source, !source.isEmpty {
            parts.append(source)
        }
        if let codec = parsed.codec, !codec.isEmpty {
            parts.append(codec)
        }
        return parts.isEmpty ? nil : parts.joined(separator: " · ")
    }

    private var sizeText: String? {
        guard let bytes = release.sizeBytes else {
            return nil
        }
        return ByteCountFormatter.string(fromByteCount: Int64(bytes), countStyle: .file)
    }

    /// Quiet provenance: indexer, age, languages — the least-scanned data.
    private var metaText: String? {
        var parts: [String] = []
        if let indexer = release.indexer, !indexer.isEmpty {
            parts.append(indexer)
        }
        if let age = release.age {
            parts.append("\(age)d")
        }
        if !release.languages.isEmpty {
            parts.append(release.languages.joined(separator: ", "))
        }
        return parts.isEmpty ? nil : parts.joined(separator: " · ")
    }
}

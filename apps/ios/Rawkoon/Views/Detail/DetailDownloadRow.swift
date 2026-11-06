import RawkoonKit
import SwiftUI

/// One download-history entry in the detail "Download history" section: live
/// progress for active grabs, failure/post-process reasons, and pause / resume /
/// remove controls. Actions are performed by the parent (admin-gated).
struct DetailDownloadRow: View {
    @Environment(AppModel.self) private var model

    let row: DownloadHistoryItem
    let busy: Bool
    let onAction: (String) -> Void
    /// Active-download removal: the parent confirms and offers "also delete files".
    let onRemoveActive: () -> Void
    let onDeleteEntry: () -> Void

    private var isActive: Bool {
        row.live != nil && !row.failed && row.completedAt == nil
    }

    private var isPaused: Bool {
        row.live?.state.lowercased().contains("pause") == true
    }

    /// Localized short date+time for when the release was grabbed, matching web.
    private var grabbedText: String? {
        guard !row.grabbedAt.isEmpty else { return nil }
        let withFraction = ISO8601DateFormatter()
        withFraction.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        let plain = ISO8601DateFormatter()
        plain.formatOptions = [.withInternetDateTime]
        guard let date = withFraction.date(from: row.grabbedAt) ?? plain.date(from: row.grabbedAt) else {
            return nil
        }
        return date.formatted(date: .numeric, time: .shortened)
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(alignment: .top, spacing: 8) {
                VStack(alignment: .leading, spacing: 2) {
                    Text(row.releaseTitle)
                        .font(.subheadline.weight(.medium))
                        .foregroundStyle(Theme.textStrong)
                        .lineLimit(2)
                    metaLine
                        .font(.system(.caption2, design: .monospaced))
                        .foregroundStyle(Theme.faint)
                }
                Spacer()
                if busy {
                    ProgressView().tint(Theme.muted)
                } else if isActive {
                    Button(LocalizedStringKey(isPaused ? "Resume" : "Pause")) {
                        onAction(isPaused ? "resume" : "pause")
                    }
                    .font(.caption)
                    .buttonStyle(.plain)
                    .foregroundStyle(Theme.apricot)
                    .requiresConnection(model.isOffline)
                }
            }

            if hasReleaseDetails {
                releaseDetails
            }

            if let live = row.live {
                DuskProgress(value: live.progress)
                HStack(spacing: 10) {
                    Text("↓ \(Formatters.speed(live.downloadSpeed, useAll: false))")
                    Text("\(Int(live.progress * 100))%")
                    LocalizedStatus.text(live.state)
                }
                .font(.system(.caption2, design: .monospaced))
                .foregroundStyle(Theme.muted)
            }

            if let failReason = row.failReason, !failReason.isEmpty {
                Text(failReason)
                    .font(.caption2)
                    .foregroundStyle(Theme.terracotta)
                    .lineLimit(2)
            } else if let postProcessError = row.postProcessError, !postProcessError.isEmpty {
                Text(postProcessError)
                    .font(.caption2)
                    .foregroundStyle(Theme.terracotta)
                    .lineLimit(2)
            } else if let destination = row.postProcessDestinationPath, !destination.isEmpty {
                Text(destination)
                    .font(.system(.caption2, design: .monospaced))
                    .foregroundStyle(Theme.faint)
                    .lineLimit(1)
                    .truncationMode(.middle)
            }

            if row.failed || row.postProcessError != nil || isActive {
                HStack {
                    Spacer()
                    Button("Remove") {
                        if isActive {
                            onRemoveActive()
                        } else {
                            onDeleteEntry()
                        }
                    }
                    .font(.caption)
                    .buttonStyle(.plain)
                    .foregroundStyle(Theme.terracotta)
                    .requiresConnection(model.isOffline)
                }
            }
        }
        .padding(10)
        .background(Theme.well, in: RoundedRectangle(cornerRadius: 10))
    }

    private var quality: ParsedQuality? {
        row.qualityParsed
    }

    /// Source and codec only; resolution is the anchor run, as in the release-search rows.
    private var secondarySpec: String? {
        let parts = [quality?.source, quality?.codec].compactMap(\.self).filter { !$0.isEmpty }
        return parts.isEmpty ? nil : parts.joined(separator: " · ")
    }

    private var sizeText: String? {
        guard let bytes = row.sizeBytes, bytes > 0 else { return nil }
        return ByteCountFormatter.string(fromByteCount: Int64(bytes), countStyle: .file)
    }

    private var hdrText: String? {
        guard let hdr = quality?.hdr, !hdr.isEmpty else { return nil }
        return hdr
    }

    /// Live swarm counts, only while the grab is still downloading.
    private var swarm: (seeds: Int?, peers: Int?)? {
        guard isActive, let live = row.live, live.seeds != nil || live.peers != nil else { return nil }
        return (live.seeds, live.peers)
    }

    private var hasReleaseDetails: Bool {
        quality?.resolution != nil || secondarySpec != nil || hdrText != nil || sizeText != nil || swarm != nil
    }

    /// Release-search footer styling: resolution, source · codec, HDR, size, live seeds/peers.
    private var releaseDetails: some View {
        ReleaseFlowLayout(spacing: 8) {
            if let resolution = quality?.resolution {
                detailRun("\(resolution)p", Theme.text, weight: .semibold)
            }
            if let secondarySpec {
                detailRun(secondarySpec, Theme.muted)
            }
            if let hdrText {
                detailRun(hdrText, Theme.apricotSoft)
            }
            if let sizeText {
                detailRun(sizeText, Theme.text)
            }
            if let swarm {
                HStack(spacing: 3) {
                    Image(systemName: "arrow.up")
                        .font(.system(size: 8, weight: .bold))
                    Text(verbatim: swarm.seeds.map(String.init) ?? "-")
                    Text(verbatim: "/\(swarm.peers.map(String.init) ?? "-")")
                        .foregroundStyle(Theme.muted)
                }
                .font(.system(.caption2, design: .monospaced))
                .foregroundStyle(Theme.seed)
                .fixedSize()
            }
        }
    }

    private func detailRun(_ text: String, _ color: Color, weight: Font.Weight = .regular) -> some View {
        Text(verbatim: text)
            .font(.system(.caption2, design: .monospaced).weight(weight))
            .foregroundStyle(color)
            .lineLimit(1)
            .fixedSize()
    }

    private var metaLine: Text {
        var parts: [Text] = []
        if let indexer = row.indexer, !indexer.isEmpty {
            parts.append(Text(verbatim: indexer))
        }
        if row.failed {
            parts.append(Text("Failed"))
        } else if row.completedAt != nil {
            parts.append(Text("Completed"))
        } else if row.live != nil {
            parts.append(Text("Active"))
        }
        if let grabbed = grabbedText {
            parts.append(Text(verbatim: grabbed))
        }
        if row.aiPicked == true {
            parts.append(Text("AI pick"))
        }
        guard let first = parts.first else {
            return Text(verbatim: "")
        }
        return parts.dropFirst().reduce(first) { $0 + Text(verbatim: " · ") + $1 }
    }
}

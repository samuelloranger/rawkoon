import RawkoonKit
import SwiftUI

/// One download-history entry in the detail "Download history" section: live
/// progress for active grabs, failure/post-process reasons, and pause / resume /
/// remove controls. Actions are performed by the parent (admin-gated).
struct DetailDownloadRow: View {
    let row: DownloadHistoryItem
    let busy: Bool
    let onAction: (String) -> Void
    let onDeleteEntry: () -> Void

    private var isActive: Bool {
        row.live != nil && !row.failed && row.completedAt == nil
    }

    private var isPaused: Bool {
        row.live?.state.lowercased().contains("pause") == true
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
                }
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
            }

            if row.failed || row.postProcessError != nil || isActive {
                HStack {
                    Spacer()
                    Button("Remove") {
                        if isActive {
                            onAction("remove")
                        } else {
                            onDeleteEntry()
                        }
                    }
                    .font(.caption)
                    .buttonStyle(.plain)
                    .foregroundStyle(Theme.terracotta)
                }
            }
        }
        .padding(10)
        .background(Theme.well, in: RoundedRectangle(cornerRadius: 10))
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
        if row.aiPicked == true {
            parts.append(Text("AI pick"))
        }
        guard let first = parts.first else {
            return Text(verbatim: "")
        }
        return parts.dropFirst().reduce(first) { $0 + Text(verbatim: " · ") + $1 }
    }
}

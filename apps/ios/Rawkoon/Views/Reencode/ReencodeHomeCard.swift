import RawkoonKit
import SwiftUI

/// Admin Home widget: current re-encode, the next items, and totals. HomeView owns the polling.
struct ReencodeHomeCard: View {
    let summary: TranscodeSummary

    var body: some View {
        NavigationLink {
            ReencodeAdminView()
        } label: {
            card
        }
        .buttonStyle(.plain)
    }

    private var card: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack {
                Label("Re-encode", systemImage: "gauge.with.dots.needle.67percent")
                    .font(.display(16)).foregroundStyle(Theme.textStrong)
                Spacer()
                ReencodeStateBadge(state: summary.state, windowStart: summary.windowStart)
            }
            if let job = summary.current {
                current(job)
            } else {
                Text("\(summary.queuedCount) queued").font(.subheadline).foregroundStyle(Theme.muted)
            }
            if !summary.next.isEmpty {
                upNext
            }
            Divider().overlay(Theme.border)
            HStack {
                Text("−\(Formatters.bytesEcho(summary.savedBytes30D)) saved · \(summary.doneCount30D) done")
                    .foregroundStyle(Theme.seed)
                if summary.failedCount > 0 {
                    Text("\(summary.failedCount) failed").foregroundStyle(Theme.terracotta)
                }
                Spacer()
                Image(systemName: "chevron.right").foregroundStyle(Theme.faint)
            }
            .font(.caption)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(16)
        .background(Theme.raised, in: RoundedRectangle(cornerRadius: 16))
        .overlay(RoundedRectangle(cornerRadius: 16).strokeBorder(Theme.border, lineWidth: 1))
    }

    private var upNext: some View {
        VStack(spacing: 4) {
            ForEach(summary.next) { job in
                HStack {
                    Text(verbatim: job.title).lineLimit(1)
                    Spacer()
                    Text(verbatim: Formatters.bytesEcho(job.sourceBytes))
                        .font(.system(.caption, design: .monospaced))
                }
                .font(.caption).foregroundStyle(Theme.muted)
            }
            let more = summary.queuedCount - summary.next.count
            if more > 0 {
                HStack {
                    Text("+ \(more) more")
                    Spacer()
                    Text(verbatim: "~" + (Formatters.durationCompact(Double(summary.queuedEtaSecs)) ?? "0m"))
                }
                .font(.caption).foregroundStyle(Theme.faint)
            }
        }
    }

    private func current(_ job: TranscodeJob) -> some View {
        let progress = job.live?.progress ?? job.progress ?? 0
        let fps = job.live?.fps.map { " · \(Int($0)) fps" } ?? ""
        return VStack(alignment: .leading, spacing: 6) {
            Text(verbatim: job.title)
                .font(.subheadline.weight(.semibold)).foregroundStyle(Theme.textStrong).lineLimit(1)
            Text(verbatim: "\(job.settings.codec.rawValue.uppercased()) · \(job.settings.encoder == .vaapi ? "GPU" : "CPU")")
                .font(.caption2).foregroundStyle(Theme.faint)
            DuskProgress(value: progress)
            HStack {
                Text(verbatim: "\(Int((progress * 100).rounded()))%" + fps)
                Spacer()
                if let eta = job.live?.etaSecs {
                    Text("~\(Formatters.durationCompact(Double(eta)) ?? "0m") left")
                }
            }
            .font(.caption).foregroundStyle(Theme.muted)
        }
    }
}

/// Queue state pill shared by the Home card and the admin screen.
struct ReencodeStateBadge: View {
    let state: String
    let windowStart: String

    var body: some View {
        switch state {
        case "running": StatusBadge(text: "Running", tint: Theme.seed)
        case "paused": StatusBadge(text: "Paused", tint: Theme.apricot)
        case "waiting_window": StatusBadge(text: "Waits for \(windowStart)", tint: Theme.importing)
        default: StatusBadge(text: "Idle", tint: Theme.muted)
        }
    }
}

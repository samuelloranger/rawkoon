import RawkoonKit
import SwiftUI

/// Always-visible summary at the bottom of the re-encode sheet.
struct ReencodeEstimateCard: View {
    let estimate: TranscodeEstimate?
    let mode: TranscodeMode
    let outdated: Bool
    let refining: Bool
    let canRefine: Bool
    let onRefine: () -> Void

    var body: some View {
        if let estimate {
            VStack(alignment: .leading, spacing: 10) {
                HStack(alignment: .firstTextBaseline, spacing: 8) {
                    Text(verbatim: (mode == .target ? "" : "≈ ") + Formatters.bytesEcho(estimate.totalEstimatedBytes))
                        .font(.display(26)).foregroundStyle(Theme.textStrong)
                    Text(verbatim: Formatters.bytesEcho(estimate.totalSourceBytes))
                        .strikethrough().font(.subheadline).foregroundStyle(Theme.faint)
                    Text(verbatim: "±\(estimate.rangePct)%").font(.caption).foregroundStyle(Theme.muted)
                    Spacer()
                    if let saved = savedBytes(estimate), saved > 0 {
                        Text("−\(Formatters.bytesEcho(String(saved))) saved")
                            .font(.caption.weight(.semibold)).foregroundStyle(Theme.seed).chipCapsule(tint: Theme.seed)
                    }
                }
                freesBar(estimate)
                HStack(alignment: .top) {
                    figure("Frees now", Formatters.bytesEcho(estimate.freesNowBytes), strong: true)
                    figure("After seeding", "+" + Formatters.bytesEcho(estimate.freesAfterSeedingBytes), strong: false)
                    figure("Est. time", "~" + (Formatters.durationCompact(Double(estimate.etaSecs)) ?? "0m"), strong: true)
                }
                let seeding = estimate.files.filter { $0.nlink > 1 }.count
                let growth = Formatters.bytesEcho(estimate.temporaryGrowthBytes)
                if seeding > 0 {
                    Text("\(seeding) files are still seeding. Their space frees when the torrents are removed; until then disk use grows by about \(growth).")
                        .font(.caption).foregroundStyle(Theme.apricotSoft)
                        .padding(10)
                        .background(Theme.apricot.opacity(0.08), in: RoundedRectangle(cornerRadius: 8))
                }
                HStack {
                    sourceLine(estimate)
                    Spacer()
                    if mode == .quality, canRefine {
                        Button(
                            estimate.source == "refined" && !outdated
                                ? LocalizedStringKey("Refine again") : LocalizedStringKey("Refine estimate"),
                            action: onRefine
                        )
                        .font(.caption.weight(.semibold)).tint(Theme.apricot).disabled(refining)
                    }
                }
            }
            .listRowBackground(Theme.well)
        } else {
            HStack {
                ProgressView().tint(Theme.muted)
                Text("Estimating…").foregroundStyle(Theme.muted)
            }
            .listRowBackground(Theme.well)
        }
    }

    private func savedBytes(_ e: TranscodeEstimate) -> Int64? {
        guard let src = Int64(e.totalSourceBytes), let est = Int64(e.totalEstimatedBytes) else { return nil }
        return src - est
    }

    private func freesBar(_ e: TranscodeEstimate) -> some View {
        let total = max(Double(e.totalSourceBytes) ?? 1, 1)
        let now = (Double(e.freesNowBytes) ?? 0) / total
        let later = (Double(e.freesAfterSeedingBytes) ?? 0) / total
        return GeometryReader { geo in
            HStack(spacing: 0) {
                Rectangle().fill(Theme.seed).frame(width: geo.size.width * now)
                Rectangle().fill(Theme.seed.opacity(0.35)).frame(width: geo.size.width * later)
                Spacer(minLength: 0)
            }
            .background(Theme.border)
            .clipShape(Capsule())
        }
        .frame(height: 6)
    }

    private func figure(_ title: LocalizedStringKey, _ value: String, strong: Bool) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(title).font(.system(.caption2, design: .monospaced)).foregroundStyle(Theme.faint)
            Text(verbatim: value).font(.subheadline.weight(strong ? .medium : .regular))
                .foregroundStyle(strong ? Theme.textStrong : Theme.muted)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    @ViewBuilder
    private func sourceLine(_ e: TranscodeEstimate) -> some View {
        Group {
            if refining {
                Text("Sampling clips…")
            } else if e.source == "target" {
                Text("Computed from bitrate × duration")
            } else if outdated {
                Text("Estimate outdated — settings changed").foregroundStyle(Theme.apricotSoft)
            } else if e.source == "refined" {
                Text("Refined · \(e.refinedFiles) files · \(e.refinedClips) clips")
            } else {
                Text("Rough estimate · bitrate model")
            }
        }
        .font(.caption).foregroundStyle(Theme.muted)
    }
}

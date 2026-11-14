import RawkoonKit
import SwiftUI

extension ReencodeAdminView {
    var statusSection: some View {
        Section("Status") {
            HStack {
                ReencodeStateBadge(state: summary?.state ?? "idle", windowStart: summary?.windowStart ?? "")
                Spacer()
                if let settings {
                    Button(settings.paused ? LocalizedStringKey("Resume queue") : LocalizedStringKey("Pause queue")) {
                        Task { await patch(TranscodeSettingsPatch(paused: !settings.paused)) }
                    }
                    .buttonStyle(.borderless)
                    .requiresConnection(model.isOffline)
                }
            }
            .listRowBackground(Theme.raised)
            if let settings {
                Toggle("Run window", isOn: Binding(
                    get: { settings.windowEnabled },
                    set: { value in Task { await patch(TranscodeSettingsPatch(windowEnabled: value)) } }
                ))
                .requiresConnection(model.isOffline)
                .listRowBackground(Theme.raised)
                if settings.windowEnabled {
                    timeRow("Start", settings.windowStart) { value in Task { await patch(TranscodeSettingsPatch(windowStart: value)) } }
                    timeRow("End", settings.windowEnd) { value in Task { await patch(TranscodeSettingsPatch(windowEnd: value)) } }
                }
            }
        }
    }

    var overviewSection: some View {
        Section("Totals") {
            if let s = summary {
                LabeledContent("Queued", value: queuedLine(s))
                LabeledContent("Saved (30 days)", value: Formatters.bytesEcho(s.savedBytes30D))
                LabeledContent("Frees after seeding", value: Formatters.bytesEcho(s.freesAfterSeedingBytes))
                LabeledContent("Failed", value: String(s.failedCount))
            }
        }
        .listRowBackground(Theme.raised)
    }

    func runningSection(_ job: TranscodeJob) -> some View {
        let progress = job.live?.progress ?? job.progress ?? 0
        let step = TranscodeMath.stepIndex(job.step)
        return Section("Now encoding") {
            VStack(alignment: .leading, spacing: 8) {
                Text(verbatim: job.title).font(.headline).foregroundStyle(Theme.textStrong)
                Text(verbatim: settingsSummary(job.settings)).font(.caption).foregroundStyle(Theme.muted)
                HStack(spacing: 4) {
                    stepChip("Encoding", index: 0, current: step, suffix: step == 0 ? " \(Int((progress * 100).rounded()))%" : "")
                    stepChip("Validating", index: 1, current: step, suffix: "")
                    stepChip("Replacing", index: 2, current: step, suffix: "")
                    stepChip("Rescan", index: 3, current: step, suffix: "")
                }
                DuskProgress(value: progress)
                HStack {
                    if let fps = job.live?.fps {
                        Text(verbatim: "\(Int(fps)) fps")
                    }
                    Spacer()
                    if let eta = job.live?.etaSecs {
                        Text("~\(Formatters.durationCompact(Double(eta)) ?? "0m") left")
                    }
                }
                .font(.caption).foregroundStyle(Theme.muted)
                Button("Cancel re-encode", role: .destructive) { confirmCancel = job }
                    .buttonStyle(.borderless)
                    .requiresConnection(model.isOffline)
            }
            .listRowBackground(Theme.raised)
        }
    }

    var queueSection: some View {
        Section("Queue") {
            if queued.isEmpty {
                Text("Nothing queued. Open a movie or show and choose Re-encode.")
                    .foregroundStyle(Theme.muted).listRowBackground(Theme.raised)
            }
            ForEach(Array(queued.enumerated()), id: \.element.id) { index, job in
                queueRow(job, number: index + 1)
            }
            .onMove { source, destination in
                Task { await move(in: queued, from: source, to: destination) }
            }
        }
    }

    func queueRow(_ job: TranscodeJob, number: Int) -> some View {
        HStack(alignment: .firstTextBaseline, spacing: 10) {
            Text(verbatim: "\(number)")
                .font(.footnote.monospacedDigit()).foregroundStyle(Theme.muted)
                .frame(minWidth: 18, alignment: .trailing)
            VStack(alignment: .leading, spacing: 2) {
                Text(verbatim: job.title).foregroundStyle(Theme.text)
                Text(verbatim: "\(settingsSummary(job.settings)) · \(Formatters.bytesEcho(job.sourceBytes))" + (job.estimatedBytes.map { " → ~\(Formatters.bytesEcho($0))" } ?? ""))
                    .font(.footnote).foregroundStyle(Theme.muted)
            }
        }
        .listRowBackground(Theme.raised)
        .swipeActions {
            Button("Remove", role: .destructive) { Task { await cancel(job) } }
                .requiresConnection(model.isOffline)
            Button("Move to top") { Task { await moveTop(job) } }.tint(Theme.apricot)
                .requiresConnection(model.isOffline)
        }
        .overlay(alignment: .trailing) {
            if busyIds.contains(job.id) {
                ProgressView().tint(Theme.muted)
            }
        }
    }

    var historySection: some View {
        Section("History") {
            if history.isEmpty {
                Text("No finished re-encodes in the last 30 days.").foregroundStyle(Theme.muted).listRowBackground(Theme.raised)
            }
            ForEach(history) { job in
                VStack(alignment: .leading, spacing: 2) {
                    HStack {
                        Text(verbatim: job.title).foregroundStyle(Theme.text)
                        Spacer()
                        resultBadge(job)
                    }
                    Text(verbatim: historyLine(job)).font(.footnote).foregroundStyle(Theme.muted)
                    if job.status == "failed", let error = job.error {
                        Text(verbatim: error).font(.caption).foregroundStyle(Theme.danger)
                    }
                }
                .listRowBackground(Theme.raised)
                .swipeActions {
                    if job.status == "failed" || job.status == "cancelled" {
                        Button("Retry") { Task { await retry(job) } }.tint(Theme.apricot)
                            .requiresConnection(model.isOffline)
                        Button("Delete", role: .destructive) { confirmDiscard = job }
                            .requiresConnection(model.isOffline)
                    }
                    if job.status == "done", (job.sourceNlink ?? 1) > 1 {
                        Button("Free space") { Task { await askFree(job) } }.tint(Theme.terracotta)
                            .requiresConnection(model.isOffline)
                    }
                }
            }
        }
    }

    var advancedSection: some View {
        Section {
            DisclosureGroup("Advanced") {
                if let settings {
                    Group {
                        Stepper(value: Binding(
                            get: { settings.ssimThreshold },
                            set: { value in Task { await patch(TranscodeSettingsPatch(ssimThreshold: value)) } }
                        ), in: 0.9 ... 0.999, step: 0.005) {
                            LabeledContent("SSIM mean threshold", value: String(format: "%.3f", settings.ssimThreshold))
                        }
                        Stepper(value: Binding(
                            get: { settings.ssimClipMin },
                            set: { value in Task { await patch(TranscodeSettingsPatch(ssimClipMin: value)) } }
                        ), in: 0.85 ... 0.999, step: 0.005) {
                            LabeledContent("SSIM per-clip minimum", value: String(format: "%.3f", settings.ssimClipMin))
                        }
                        // 0 means auto; a Stepper works on iPhone where a number pad has no Return key.
                        Stepper(value: Binding(
                            get: { settings.cpuThreads ?? 0 },
                            set: { value in Task { await patch(TranscodeSettingsPatch(cpuThreads: .some(value == 0 ? nil : value))) } }
                        ), in: 0 ... 64) {
                            LabeledContent("CPU threads", value: settings.cpuThreads.map(String.init) ?? String(localized: "Auto"))
                        }
                    }
                    .requiresConnection(model.isOffline)
                }
            }
            .listRowBackground(Theme.raised)
        }
    }

    // MARK: Pieces

    func timeRow(_ title: LocalizedStringKey, _ hhmm: String, onChange: @escaping (String) -> Void) -> some View {
        let minutes = TranscodeMath.minutes(fromHHMM: hhmm) ?? 0
        let date = Calendar.current.startOfDay(for: Date()).addingTimeInterval(TimeInterval(minutes * 60))
        return DatePicker(title, selection: Binding(
            get: { date },
            set: { value in
                let c = Calendar.current.dateComponents([.hour, .minute], from: value)
                onChange(TranscodeMath.hhmm(fromMinutes: (c.hour ?? 0) * 60 + (c.minute ?? 0)))
            }
        ), displayedComponents: .hourAndMinute)
            .requiresConnection(model.isOffline)
            .listRowBackground(Theme.raised)
    }

    func stepChip(_ title: LocalizedStringKey, index: Int, current: Int?, suffix: String) -> some View {
        let done = (current ?? -1) > index
        let now = current == index
        return HStack(spacing: 0) {
            Text(title)
            Text(verbatim: suffix)
        }
        .font(.caption2.weight(now ? .semibold : .regular))
        .foregroundStyle(now ? Theme.textStrong : done ? Theme.muted : Theme.faint)
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.top, 6)
        .overlay(alignment: .top) {
            Capsule().fill(now ? Theme.apricot : done ? Theme.seed : Theme.border).frame(height: 3)
        }
    }

    func resultBadge(_ job: TranscodeJob) -> some View {
        switch job.status {
        case "done": StatusBadge(text: (job.sourceNlink ?? 1) > 1 ? "Replaced · seeding" : "Replaced", tint: Theme.seed)
        case "failed": StatusBadge(text: "Failed", tint: Theme.danger)
        default: StatusBadge(text: "Cancelled", tint: Theme.muted)
        }
    }

    func settingsSummary(_ s: TranscodeJobSettings) -> String {
        var parts = [s.codec.rawValue.uppercased(), s.encoder == .vaapi ? "GPU" : "CPU"]
        switch s.resolution {
        case .keep: break
        case .p1080: parts.append("→1080p")
        case .p720: parts.append("→720p")
        }
        parts.append(s.mode == .target ? String(format: "%.1f Mbps", Double(s.targetVideoKbps ?? 0) / 1000) : s.preset.rawValue)
        if s.convertLosslessAudio {
            parts.append("EAC3")
        }
        return parts.joined(separator: " · ")
    }

    func queuedLine(_ s: TranscodeSummary) -> String {
        guard s.queuedCount > 0 else { return "0" }
        let eta = Formatters.durationCompact(Double(s.queuedEtaSecs)) ?? "0m"
        return "\(s.queuedCount) · ~\(eta) · \(Formatters.bytesEcho(s.queuedSourceBytes))"
    }

    func historyLine(_ job: TranscodeJob) -> String {
        guard job.status == "done", let out = job.outputBytes else {
            return String(localized: "\(Formatters.bytesEcho(job.sourceBytes)) kept")
        }
        var line = "\(Formatters.bytesEcho(job.sourceBytes)) → \(Formatters.bytesEcho(out))"
        if let ssim = job.ssimAvg {
            line += String(format: " · SSIM %.3f", ssim)
        }
        return line
    }
}

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

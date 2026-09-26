import RawkoonKit
import SwiftUI

/// A run of consecutive queued jobs from one enqueue.
struct ReencodeBatch: Identifiable {
    let id: String
    var jobs: [TranscodeJob]
}

/// Settings → Jobs & Releases → Re-encode: queue controls, running job, queue, history.
struct ReencodeAdminView: View {
    @Environment(AppModel.self) private var model
    @Environment(\.isActiveRootTab) private var isActiveRootTab

    @State private var active: [TranscodeJob] = []
    @State private var history: [TranscodeJob] = []
    @State private var settings: TranscodeQueueSettings?
    @State private var summary: TranscodeSummary?
    @State private var loading = true
    @State private var loadError: String?
    @State private var busyIds: Set<Int> = []
    @State private var confirmCancel: TranscodeJob?
    @State private var confirmClear = false

    private var running: TranscodeJob? {
        active.first { $0.status == "running" }
    }

    private var queued: [TranscodeJob] {
        active.filter { $0.status == "queued" }
    }

    /// Consecutive runs of the same batch, in queue order.
    private var batches: [ReencodeBatch] {
        var out: [ReencodeBatch] = []
        for job in queued {
            if let last = out.last, last.id == job.batchId {
                out[out.count - 1].jobs.append(job)
            } else {
                out.append(ReencodeBatch(id: job.batchId, jobs: [job]))
            }
        }
        return out
    }

    var body: some View {
        Group {
            if !model.isAdmin {
                ContentUnavailableView("Admin only", systemImage: "lock")
            } else {
                content
            }
        }
        .navigationTitle("Re-encode")
        .navigationBarTitleDisplayMode(.inline)
    }

    private var content: some View {
        Form {
            SettingsStateView(isLoading: loading, error: loadError, retry: { Task { await reloadAll() } }) {
                statusSection
                overviewSection
                if let running {
                    runningSection(running)
                }
                queueSections
                historySection
                advancedSection
            }
        }
        .scrollContentBackground(.hidden)
        .background(Theme.base)
        .tint(Theme.apricot)
        .toolbar {
            // Edit mode only reorders within a batch, so it is useless without one of 2+ jobs.
            if batches.contains(where: { $0.jobs.count > 1 }) {
                ToolbarItem(placement: .primaryAction) { EditButton() }
            }
            ToolbarItem(placement: .secondaryAction) {
                Button("Clear finished", role: .destructive) { confirmClear = true }
            }
        }
        // Tabs stay mounted on iPhone, so stop polling when this tab isn't the visible one.
        .task(id: isActiveRootTab) {
            guard isActiveRootTab else { return }
            await pollLoop()
        }
        .rawkoonConfirm(
            "Cancel this re-encode?",
            isPresented: Binding(get: { confirmCancel != nil }, set: {
                if !$0 {
                    confirmCancel = nil
                }
            }),
            presenting: confirmCancel
        ) { job in
            Button("Cancel re-encode", role: .destructive) { Task { await cancel(job) } }
        } message: { _ in
            Text("The original file is kept; the partial output is deleted.")
        }
        .rawkoonConfirm("Clear finished jobs?", isPresented: $confirmClear) {
            Button("Clear finished", role: .destructive) { Task { await clearHistory() } }
        }
    }

    // MARK: Sections

    private var statusSection: some View {
        Section("Status") {
            HStack {
                ReencodeStateBadge(state: summary?.state ?? "idle", windowStart: summary?.windowStart ?? "")
                Spacer()
                if let settings {
                    Button(settings.paused ? LocalizedStringKey("Resume queue") : LocalizedStringKey("Pause queue")) {
                        Task { await patch(TranscodeSettingsPatch(paused: !settings.paused)) }
                    }
                    .buttonStyle(.borderless)
                }
            }
            .listRowBackground(Theme.raised)
            if let settings {
                Toggle("Run window", isOn: Binding(
                    get: { settings.windowEnabled },
                    set: { value in Task { await patch(TranscodeSettingsPatch(windowEnabled: value)) } }
                ))
                .listRowBackground(Theme.raised)
                if settings.windowEnabled {
                    timeRow("Start", settings.windowStart) { value in Task { await patch(TranscodeSettingsPatch(windowStart: value)) } }
                    timeRow("End", settings.windowEnd) { value in Task { await patch(TranscodeSettingsPatch(windowEnd: value)) } }
                }
            }
        }
    }

    private var overviewSection: some View {
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

    private func runningSection(_ job: TranscodeJob) -> some View {
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
            }
            .listRowBackground(Theme.raised)
        }
    }

    @ViewBuilder
    private var queueSections: some View {
        if queued.isEmpty {
            Section("Queue") {
                Text("Nothing queued. Open a movie or show and choose Re-encode.")
                    .foregroundStyle(Theme.muted).listRowBackground(Theme.raised)
            }
        }
        ForEach(batches) { batch in
            Section {
                ForEach(batch.jobs) { job in
                    queueRow(job)
                }
                .onMove { source, destination in
                    Task { await move(in: batch.jobs, from: source, to: destination) }
                }
            } header: {
                HStack {
                    Text(verbatim: batch.jobs.first?.title.components(separatedBy: " — ").first ?? "")
                    Spacer()
                    Menu {
                        Button("Move batch to top") { Task { await moveBatchTop(batch.id) } }
                        Button("Remove all", role: .destructive) { Task { await removeBatch(batch.id) } }
                    } label: {
                        Image(systemName: "ellipsis.circle")
                    }
                }
            }
        }
    }

    private func queueRow(_ job: TranscodeJob) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(verbatim: job.title).foregroundStyle(Theme.text)
            Text(verbatim: "\(settingsSummary(job.settings)) · \(Formatters.bytesEcho(job.sourceBytes))" + (job.estimatedBytes.map { " → ~\(Formatters.bytesEcho($0))" } ?? ""))
                .font(.footnote).foregroundStyle(Theme.muted)
        }
        .listRowBackground(Theme.raised)
        .swipeActions {
            Button("Remove", role: .destructive) { Task { await cancel(job) } }
            Button("Move to top") { Task { await moveTop(job) } }.tint(Theme.apricot)
        }
        .overlay(alignment: .trailing) {
            if busyIds.contains(job.id) {
                ProgressView().tint(Theme.muted)
            }
        }
    }

    private var historySection: some View {
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
                        Text(verbatim: error).font(.caption).foregroundStyle(Theme.terracotta)
                    }
                }
                .listRowBackground(Theme.raised)
                .swipeActions {
                    if job.status == "failed" || job.status == "cancelled" {
                        Button("Retry") { Task { await retry(job) } }.tint(Theme.apricot)
                    }
                }
            }
        }
    }

    private var advancedSection: some View {
        Section {
            DisclosureGroup("Advanced") {
                if let settings {
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
            }
            .listRowBackground(Theme.raised)
        }
    }

    // MARK: Pieces

    private func timeRow(_ title: LocalizedStringKey, _ hhmm: String, onChange: @escaping (String) -> Void) -> some View {
        let minutes = TranscodeMath.minutes(fromHHMM: hhmm) ?? 0
        let date = Calendar.current.startOfDay(for: Date()).addingTimeInterval(TimeInterval(minutes * 60))
        return DatePicker(title, selection: Binding(
            get: { date },
            set: { value in
                let c = Calendar.current.dateComponents([.hour, .minute], from: value)
                onChange(TranscodeMath.hhmm(fromMinutes: (c.hour ?? 0) * 60 + (c.minute ?? 0)))
            }
        ), displayedComponents: .hourAndMinute)
            .listRowBackground(Theme.raised)
    }

    private func stepChip(_ title: LocalizedStringKey, index: Int, current: Int?, suffix: String) -> some View {
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

    private func resultBadge(_ job: TranscodeJob) -> some View {
        switch job.status {
        case "done": StatusBadge(text: (job.sourceNlink ?? 1) > 1 ? "Replaced · seeding" : "Replaced", tint: Theme.seed)
        case "failed": StatusBadge(text: "Failed", tint: Theme.terracotta)
        default: StatusBadge(text: "Cancelled", tint: Theme.muted)
        }
    }

    private func settingsSummary(_ s: TranscodeJobSettings) -> String {
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

    private func queuedLine(_ s: TranscodeSummary) -> String {
        guard s.queuedCount > 0 else { return "0" }
        let eta = Formatters.durationCompact(Double(s.queuedEtaSecs)) ?? "0m"
        return "\(s.queuedCount) · ~\(eta) · \(Formatters.bytesEcho(s.queuedSourceBytes))"
    }

    private func historyLine(_ job: TranscodeJob) -> String {
        guard job.status == "done", let out = job.outputBytes else {
            return String(localized: "\(Formatters.bytesEcho(job.sourceBytes)) kept")
        }
        var line = "\(Formatters.bytesEcho(job.sourceBytes)) → \(Formatters.bytesEcho(out))"
        if let ssim = job.ssimAvg {
            line += String(format: " · SSIM %.3f", ssim)
        }
        return line
    }

    // MARK: Data

    private func pollLoop() async {
        await reloadAll()
        while !Task.isCancelled {
            try? await Task.sleep(for: .seconds(running == nil ? 10 : 2))
            guard !Task.isCancelled else { return }
            await reloadActive()
        }
    }

    private func reloadAll() async {
        guard let client = model.api() else { loading = false; return }
        do {
            async let a = client.transcodeJobs(active: true)
            async let h = client.transcodeJobs(active: false)
            async let s = client.transcodeSettings()
            async let sum = client.transcodeSummary()
            active = try await a
            history = try await h
            settings = try await s
            summary = try await sum
            loadError = nil
        } catch {
            loadError = settingsErrorMessage(error)
        }
        loading = false
    }

    private func reloadActive() async {
        guard let client = model.api() else { return }
        let wasRunning = running?.id
        if let a = try? await client.transcodeJobs(active: true) {
            active = a
            loadError = nil
        }
        if let s = try? await client.transcodeSummary() {
            summary = s
        }
        // A job just finished: its result moved to history.
        if wasRunning != nil, running?.id != wasRunning, let h = try? await client.transcodeJobs(active: false) {
            history = h
        }
    }

    private func run(_ id: Int?, failure: String, _ action: (APIClient) async throws -> Void) async {
        guard let client = model.api() else { return }
        if let id {
            busyIds.insert(id)
        }
        defer {
            if let id {
                busyIds.remove(id)
            }
        }
        do {
            try await action(client)
        } catch {
            model.toast(failure, style: .error)
        }
        await refreshQuietly()
    }

    /// Refresh after an action without replacing the screen with an error view on a transient failure.
    private func refreshQuietly() async {
        guard let client = model.api() else { return }
        if let a = try? await client.transcodeJobs(active: true) {
            active = a
        }
        if let h = try? await client.transcodeJobs(active: false) {
            history = h
        }
        if let s = try? await client.transcodeSettings() {
            settings = s
        }
        if let sum = try? await client.transcodeSummary() {
            summary = sum
        }
    }

    private func patch(_ p: TranscodeSettingsPatch) async {
        await run(nil, failure: String(localized: "Couldn't update re-encode settings.")) { client in
            settings = try await client.updateTranscodeSettings(p)
        }
        // The server starts a job right after unpausing or lifting the window; show it without waiting for the poll.
        try? await Task.sleep(for: .seconds(1))
        await reloadActive()
    }

    private func cancel(_ job: TranscodeJob) async {
        let index = active.firstIndex { $0.id == job.id }
        if job.status == "queued", let index {
            active.remove(at: index)
        } // optimistic
        await run(job.id, failure: String(localized: "Couldn't cancel.")) { try await $0.cancelTranscodeJob(id: job.id) }
    }

    private func moveTop(_ job: TranscodeJob) async {
        await run(job.id, failure: String(localized: "Couldn't move.")) { try await $0.moveTranscodeJob(id: job.id, placement: nil) }
    }

    private func move(in jobs: [TranscodeJob], from source: IndexSet, to destination: Int) async {
        guard let move = TranscodeMath.movePlacement(ids: jobs.map(\.id), from: source, to: destination) else { return }
        await run(move.id, failure: String(localized: "Couldn't move.")) {
            try await $0.moveTranscodeJob(id: move.id, placement: move.placement)
        }
    }

    private func moveBatchTop(_ batchId: String) async {
        await run(nil, failure: String(localized: "Couldn't move.")) { try await $0.moveTranscodeBatchToTop(id: batchId) }
    }

    private func removeBatch(_ batchId: String) async {
        await run(nil, failure: String(localized: "Couldn't remove.")) { try await $0.removeTranscodeBatch(id: batchId) }
    }

    private func retry(_ job: TranscodeJob) async {
        await run(job.id, failure: String(localized: "Couldn't retry.")) { try await $0.retryTranscodeJob(id: job.id) }
    }

    private func clearHistory() async {
        await run(nil, failure: String(localized: "Couldn't clear history.")) { try await $0.clearTranscodeHistory() }
    }
}

import RawkoonKit
import SwiftUI

extension ReencodeAdminView {
    func pollLoop() async {
        await reloadAll()
        while !Task.isCancelled {
            try? await Task.sleep(for: .seconds(running == nil ? 10 : 2))
            guard !Task.isCancelled else { return }
            await reloadActive()
        }
    }

    func reloadAll() async {
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
            hasLoaded = true
        } catch {
            if !hasLoaded {
                loadError = settingsErrorMessage(error)
            }
        }
        loading = false
    }

    func reloadActive() async {
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

    func run(_ id: Int?, failure: String, _ action: (APIClient) async throws -> Void) async {
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
    func refreshQuietly() async {
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

    func patch(_ p: TranscodeSettingsPatch) async {
        await run(nil, failure: String(localized: "Couldn't update re-encode settings.")) { client in
            settings = try await client.updateTranscodeSettings(p)
        }
        // The server starts a job right after unpausing or lifting the window; show it without waiting for the poll.
        try? await Task.sleep(for: .seconds(1))
        await reloadActive()
    }

    func cancel(_ job: TranscodeJob) async {
        let index = active.firstIndex { $0.id == job.id }
        if job.status == "queued", let index {
            active.remove(at: index)
        } // optimistic
        await run(job.id, failure: String(localized: "Couldn't cancel.")) { try await $0.cancelTranscodeJob(id: job.id) }
    }

    func moveTop(_ job: TranscodeJob) async {
        await run(job.id, failure: String(localized: "Couldn't move.")) { try await $0.moveTranscodeJob(id: job.id, placement: nil) }
    }

    func move(in jobs: [TranscodeJob], from source: IndexSet, to destination: Int) async {
        guard let move = TranscodeMath.movePlacement(ids: jobs.map(\.id), from: source, to: destination) else { return }
        await run(move.id, failure: String(localized: "Couldn't move.")) {
            try await $0.moveTranscodeJob(id: move.id, placement: move.placement)
        }
    }

    func retry(_ job: TranscodeJob) async {
        await run(job.id, failure: String(localized: "Couldn't retry.")) { try await $0.retryTranscodeJob(id: job.id) }
    }

    /// Fetches what would go first, so the confirmation can warn about private trackers.
    func askFree(_ job: TranscodeJob) async {
        privateUnmet = 0
        if let client = model.api(), let preview = try? await client.transcodeFreeSourcePreview(id: job.id) {
            privateUnmet = preview.privateUnmet
        }
        confirmFree = job
    }

    func freeSource(_ job: TranscodeJob) async {
        guard let client = model.api() else { return }
        busyIds.insert(job.id)
        defer { busyIds.remove(job.id) }
        do {
            let reply = try await client.freeTranscodeSource(id: job.id)
            if reply.torrents > 0 {
                let size = ByteCountFormatter.string(fromByteCount: reply.freedBytes, countStyle: .file)
                model.toast(String(localized: "Removed \(reply.torrents) torrent(s), \(size) freed."), style: .success)
            } else {
                model.toast(String(localized: "No torrent is holding the old file any more."), style: .info)
            }
            await reloadAll()
        } catch {
            model.toast(String(localized: "Couldn't free the space."), style: .error)
        }
    }

    func discard(_ job: TranscodeJob) async {
        await run(job.id, failure: String(localized: "Couldn't delete.")) { try await $0.discardTranscodeJob(id: job.id) }
    }

    func clearHistory() async {
        await run(nil, failure: String(localized: "Couldn't clear history.")) { try await $0.clearTranscodeHistory() }
    }
}

import Foundation
import RawkoonKit

/// Owns the one live toast per added or searched title: "Searching…" first, then
/// updated in place to the outcome. Pure state lives in `LiveSearchTracker`; this
/// only renders it through `AppModel.toast` and talks to the server.
@MainActor
final class LiveSearchCoordinator {
    weak var appModel: AppModel?

    private var tracker = LiveSearchTracker()
    private var toastIds: [Int: UUID] = [:]
    private var waiters: [Int: Task<Void, Never>] = [:]
    private var cleanups: [Int: Task<Void, Never>] = [:]
    private var chooseOverrides: [Int: () -> Void] = [:]
    private var onScreenDetails: Set<Int> = []

    // MARK: Entry points

    /// After an add: a live toast when the server queued a search, otherwise one that says why not.
    func announceAdd(_ added: AddToLibraryResult, title: String) {
        announce(Announcement(
            mediaId: added.item.id, title: title, isShow: added.item.type == "show",
            queued: added.searchQueued == true, skippedReason: added.searchSkippedReason,
            digitalReleaseDate: added.digitalReleaseDate, confirmsPlainAdd: true
        ))
    }

    /// After approving a request: the same toasts, except an approval with nothing to say stays quiet.
    func announceApproved(_ approved: ApproveRequestResult, title: String, isShow: Bool) {
        guard let mediaId = approved.libraryMediaId else { return }
        announce(Announcement(
            mediaId: mediaId, title: title, isShow: isShow, queued: approved.searchQueued == true,
            skippedReason: approved.searchSkippedReason, digitalReleaseDate: nil, confirmsPlainAdd: false
        ))
    }

    private struct Announcement {
        let mediaId: Int
        let title: String
        let isShow: Bool
        let queued: Bool
        let skippedReason: String?
        let digitalReleaseDate: String?
        let confirmsPlainAdd: Bool
    }

    private func announce(_ note: Announcement) {
        let (mediaId, title, isShow) = (note.mediaId, note.title, note.isShow)
        chooseOverrides[mediaId] = nil
        if note.queued {
            track(mediaId: mediaId, title: title, isShow: isShow)
            return
        }
        let phase = LiveSearchTracker.phase(
            skipped: note.skippedReason, digitalReleaseDate: note.digitalReleaseDate
        )
        if phase == .added, !note.confirmsPlainAdd {
            return
        }
        let now = Date()
        // A result that beat this response wins over the "not searched" note.
        if let early = tracker.watch(mediaId: mediaId, title: title, isShow: isShow, now: now) {
            show(early)
        } else if let update = tracker.settle(mediaId: mediaId, phase: phase, now: now) {
            show(update)
        }
    }

    /// Runs a search call and feeds its answer into the item's toast. True when it grabbed.
    /// `onChoose` replaces the default "open the release sheet" action for this item.
    @discardableResult
    func search(
        mediaId: Int, title: String, isShow: Bool, onChoose: (() -> Void)? = nil,
        run: () async throws -> LibrarySearchResponse
    ) async -> Bool {
        track(mediaId: mediaId, title: title, isShow: isShow)
        chooseOverrides[mediaId] = onChoose
        do {
            let response = try await run()
            apply(Self.result(from: response, mediaId: mediaId))
            return response.grabbed
        } catch {
            apply(LiveSearchResult(mediaId: mediaId, outcome: .error))
            return false
        }
    }

    /// A finished search from the library stream or a search response.
    func apply(_ result: LiveSearchResult) {
        guard let update = tracker.apply(result, now: Date()) else { return }
        waiters[result.mediaId]?.cancel()
        waiters[result.mediaId] = nil
        show(update)
    }

    func suppressesGrabNotice(_ notice: GrabNotice) -> Bool {
        tracker.prune(now: Date())
        return tracker.suppressesGrabNotice(notice, now: Date())
    }

    // MARK: Detail screen hooks

    func detailAppeared(_ libraryId: Int) {
        onScreenDetails.insert(libraryId)
    }

    func detailDisappeared(_ libraryId: Int) {
        onScreenDetails.remove(libraryId)
    }

    // MARK: Internals

    private func track(mediaId: Int, title: String, isShow: Bool) {
        chooseOverrides[mediaId] = nil
        let update = tracker.start(mediaId: mediaId, title: title, isShow: isShow, now: Date())
        show(update)
        waiters[mediaId]?.cancel()
        waiters[mediaId] = Task { [weak self] in
            try? await Task.sleep(for: .seconds(LiveSearchTracker.stillSearchingAfter))
            guard !Task.isCancelled, let self else { return }
            if let nudge = tracker.giveUpWaiting(mediaId: mediaId, now: Date()) {
                show(nudge)
            }
        }
    }

    private static func result(from response: LibrarySearchResponse, mediaId: Int) -> LiveSearchResult {
        if let pushed = response.searchResult?.result {
            return pushed
        }
        if response.grabbed {
            return LiveSearchResult(mediaId: mediaId, outcome: .grabbed, releaseTitle: response.releaseTitle)
        }
        return LiveSearchResult(mediaId: mediaId, outcome: .noMatch, reason: response.reason)
    }

    private func show(_ update: LiveSearchUpdate) {
        guard let model = appModel else { return }
        let copy = LiveSearchCopy.render(update.phase, title: update.title)
        let id = model.toast(
            copy.message,
            style: copy.style,
            action: toastAction(for: update),
            duration: update.phase.lifetime ?? .infinity,
            showsProgress: update.phase == .searching,
            replacing: toastIds[update.mediaId]
        )
        toastIds[update.mediaId] = id
        scheduleCleanup(mediaId: update.mediaId, after: update.phase.lifetime)
    }

    /// Forgets an item's toast bookkeeping once its settled toast is gone.
    private func scheduleCleanup(mediaId: Int, after lifetime: TimeInterval?) {
        cleanups[mediaId]?.cancel()
        cleanups[mediaId] = nil
        guard let lifetime else { return }
        cleanups[mediaId] = Task { [weak self] in
            try? await Task.sleep(for: .seconds(lifetime + 1))
            guard !Task.isCancelled, let self else { return }
            toastIds[mediaId] = nil
            chooseOverrides[mediaId] = nil
            waiters[mediaId]?.cancel()
            waiters[mediaId] = nil
            cleanups[mediaId] = nil
        }
    }

    private func toastAction(for update: LiveSearchUpdate) -> ToastAction? {
        let mediaId = update.mediaId
        guard let label = LiveSearchCopy.actionLabel(update.phase.action) else { return nil }
        switch update.phase.action {
        case .none:
            return nil
        case .chooseRelease:
            return ToastAction(label: label) { [weak self] in self?.chooseRelease(mediaId: mediaId) }
        case let .grabNow(keys):
            return ToastAction(label: label) { [weak self] in self?.grabNow(mediaId: mediaId, targetKeys: keys) }
        case .searchNow:
            return ToastAction(label: label) { [weak self] in self?.searchNow(mediaId: mediaId) }
        }
    }

    /// Opens the release sheet for an item that was just added without searching.
    func openReleaseSheet(mediaId: Int) {
        chooseRelease(mediaId: mediaId)
    }

    private func chooseRelease(mediaId: Int) {
        guard let model = appModel else { return }
        if let override = chooseOverrides[mediaId] {
            override()
            return
        }
        model.releaseSheetRequest = mediaId
        // A detail already showing this item opens the sheet itself; otherwise open one.
        if !onScreenDetails.contains(mediaId) {
            model.deepLinkTarget = .media(libraryId: mediaId, season: nil, episode: nil, focusManagement: true)
        }
    }

    /// "Search now" after an add that skipped searching; the server only searches movies this way.
    private func searchNow(mediaId: Int) {
        guard let client = appModel?.api(), let update = tracker.restart(mediaId: mediaId, now: Date()) else { return }
        let title = update.title
        let isShow = tracker.isShow(mediaId)
        Task {
            await search(mediaId: mediaId, title: title, isShow: isShow) {
                try await client.searchMovie(id: mediaId)
            }
        }
    }

    /// Releases every held target of the item, one at a time, and reports the answer in the same toast.
    private func grabNow(mediaId: Int, targetKeys: [String]) {
        guard let client = appModel?.api(), let update = tracker.restart(mediaId: mediaId, now: Date()) else { return }
        show(update)
        Task {
            var grabbed = false
            var failures = 0
            for key in targetKeys {
                do {
                    grabbed = try await client.grabPendingNow(targetKey: key).grabbed || grabbed
                } catch {
                    failures += 1
                }
            }
            if failures == targetKeys.count {
                apply(LiveSearchResult(mediaId: mediaId, outcome: .error))
            } else if grabbed {
                apply(LiveSearchResult(mediaId: mediaId, outcome: .grabbed))
                if failures > 0, let partial = tracker.settle(mediaId: mediaId, phase: .grabNowPartial, now: Date()) {
                    show(partial)
                }
            } else {
                let phase: LiveSearchPhase = failures > 0 ? .grabNowPartial : .grabNowMiss
                if let update = tracker.settle(mediaId: mediaId, phase: phase, now: Date()) {
                    show(update)
                }
            }
        }
    }
}

/// Words for each phase of the live toast; the Kit keeps the cases, this keeps the copy.
enum LiveSearchCopy {
    struct Rendered {
        let message: String
        let style: Toast.Style
    }

    static func actionLabel(_ action: LiveSearchPhase.Action) -> String? {
        switch action {
        case .none: nil
        case .chooseRelease: String(localized: "Choose a release")
        case .grabNow: String(localized: "Grab now")
        case .searchNow: String(localized: "Search now")
        }
    }

    static func render(_ phase: LiveSearchPhase, title: String) -> Rendered {
        switch phase {
        case .searching:
            Rendered(message: String(localized: "Searching for \(title)…"), style: .info)
        case .stillSearching:
            Rendered(
                message: String(localized: "Still searching. You'll get a notification when it lands."),
                style: .info
            )
        case let .grabbed(release, quality):
            Rendered(message: grabbedMessage(release: release, quality: quality), style: .success)
        case let .held(minutes, _):
            Rendered(message: heldMessage(minutes: minutes, title: title), style: .info)
        case .noMatch:
            Rendered(message: String(localized: "No match for \(title)"), style: .info)
        default:
            renderRest(phase, title: title)
        }
    }

    private static func renderRest(_ phase: LiveSearchPhase, title: String) -> Rendered {
        switch phase {
        case let .notReleased(ymd):
            Rendered(message: notReleasedMessage(ymd: ymd), style: .info)
        case let .skipped(skip):
            Rendered(message: skippedMessage(skip, title: title), style: .info)
        case .added:
            Rendered(message: String(localized: "Added \(title)"), style: .success)
        case .grabNowMiss:
            Rendered(message: String(localized: "Nothing to grab yet for \(title)"), style: .info)
        case .grabNowPartial:
            Rendered(message: String(localized: "Grabbed some releases; others could not be"), style: .info)
        case let .failed(reason):
            Rendered(message: failedMessage(reason: reason), style: .error)
        default:
            Rendered(message: title, style: .info)
        }
    }

    private static func grabbedMessage(release: String?, quality: String?) -> String {
        guard let release else { return String(localized: "Grabbed a release") }
        guard let quality else { return String(localized: "Grabbed \(release)") }
        return String(localized: "Grabbed \(release) · \(quality)")
    }

    private static func heldMessage(minutes: Int?, title: String) -> String {
        guard let minutes else { return String(localized: "\(title) is held by the grab delay") }
        return String(localized: "\(title) held for \(minutes) min")
    }

    private static func notReleasedMessage(ymd: String?) -> String {
        guard let date = releaseDay(ymd) else { return String(localized: "Waiting for a digital release date") }
        return String(localized: "Waiting for its digital release (\(date))")
    }

    private static func skippedMessage(_ skip: LiveSearchSkip, title: String) -> String {
        switch skip {
        case .settingOff:
            String(localized: "Added \(title). Auto-grab is off.")
        case .overrideOff:
            String(localized: "Added \(title) without searching.")
        case .notMonitored:
            String(localized: "Added \(title), not monitored.")
        case let .notReleased(ymd):
            if let date = releaseDay(ymd) {
                String(localized: "Added \(title). Digital release \(date).")
            } else {
                String(localized: "Added \(title). No digital release date yet.")
            }
        }
    }

    private static func failedMessage(reason: String?) -> String {
        guard let reason, !reason.isEmpty else { return String(localized: "Search failed") }
        return String(localized: "Search failed: \(reason)")
    }

    /// A calendar day, so it is read and shown in UTC to avoid sliding a day.
    private static func releaseDay(_ ymd: String?) -> String? {
        guard let ymd else { return nil }
        let parser = DateFormatter()
        parser.locale = Locale(identifier: "en_US_POSIX")
        parser.timeZone = TimeZone(identifier: "UTC")
        parser.dateFormat = "yyyy-MM-dd"
        guard let date = parser.date(from: ymd) else { return nil }
        let out = DateFormatter()
        out.timeZone = TimeZone(identifier: "UTC")
        out.dateStyle = .medium
        return out.string(from: date)
    }
}

extension AppModel {
    /// Adds a title to the library and announces the search the server queued (or why it did not).
    /// `searchOnAdd` nil follows the server's auto-grab setting.
    @discardableResult
    func addTitleToLibrary(
        provisional: LibraryMedia, tmdbId: Int, type: String, title: String, searchOnAdd: Bool? = nil,
        announce: Bool = true, choice: AddChoice? = nil
    ) async throws -> LibraryMedia {
        guard let client = api() else { throw URLError(.notConnectedToInternet) }
        let captured = CapturedAdd()
        let item = try await serverStateStore.addToLibrary(provisional: provisional) {
            let result = try await client.addToLibrary(
                tmdbId: tmdbId, type: type, searchOnAdd: searchOnAdd, choice: choice
            )
            captured.set(result)
            return result.item
        }
        if announce, let result = captured.value {
            liveSearch.announceAdd(result, title: title)
        }
        return item
    }
}

/// Carries the add response out of the store's `@Sendable` request closure.
private final nonisolated class CapturedAdd: @unchecked Sendable {
    private let lock = NSLock()
    private var stored: AddToLibraryResult?

    var value: AddToLibraryResult? {
        lock.lock()
        defer { lock.unlock() }
        return stored
    }

    func set(_ result: AddToLibraryResult) {
        lock.lock()
        stored = result
        lock.unlock()
    }
}

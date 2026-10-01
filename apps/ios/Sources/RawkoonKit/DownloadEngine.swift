import Foundation

/// Which URLSession a transfer runs on: the fast default one while the app is on
/// screen, the background one otherwise.
public enum TransferLane: Equatable, Sendable {
    case foreground
    case background
}

/// What a finished task left behind, after the adapter moved and hashed the file.
public enum TaskOutcome: Equatable, Sendable {
    case stored(status: Int, bytes: Int, sha256: String?)
    case rejected(status: Int)
    case moveFailed
    case transportFailed
}

public enum EngineEvent: Equatable, Sendable {
    case start
    case cancel
    /// Tasks the background session already holds, listed once at launch.
    case existingBackgroundTasks(fileIds: Set<Int>)
    case progress(fileId: Int, lane: TransferLane, written: Int64, expected: Int64)
    case finished(fileId: Int, lane: TransferLane, outcome: TaskOutcome)
    case appForeground(Bool)
    case unmeteredWifi(Bool)
    /// A fresh look at the disk and the live task list, the way a relaunch sees them.
    case reconcile(onDiskBytes: [Int: Int], liveFileIds: Set<Int>)
    case retryFailed
    case grantsRefreshed
    case grantsRefreshFailed
    case replaceFiles([ManifestFile])
}

public enum EngineCommand: Equatable, Sendable {
    case startTask(fileId: Int, lane: TransferLane)
    case cancelTask(fileId: Int, lane: TransferLane)
    case deleteFile(fileId: Int)
}

/// Everything the UI reads, from one immutable value, so a chapter finishing
/// moves the plan and the progress together or not at all.
public struct DownloadSnapshot: Sendable {
    public let plan: DownloadPlan
    /// Never decreases while a download runs; a cancelled transfer does not dip it.
    public let overallFraction: Double
    /// Live transfers only; a chapter drops out the instant it verifies.
    public let chapterFractions: [Int: Double]
    public let revision: Int
}

/// Decides everything about a book's download: which chapters run, on which
/// lane, and how far along the book is. It performs no I/O; the app adapter
/// feeds it events and executes the commands it returns, so the whole
/// lifecycle (lost completions, stale callbacks, backgrounding) runs in tests.
public struct DownloadEngine: Sendable {
    public static let cellularConcurrency = 3
    public static let wifiConcurrency = 6
    public static let maxIdleReconciles = 3

    public private(set) var plan: DownloadPlan
    /// Bumped by every change; `structureRevision` only by changes beyond byte progress.
    public private(set) var revision = 0
    public private(set) var structureRevision = 0

    private struct Transfer: Equatable {
        var lane: TransferLane
        var fraction: Double
    }

    private var transfers: [Int: Transfer] = [:]
    private var isRunning = false
    private var isCancelled = false
    private var hasLoadedExisting = false
    private var isForeground: Bool
    private var unmeteredWifi = false
    private var highWater = 0.0
    private var idleReconcileAttempts = 0

    public init(files: [ManifestFile], isForeground: Bool = true) {
        plan = DownloadPlan(files: files)
        self.isForeground = isForeground
    }

    public var concurrencyLimit: Int {
        unmeteredWifi ? Self.wifiConcurrency : Self.cellularConcurrency
    }

    public var activeFileIds: Set<Int> {
        Set(transfers.keys)
    }

    public func lane(of fileId: Int) -> TransferLane? {
        transfers[fileId]?.lane
    }

    public var snapshot: DownloadSnapshot {
        DownloadSnapshot(
            plan: plan,
            overallFraction: plan.isComplete ? 1 : max(highWater, computedFraction),
            chapterFractions: transfers.mapValues(\.fraction),
            revision: revision
        )
    }

    /// True while a book sits within a chapter of done: where a lost completion
    /// looks like a stall. The adapter reconciles after a short delay.
    public var wantsIdleReconcile: Bool {
        isRunning && !isCancelled && idleReconcileAttempts < Self.maxIdleReconciles
            && plan.isNearlyDone && !plan.needsFreshGrants && !plan.hasGivenUp
    }

    public mutating func consumeIdleReconcile() -> Bool {
        guard wantsIdleReconcile else { return false }
        idleReconcileAttempts += 1
        return true
    }

    @discardableResult
    public mutating func handle(_ event: EngineEvent) -> [EngineCommand] {
        let before = signature
        let beforeFractions = transfers.mapValues(\.fraction)
        var commands: [EngineCommand] = []

        switch event {
        case .start:
            isRunning = true

        case .cancel:
            isCancelled = true
            isRunning = false
            commands = transfers.map { .cancelTask(fileId: $0.key, lane: $0.value.lane) }
                .sorted(by: Self.byFileId)
            transfers.removeAll()
            highWater = 0

        case let .existingBackgroundTasks(ids):
            for id in ids.sorted() where plan.states[id] != nil && plan.states[id] != .verified {
                transfers[id] = Transfer(lane: .background, fraction: 0)
                plan.apply(.started(fileId: id))
            }
            hasLoadedExisting = true

        case let .progress(fileId, lane, written, expected):
            applyProgress(fileId: fileId, lane: lane, written: written, expected: expected)

        case let .finished(fileId, lane, outcome):
            applyFinished(fileId: fileId, lane: lane, outcome: outcome, commands: &commands)

        case let .appForeground(foreground):
            isForeground = foreground
            if !foreground {
                handOffForegroundTransfers(commands: &commands)
            }

        case let .unmeteredWifi(wifi):
            unmeteredWifi = wifi

        case let .reconcile(onDiskBytes, liveFileIds):
            reconcile(onDiskBytes: onDiskBytes, liveFileIds: liveFileIds)

        case .retryFailed:
            plan.retryFailed()
            idleReconcileAttempts = 0

        case .grantsRefreshed:
            plan.acknowledgeFreshGrants()

        case .grantsRefreshFailed:
            plan.abandonAwaitingGrants()

        case let .replaceFiles(files):
            replaceFiles(files, commands: &commands)
        }

        pump(commands: &commands)
        highWater = max(highWater, computedFraction)
        stamp(before: before, beforeFractions: beforeFractions)
        return commands
    }

    // MARK: Transitions

    private mutating func applyProgress(fileId: Int, lane: TransferLane, written: Int64, expected: Int64) {
        guard !isCancelled, let state = plan.states[fileId], state != .verified else { return }
        let size = Int64(plan.files.first { $0.id == fileId }?.sizeBytes ?? 0)
        let denominator = expected > 0 ? expected : size
        guard denominator > 0 else { return }
        let fraction = min(1, max(0, Double(written) / Double(denominator)))
        if var transfer = transfers[fileId] {
            // A callback from the other lane is a leftover of a cancelled task.
            guard transfer.lane == lane else { return }
            transfer.fraction = max(transfer.fraction, fraction)
            transfers[fileId] = transfer
        } else if lane == .background {
            // A background task relaunched before the launch listing reached us.
            transfers[fileId] = Transfer(lane: .background, fraction: fraction)
            plan.apply(.started(fileId: fileId))
        }
    }

    private mutating func applyFinished(
        fileId: Int, lane: TransferLane, outcome: TaskOutcome, commands: inout [EngineCommand]
    ) {
        guard !isCancelled, plan.states[fileId] != nil else { return }
        let current = transfers[fileId]
        // A foreground completion we no longer track was cancelled by a hand-off.
        if lane == .foreground, current?.lane != .foreground {
            return
        }
        if let current, current.lane != lane {
            return
        }
        transfers.removeValue(forKey: fileId)
        guard plan.states[fileId] != .verified else { return }

        switch outcome {
        case let .stored(status, bytes, sha256):
            plan.apply(.completed(fileId: fileId, status: status, bytes: bytes, sha256: sha256))
            if (200 ... 299).contains(status), plan.states[fileId] != .verified {
                commands.append(.deleteFile(fileId: fileId))
            }
        case let .rejected(status):
            plan.apply(.completed(fileId: fileId, status: status, bytes: 0, sha256: nil))
        case .moveFailed, .transportFailed:
            plan.apply(.transportFailed(fileId: fileId))
        }
        if plan.states[fileId] == .verified {
            idleReconcileAttempts = 0
        }
    }

    /// Foreground transfers die when iOS suspends the app: cancel them and put
    /// the chapters back in the queue, without spending an attempt.
    private mutating func handOffForegroundTransfers(commands: inout [EngineCommand]) {
        for (fileId, transfer) in transfers.sorted(by: { $0.key < $1.key }) where transfer.lane == .foreground {
            commands.append(.cancelTask(fileId: fileId, lane: .foreground))
            transfers.removeValue(forKey: fileId)
            plan.requeue(fileId: fileId)
        }
    }

    private mutating func reconcile(onDiskBytes: [Int: Int], liveFileIds: Set<Int>) {
        // A slot whose task finished before it was ever listed would leak for good.
        for fileId in transfers.keys where !liveFileIds.contains(fileId) {
            transfers.removeValue(forKey: fileId)
        }
        plan.reconcile(onDiskBytes: onDiskBytes, liveFileIds: liveFileIds.union(transfers.keys))
        for fileId in plan.strandedInFlight(liveFileIds: liveFileIds.union(transfers.keys)) {
            plan.requeue(fileId: fileId)
        }
    }

    private mutating func replaceFiles(_ files: [ManifestFile], commands: inout [EngineCommand]) {
        let fresh = Set(files.map(\.id))
        guard fresh != Set(plan.files.map(\.id)) else { return }
        for (fileId, transfer) in transfers.sorted(by: { $0.key < $1.key }) where !fresh.contains(fileId) {
            commands.append(.cancelTask(fileId: fileId, lane: transfer.lane))
            transfers.removeValue(forKey: fileId)
        }
        plan = DownloadPlan(files: files)
        for fileId in transfers.keys.sorted() {
            plan.apply(.started(fileId: fileId))
        }
        highWater = 0
    }

    private mutating func pump(commands: inout [EngineCommand]) {
        guard isRunning, !isCancelled, hasLoadedExisting, !plan.needsFreshGrants else { return }
        let slots = concurrencyLimit - transfers.count
        guard slots > 0 else { return }
        let lane: TransferLane = isForeground ? .foreground : .background
        for fileId in plan.nextToStart(limit: slots) where transfers[fileId] == nil {
            transfers[fileId] = Transfer(lane: lane, fraction: 0)
            plan.apply(.started(fileId: fileId))
            commands.append(.startTask(fileId: fileId, lane: lane))
        }
    }

    // MARK: Derived state

    private var computedFraction: Double {
        plan.byteFraction(partial: transfers.mapValues(\.fraction))
    }

    private struct Signature: Equatable {
        var states: [Int: ChapterState]
        var needsGrants: Bool
        var lanes: [Int: TransferLane]
    }

    private var signature: Signature {
        Signature(states: plan.states, needsGrants: plan.needsFreshGrants, lanes: transfers.mapValues(\.lane))
    }

    private mutating func stamp(before: Signature, beforeFractions: [Int: Double]) {
        if signature != before {
            structureRevision += 1
            revision += 1
        } else if transfers.mapValues(\.fraction) != beforeFractions {
            revision += 1
        }
    }

    private static func byFileId(_ lhs: EngineCommand, _ rhs: EngineCommand) -> Bool {
        id(of: lhs) < id(of: rhs)
    }

    private static func id(of command: EngineCommand) -> Int {
        switch command {
        case let .startTask(id, _), let .cancelTask(id, _), let .deleteFile(id): id
        }
    }
}

import Foundation

/// On-disk snapshot of API GET responses, keyed by request path + query.
///
/// Screens paint from these snapshots before the network answers, and the
/// stored ETag lets the refetch come back as an empty 304. Each entry is two
/// files: the raw body, and a small metadata record that repeats the full key so
/// a hash collision reads as a miss instead of another endpoint's data.
public final class ResponseCache: @unchecked Sendable {
    public struct Entry: Sendable, Equatable {
        public let data: Data
        public let etag: String?
        public let fetchedAt: Date

        public func age(now: Date) -> TimeInterval {
            now.timeIntervalSince(fetchedAt)
        }
    }

    private struct Meta: Codable {
        let key: String
        let etag: String?
        let fetchedAt: Date
        let bytes: Int
    }

    public let directory: URL
    private let maxEntryBytes: Int
    private let maxTotalBytes: Int
    private let now: @Sendable () -> Date
    private let lock = NSLock()
    /// Nil until first needed, so construction never touches the disk.
    private var totalBytes: Int?
    /// Set on sign-out: requests still in flight must not write the old
    /// account's responses back after the wipe.
    private var isInvalidated = false

    public init(
        directory: URL,
        maxEntryBytes: Int = 4 * 1024 * 1024,
        maxTotalBytes: Int = 64 * 1024 * 1024,
        now: @escaping @Sendable () -> Date = Date.init
    ) {
        self.directory = directory
        self.maxEntryBytes = maxEntryBytes
        self.maxTotalBytes = maxTotalBytes
        self.now = now
    }

    public func entry(for key: String) -> Entry? {
        lock.lock()
        defer { lock.unlock() }
        guard let meta = readMeta(key), let data = try? Data(contentsOf: bodyURL(key)) else {
            return nil
        }
        return Entry(data: data, etag: meta.etag, fetchedAt: meta.fetchedAt)
    }

    public func store(_ data: Data, etag: String?, for key: String) {
        guard data.count <= maxEntryBytes else {
            remove(key)
            return
        }
        lock.lock()
        defer { lock.unlock() }
        guard !isInvalidated else { return }
        let before = currentTotal()
        ensureDirectory()
        let previous = readMeta(key)?.bytes ?? 0
        let meta = Meta(key: key, etag: etag, fetchedAt: now(), bytes: data.count)
        do {
            try data.write(to: bodyURL(key), options: .atomic)
            try JSONEncoder().encode(meta).write(to: metaURL(key), options: .atomic)
        } catch {
            removeFiles(key)
            return
        }
        let total = before - previous + data.count
        totalBytes = total
        if total > maxTotalBytes {
            evict()
        }
    }

    /// A 304 confirmed the stored body is still current.
    public func markRevalidated(_ key: String) {
        lock.lock()
        defer { lock.unlock() }
        guard !isInvalidated, let meta = readMeta(key) else { return }
        let refreshed = Meta(key: key, etag: meta.etag, fetchedAt: now(), bytes: meta.bytes)
        try? JSONEncoder().encode(refreshed).write(to: metaURL(key), options: .atomic)
    }

    public func remove(_ key: String) {
        lock.lock()
        defer { lock.unlock() }
        if let bytes = readMeta(key)?.bytes, let total = totalBytes {
            totalBytes = max(total - bytes, 0)
        }
        removeFiles(key)
    }

    public func removeAll() {
        lock.lock()
        defer { lock.unlock() }
        try? FileManager.default.removeItem(at: directory)
        totalBytes = 0
    }

    /// Stops this instance writing for good; reads still work until the wipe.
    public func invalidate() {
        lock.lock()
        isInvalidated = true
        lock.unlock()
    }

    // MARK: Private (callers hold `lock`)

    private func readMeta(_ key: String) -> Meta? {
        guard
            let raw = try? Data(contentsOf: metaURL(key)),
            let meta = try? JSONDecoder().decode(Meta.self, from: raw),
            meta.key == key
        else { return nil }
        return meta
    }

    private func removeFiles(_ key: String) {
        try? FileManager.default.removeItem(at: bodyURL(key))
        try? FileManager.default.removeItem(at: metaURL(key))
    }

    private func ensureDirectory() {
        guard !FileManager.default.fileExists(atPath: directory.path) else { return }
        try? FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        var url = directory
        var values = URLResourceValues()
        values.isExcludedFromBackup = true
        try? url.setResourceValues(values)
    }

    private func allMetas() -> [(stem: String, meta: Meta)] {
        let names = (try? FileManager.default.contentsOfDirectory(atPath: directory.path)) ?? []
        return names.compactMap { name in
            guard name.hasSuffix(".meta") else { return nil }
            let url = directory.appendingPathComponent(name)
            guard let raw = try? Data(contentsOf: url),
                  let meta = try? JSONDecoder().decode(Meta.self, from: raw)
            else { return nil }
            return (String(name.dropLast(5)), meta)
        }
    }

    private func currentTotal() -> Int {
        if let totalBytes {
            return totalBytes
        }
        let total = allMetas().reduce(0) { $0 + $1.meta.bytes }
        totalBytes = total
        return total
    }

    /// Drops the least recently fetched entries until the cache is back under
    /// three quarters of its cap, so the next few stores don't evict again.
    private func evict() {
        var total = currentTotal()
        let target = maxTotalBytes * 3 / 4
        for (stem, meta) in allMetas().sorted(by: { $0.meta.fetchedAt < $1.meta.fetchedAt }) {
            guard total > target else { break }
            try? FileManager.default.removeItem(at: directory.appendingPathComponent(stem + ".body"))
            try? FileManager.default.removeItem(at: directory.appendingPathComponent(stem + ".meta"))
            total -= meta.bytes
        }
        totalBytes = max(total, 0)
    }

    private func bodyURL(_ key: String) -> URL {
        directory.appendingPathComponent(Self.stem(key) + ".body")
    }

    private func metaURL(_ key: String) -> URL {
        directory.appendingPathComponent(Self.stem(key) + ".meta")
    }

    /// FNV-1a: stable across launches and platforms, unlike `Hasher`.
    static func stem(_ key: String) -> String {
        var hash: UInt64 = 0xCBF2_9CE4_8422_2325
        for byte in key.utf8 {
            hash ^= UInt64(byte)
            hash = hash &* 0x0000_0100_0000_01B3
        }
        return String(hash, radix: 16)
    }

    /// One directory per server, so switching servers never shows the other's data.
    public static func namespace(forServer server: String) -> String {
        "s" + stem(server.trimmingCharacters(in: .whitespacesAndNewlines).lowercased())
    }
}

/// Which GET responses are worth persisting.
public enum ResponseCachePolicy {
    /// Live counters polled every few seconds, searches, and signed-URL
    /// manifests: a stale copy is useless or wrong, and writing them is churn.
    private static let excludedPrefixes = [
        "/api/dashboard/downloads/speed",
        "/api/dashboard/jellyfin/now-playing",
        "/api/transcode/summary",
        "/api/transcode/jobs",
        "/api/library/migrate",
        "/api/books/editions/",
        "/api/notifications/unread-count",
    ]

    public static func isCacheable(path: String) -> Bool {
        let bare = path.split(separator: "?", maxSplits: 1).first.map(String.init) ?? path
        if excludedPrefixes.contains(where: { bare.hasPrefix($0) }) {
            return false
        }
        return !bare.contains("/search") && !bare.hasSuffix("/estimate")
    }
}

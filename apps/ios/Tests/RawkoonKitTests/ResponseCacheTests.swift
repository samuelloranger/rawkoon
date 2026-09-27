import Foundation
@testable import RawkoonKit
import Testing

/// Clock the tests advance by hand, so eviction order is deterministic.
private final class TestClock: @unchecked Sendable {
    private let lock = NSLock()
    private var current = Date(timeIntervalSince1970: 1_000_000)

    func now() -> Date {
        lock.lock()
        defer { lock.unlock() }
        return current
    }

    func advance(_ seconds: TimeInterval) {
        lock.lock()
        current += seconds
        lock.unlock()
    }
}

private func makeCache(
    maxEntryBytes: Int = 1024,
    maxTotalBytes: Int = 10 * 1024,
    clock: TestClock = TestClock()
) -> (ResponseCache, URL) {
    let dir = FileManager.default.temporaryDirectory
        .appendingPathComponent("response-cache-tests-\(UUID().uuidString)", isDirectory: true)
    let cache = ResponseCache(
        directory: dir,
        maxEntryBytes: maxEntryBytes,
        maxTotalBytes: maxTotalBytes,
        now: { clock.now() }
    )
    return (cache, dir)
}

struct ResponseCacheTests {
    @Test func missBeforeStore() {
        let (cache, _) = makeCache()
        #expect(cache.entry(for: "/api/library") == nil)
    }

    @Test func roundTripsBodyEtagAndTime() {
        let clock = TestClock()
        let (cache, _) = makeCache(clock: clock)
        let body = Data(#"{"items":[]}"#.utf8)
        cache.store(body, etag: #"W/"abc""#, for: "/api/library?page=1")
        let entry = cache.entry(for: "/api/library?page=1")
        #expect(entry?.data == body)
        #expect(entry?.etag == #"W/"abc""#)
        #expect(entry?.fetchedAt == clock.now())
    }

    @Test func keysAreExact() {
        let (cache, _) = makeCache()
        cache.store(Data("a".utf8), etag: nil, for: "/api/library?page=1")
        #expect(cache.entry(for: "/api/library?page=2") == nil)
    }

    @Test func survivesANewInstance() {
        let (cache, dir) = makeCache()
        cache.store(Data("kept".utf8), etag: "e", for: "/api/auth/me")
        let reopened = ResponseCache(directory: dir)
        #expect(reopened.entry(for: "/api/auth/me")?.data == Data("kept".utf8))
    }

    @Test func overwriteReplacesBody() {
        let (cache, _) = makeCache()
        cache.store(Data("old".utf8), etag: "1", for: "k")
        cache.store(Data("new".utf8), etag: "2", for: "k")
        #expect(cache.entry(for: "k")?.data == Data("new".utf8))
        #expect(cache.entry(for: "k")?.etag == "2")
    }

    @Test func revalidationRefreshesTimeOnly() {
        let clock = TestClock()
        let (cache, _) = makeCache(clock: clock)
        cache.store(Data("body".utf8), etag: "e", for: "k")
        clock.advance(600)
        cache.markRevalidated("k")
        let entry = cache.entry(for: "k")
        #expect(entry?.fetchedAt == clock.now())
        #expect(entry?.data == Data("body".utf8))
        #expect(entry?.age(now: clock.now()) == 0)
    }

    @Test func oversizedBodyIsNotStoredAndDropsOldCopy() {
        let (cache, _) = makeCache(maxEntryBytes: 8)
        cache.store(Data("small".utf8), etag: nil, for: "k")
        cache.store(Data(repeating: 1, count: 9), etag: nil, for: "k")
        #expect(cache.entry(for: "k") == nil)
    }

    @Test func evictsLeastRecentlyFetchedPastCap() {
        let clock = TestClock()
        let (cache, _) = makeCache(maxEntryBytes: 400, maxTotalBytes: 1000, clock: clock)
        for index in 0 ..< 3 {
            cache.store(Data(repeating: UInt8(index), count: 400), etag: nil, for: "k\(index)")
            clock.advance(1)
        }
        // 1200 bytes > 1000: oldest go until under 750.
        #expect(cache.entry(for: "k0") == nil)
        #expect(cache.entry(for: "k1") == nil)
        #expect(cache.entry(for: "k2") != nil)
    }

    @Test func removeAllWipesEverything() {
        let (cache, dir) = makeCache()
        cache.store(Data("x".utf8), etag: nil, for: "k")
        cache.removeAll()
        #expect(cache.entry(for: "k") == nil)
        #expect(!FileManager.default.fileExists(atPath: dir.path))
        cache.store(Data("y".utf8), etag: nil, for: "k")
        #expect(cache.entry(for: "k")?.data == Data("y".utf8))
    }

    @Test func invalidatedCacheIgnoresLateWrites() {
        let (cache, _) = makeCache()
        cache.invalidate()
        cache.removeAll()
        cache.store(Data("late".utf8), etag: nil, for: "k")
        #expect(cache.entry(for: "k") == nil)
    }

    @Test func firstStoreOfALaunchCountsExistingBytesOnce() {
        let clock = TestClock()
        let (seed, dir) = makeCache(maxEntryBytes: 400, maxTotalBytes: 1000, clock: clock)
        seed.store(Data(repeating: 1, count: 400), etag: nil, for: "a")
        clock.advance(1)
        // A fresh instance learns the total lazily; 400 + 400 is under the cap.
        let reopened = ResponseCache(directory: dir, maxEntryBytes: 400, maxTotalBytes: 1000, now: { clock.now() })
        reopened.store(Data(repeating: 2, count: 400), etag: nil, for: "b")
        #expect(reopened.entry(for: "a") != nil)
        #expect(reopened.entry(for: "b") != nil)
    }

    @Test func removeDropsOneEntry() {
        let (cache, _) = makeCache()
        cache.store(Data("x".utf8), etag: nil, for: "a")
        cache.store(Data("y".utf8), etag: nil, for: "b")
        cache.remove("a")
        #expect(cache.entry(for: "a") == nil)
        #expect(cache.entry(for: "b") != nil)
    }

    @Test func stemIsStableAndNamespaceIgnoresCaseAndSpace() {
        #expect(ResponseCache.stem("/api/library") == ResponseCache.stem("/api/library"))
        #expect(ResponseCache.stem("/api/library") != ResponseCache.stem("/api/books"))
        #expect(
            ResponseCache.namespace(forServer: " https://Rawkoon.example ")
                == ResponseCache.namespace(forServer: "https://rawkoon.example")
        )
    }
}

struct ResponseCachePolicyTests {
    @Test func cachesBrowsingEndpoints() {
        #expect(ResponseCachePolicy.isCacheable(path: "/api/library?page=1&limit=50"))
        #expect(ResponseCachePolicy.isCacheable(path: "/api/auth/me"))
        #expect(ResponseCachePolicy.isCacheable(path: "/api/books?limit=100&page=1"))
        #expect(ResponseCachePolicy.isCacheable(path: "/api/books/12/editions/audiobook/files"))
        #expect(ResponseCachePolicy.isCacheable(path: "/api/dashboard/upcoming"))
    }

    @Test func skipsLiveAndSearchEndpoints() {
        #expect(!ResponseCachePolicy.isCacheable(path: "/api/dashboard/downloads/speed"))
        #expect(!ResponseCachePolicy.isCacheable(path: "/api/transcode/summary"))
        #expect(!ResponseCachePolicy.isCacheable(path: "/api/books/editions/63/manifest"))
        #expect(!ResponseCachePolicy.isCacheable(path: "/api/books/search?q=dune"))
        #expect(!ResponseCachePolicy.isCacheable(path: "/api/books/9/editions/audiobook/search"))
        #expect(!ResponseCachePolicy.isCacheable(path: "/api/notifications/unread-count"))
    }
}

struct NetworkFailureTests {
    @Test func classifiesCodes() {
        #expect(NetworkFailure.classify(urlErrorCode: -1009) == .offline)
        #expect(NetworkFailure.classify(urlErrorCode: -1020) == .offline)
        #expect(NetworkFailure.classify(urlErrorCode: -1001) == .timedOut)
        #expect(NetworkFailure.classify(urlErrorCode: -1004) == .unreachable)
        #expect(NetworkFailure.classify(urlErrorCode: -1005) == .unreachable)
        #expect(NetworkFailure.classify(urlErrorCode: -1200) == .unreachable)
    }
}

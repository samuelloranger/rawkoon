import Foundation
@testable import RawkoonKit
import Testing

struct EditionDirectoryTests {
    private func makeEdition() throws -> URL {
        let dir = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        try Data("{}".utf8).write(to: dir.appendingPathComponent("manifest.json"))
        try Data(count: 8).write(to: dir.appendingPathComponent("1.mp3"))
        return dir
    }

    @Test func removesDirectoryAndFiles() throws {
        let dir = try makeEdition()
        #expect(EditionDirectory.remove(dir, markers: ["manifest.json"]))
        #expect(!FileManager.default.fileExists(atPath: dir.path))
    }

    @Test func missingDirectoryCountsAsRemoved() {
        let dir = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        #expect(EditionDirectory.remove(dir, markers: ["manifest.json"]))
    }

    @Test func failedDirectoryRemovalStillDropsManifest() throws {
        let dir = try makeEdition()
        defer { try? FileManager.default.removeItem(at: dir) }
        struct Stuck: Error {}
        let removed = EditionDirectory.remove(dir, markers: ["manifest.json"]) { url in
            if url.lastPathComponent == "manifest.json" {
                try FileManager.default.removeItem(at: url)
            } else {
                throw Stuck()
            }
        }
        #expect(!removed)
        #expect(!FileManager.default.fileExists(atPath: dir.appendingPathComponent("manifest.json").path))
    }

    @Test func retriesOnceAfterATransientFailure() throws {
        let dir = try makeEdition()
        var failures = 1
        let removed = EditionDirectory.remove(dir, markers: []) { url in
            if failures > 0 {
                failures -= 1
                throw CocoaError(.fileWriteUnknown)
            }
            try FileManager.default.removeItem(at: url)
        }
        #expect(removed)
    }
}

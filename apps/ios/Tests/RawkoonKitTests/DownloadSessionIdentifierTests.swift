@testable import RawkoonKit
import Testing

struct DownloadSessionIdentifierTests {
    /// Sessions created by older builds must still be recognised after an update.
    @Test func textIsStable() {
        #expect(DownloadSessionIdentifier.make(editionId: 42) == "cloud.samlo.rawkoon.dl.42")
        #expect(DownloadSessionIdentifier.editionId(from: "cloud.samlo.rawkoon.dl.42") == 42)
    }

    @Test func roundTripsTheEdition() {
        #expect(DownloadSessionIdentifier.editionId(from: DownloadSessionIdentifier.make(editionId: 7)) == 7)
    }

    @Test func rejectsForeignOrMalformedIdentifiers() {
        #expect(DownloadSessionIdentifier.editionId(from: "other.42") == nil)
        #expect(DownloadSessionIdentifier.editionId(from: "cloud.samlo.rawkoon.dl.") == nil)
        #expect(DownloadSessionIdentifier.editionId(from: "cloud.samlo.rawkoon.dl.abc") == nil)
        #expect(DownloadSessionIdentifier.editionId(from: "cloud.samlo.rawkoon.dl.4x") == nil)
        #expect(DownloadSessionIdentifier.editionId(from: "") == nil)
    }
}

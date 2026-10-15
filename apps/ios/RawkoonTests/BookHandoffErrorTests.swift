import Foundation
@testable import Rawkoon
import RawkoonKit
import Testing

struct BookHandoffErrorTests {
    @Test func serverStatusesMapToFailureBuckets() {
        #expect(APIError.server(status: 409, message: "feature_disabled").handoffFailure == .syncOff)
        #expect(APIError.server(status: 422, message: "text_not_found").handoffFailure == .spotNotFound)
        #expect(APIError.server(status: 502, message: "transcription_failed").handoffFailure == .unreachable)
        #expect(APIError.server(status: 404, message: "no_ebook_edition").handoffFailure == .needsBothEditions)
        #expect(APIError.http(409).handoffFailure == .syncOff)
        #expect(APIError.server(status: 409, message: "budget_exceeded").handoffFailure == .budgetSpent)
        #expect(APIError.http(429).handoffFailure == .rateLimited)
    }

    @Test func transportFailuresReadAsUnreachable() {
        #expect(APIError.transport.handoffFailure == .unreachable)
        #expect(APIError.offline.handoffFailure == .unreachable)
    }

    @Test func bookSyncIsAnAiFeature() {
        #expect(AiFeature(rawValue: "book_sync") == .bookSync)
        var toggles = AiFeatureToggles()
        #expect(toggles.isOn(.bookSync))
        toggles.set(.bookSync, on: false)
        #expect(!toggles.isOn(.bookSync))
    }
}

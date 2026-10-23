import Foundation
@testable import RawkoonKit
import Testing

struct JellyfinSignInFailureTests {
    @Test func mapsStatusCodes() {
        #expect(JellyfinSignInFailure(status: 401) == .wrongCredentials)
        #expect(JellyfinSignInFailure(status: 403) == .noAccess)
        #expect(JellyfinSignInFailure(status: 502) == .jellyfinUnreachable)
        #expect(JellyfinSignInFailure(status: 404) == .notEnabled)
        #expect(JellyfinSignInFailure(status: 429) == .tooManyAttempts)
        #expect(JellyfinSignInFailure(status: 500) == .other)
    }

    @Test func mapsRateLimitFailureRegardlessOfBody() {
        let body = Data(#"{"error":"Too many attempts"}"#.utf8)
        #expect(JellyfinSignInFailure(failure: HTTPStatusMapping.failure(status: 429, body: body)) == .tooManyAttempts)
        #expect(JellyfinSignInFailure(failure: HTTPStatusMapping.failure(status: 429, body: Data())) == .tooManyAttempts)
    }

    @Test func mapsHTTPFailuresRegardlessOfBody() {
        #expect(JellyfinSignInFailure(failure: HTTPStatusMapping.failure(status: 401, body: Data())) == .wrongCredentials)
        #expect(JellyfinSignInFailure(failure: HTTPStatusMapping.failure(status: 403, body: Data())) == .noAccess)
        let body = Data(#"{"error":"Can't reach Jellyfin"}"#.utf8)
        #expect(JellyfinSignInFailure(failure: HTTPStatusMapping.failure(status: 502, body: body)) == .jellyfinUnreachable)
        #expect(JellyfinSignInFailure(failure: HTTPStatusMapping.failure(status: 502, body: Data())) == .jellyfinUnreachable)
    }
}

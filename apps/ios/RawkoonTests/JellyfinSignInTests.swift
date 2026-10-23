import Foundation
@testable import Rawkoon
import RawkoonKit
import Testing

struct JellyfinSignInTests {
    private func decode(_ json: String) throws -> SsoProvidersResponse {
        try APIClient.mediaDecoder.decode(SsoProvidersResponse.self, from: Data(json.utf8))
    }

    @Test func ssoProvidersDecodeJellyfinSignInTrue() throws {
        #expect(try decode(#"{"providers": [], "jellyfin_sign_in": true}"#).jellyfinSignIn == true)
    }

    @Test func ssoProvidersDecodeJellyfinSignInFalse() throws {
        #expect(try decode(#"{"providers": [], "jellyfin_sign_in": false}"#).jellyfinSignIn == false)
    }

    @Test func ssoProvidersTreatMissingJellyfinSignInAsOff() throws {
        let response = try decode(#"{"providers": []}"#)
        #expect(response.jellyfinSignIn == nil)
        #expect((response.jellyfinSignIn ?? false) == false)
    }

    @Test func apiErrorsMapToFailures() {
        #expect(JellyfinSignInFailure(apiError: .unauthorized) == .wrongCredentials)
        #expect(JellyfinSignInFailure(apiError: .forbidden) == .noAccess)
        #expect(JellyfinSignInFailure(apiError: .http(502)) == .jellyfinUnreachable)
        #expect(JellyfinSignInFailure(apiError: .server(status: 404, message: "x")) == .notEnabled)
        #expect(JellyfinSignInFailure(apiError: .server(status: 429, message: "x")) == .tooManyAttempts)
        #expect(JellyfinSignInFailure(apiError: .http(500)) == .other)
        #expect(JellyfinSignInFailure(apiError: .transport) == nil)
        #expect(JellyfinSignInFailure(apiError: .offline) == nil)
    }

    @Test func failuresCarryDistinctMessages() {
        let cases: [JellyfinSignInFailure] = [
            .wrongCredentials, .noAccess, .jellyfinUnreachable, .notEnabled, .tooManyAttempts,
        ]
        let messages = cases.compactMap(\.message)
        #expect(messages.count == cases.count)
        #expect(Set(messages).count == cases.count)
        #expect(JellyfinSignInFailure.other.message == nil)
        #expect(JellyfinSignInFailure.tooManyAttempts.message == "Too many attempts. Try again in a few minutes.")
    }
}

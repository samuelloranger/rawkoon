import Foundation
@testable import RawkoonKit
import Testing

struct ServerAddressTests {
    @Test func assumesHttpsWhenNoSchemeIsTyped() {
        #expect(ServerAddress.normalize("rawkoon.example.com") == "https://rawkoon.example.com")
    }

    @Test func keepsAnExplicitScheme() {
        #expect(ServerAddress.normalize("http://192.168.1.20:3000") == "http://192.168.1.20:3000")
    }

    @Test func trimsSpacesAndTrailingSlashes() {
        #expect(ServerAddress.normalize("  https://rawkoon.example.com//  ") == "https://rawkoon.example.com")
    }

    @Test func rejectsTextThatIsNotAServer() {
        #expect(ServerAddress.normalize("") == nil)
        #expect(ServerAddress.normalize("   ") == nil)
        #expect(ServerAddress.normalize("ftp://rawkoon.example.com") == nil)
        #expect(ServerAddress.normalize("https://") == nil)
    }

    @Test func namesTheServerByHostAndPort() {
        #expect(ServerAddress.displayName("https://rawkoon.example.com") == "rawkoon.example.com")
        #expect(ServerAddress.displayName("http://192.168.1.20:3000") == "192.168.1.20:3000")
    }
}

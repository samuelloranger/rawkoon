import Foundation
@testable import RawkoonKit
import Testing

struct AdminUserDisplayTests {
    @Test func recognisesJellyfinPlaceholderAddresses() {
        #expect(AdminUserDisplay.isPlaceholderEmail("a1b2c3@jellyfin.invalid"))
        #expect(AdminUserDisplay.isPlaceholderEmail("A1B2C3@Jellyfin.Invalid"))
        #expect(!AdminUserDisplay.isPlaceholderEmail("viewer@example.com"))
    }

    @Test func prefersTheNameThenARealEmail() {
        #expect(AdminUserDisplay.name(firstName: "Ada", lastName: "Byron", email: "ada@example.com") == "Ada Byron")
        #expect(AdminUserDisplay.name(firstName: " ", lastName: nil, email: "ada@example.com") == "ada@example.com")
        #expect(AdminUserDisplay.name(firstName: nil, lastName: nil, email: "x@jellyfin.invalid") == nil)
    }

    @Test func searchMatchesNameOrEmailIgnoringCaseAndAccents() {
        #expect(AdminUserDisplay.matches("rene", firstName: "René", lastName: nil, email: "r@example.com"))
        #expect(AdminUserDisplay.matches("EXAMPLE", firstName: nil, lastName: nil, email: "r@example.com"))
        #expect(AdminUserDisplay.matches("  ", firstName: nil, lastName: nil, email: "r@example.com"))
        #expect(!AdminUserDisplay.matches("zed", firstName: "René", lastName: nil, email: "r@example.com"))
    }
}

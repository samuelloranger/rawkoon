@testable import RawkoonKit
import XCTest

final class UserInitialsTests: XCTestCase {
    func testFirstAndLastName() {
        XCTAssertEqual(UserInitials.from(firstName: "samuel", lastName: "Loranger", name: nil), "SL")
    }

    func testFirstNameOnly() {
        XCTAssertEqual(UserInitials.from(firstName: "Ana", lastName: nil, name: "ignored"), "A")
    }

    /// No name fields: fall back to the display name's first two words.
    func testDisplayNameFallback() {
        XCTAssertEqual(UserInitials.from(firstName: nil, lastName: "  ", name: "jean paul marc"), "JP")
    }

    /// Nothing usable must yield nil so the avatar shows a person icon, not an empty circle.
    func testNothingUsableIsNil() {
        XCTAssertNil(UserInitials.from(firstName: nil, lastName: nil, name: nil))
        XCTAssertNil(UserInitials.from(firstName: " ", lastName: "", name: "   "))
    }
}

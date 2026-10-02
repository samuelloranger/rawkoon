@testable import RawkoonKit
import XCTest

final class HTMLTextTests: XCTestCase {
    func testPlainTextPassesThroughTrimmed() {
        XCTAssertEqual(HTMLText.plainText("  A quiet book.\n"), "A quiet book.")
    }

    func testParagraphsBecomeBlankLineSeparated() {
        XCTAssertEqual(
            HTMLText.plainText("<p>First part.</p><p>Second <b>bold</b> part.</p>"),
            "First part.\n\nSecond bold part."
        )
    }

    func testLineBreaksAndListItems() {
        XCTAssertEqual(HTMLText.plainText("One<br>Two<br/>Three<BR />Four"), "One\nTwo\nThree\nFour")
        XCTAssertEqual(HTMLText.plainText("<ul><li>Alpha</li><li>Beta</li></ul>"), "• Alpha\n• Beta")
    }

    func testEntitiesAreDecodedAfterTagsAreStripped() {
        XCTAssertEqual(HTMLText.plainText("Tom &amp; Jerry &lt;3"), "Tom & Jerry <3")
        XCTAssertEqual(HTMLText.plainText("&lt;b&gt;not a tag&lt;/b&gt;"), "<b>not a tag</b>")
        XCTAssertEqual(HTMLText.plainText("L&#39;&eacute;t&#xE9; &mdash; fin&hellip;"), "L'été — fin…")
    }

    func testNonBreakingSpacesAndRunsCollapse() {
        XCTAssertEqual(HTMLText.plainText("<p>A&nbsp;&nbsp; b\u{00A0}c</p>\n\n\n<p>d</p>"), "A b c\n\nd")
    }

    /// An unknown or malformed entity must survive verbatim rather than vanish.
    func testUnknownEntitiesAreKept() {
        XCTAssertEqual(HTMLText.plainText("R&D &bogus; &#xZZ;"), "R&D &bogus; &#xZZ;")
    }

    func testScriptStyleAndCommentsAreDropped() {
        XCTAssertEqual(
            HTMLText.plainText("<style>p{color:red}</style><!-- note --><p>Text</p><script>alert(1)</script>"),
            "Text"
        )
    }
}

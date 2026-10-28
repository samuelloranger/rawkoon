@testable import RawkoonKit
import XCTest

final class ReleaseNotesBlockTests: XCTestCase {
    func testSplitsAReleaseBodyIntoBlocks() {
        let body = """
        Opening summary that
        wraps onto a second line.

        ### Highlights

        - **First** thing (#12).
        - Second thing:
          - nested one
          - nested two

        ---

        1. Step one
        2. Step two
        """
        XCTAssertEqual(ReleaseNotes.blocks(body), [
            .paragraph("Opening summary that wraps onto a second line."),
            .heading(level: 3, text: "Highlights"),
            .bullet(depth: 0, text: "**First** thing (#12)."),
            .bullet(depth: 0, text: "Second thing:"),
            .bullet(depth: 1, text: "nested one"),
            .bullet(depth: 1, text: "nested two"),
            .rule,
            .numbered(depth: 0, number: 1, text: "Step one"),
            .numbered(depth: 0, number: 2, text: "Step two"),
        ])
    }

    func testJoinsAWrappedListItem() {
        XCTAssertEqual(
            ReleaseNotes.blocks("- a long item\n  that wraps\n- next"),
            [.bullet(depth: 0, text: "a long item that wraps"), .bullet(depth: 0, text: "next")]
        )
    }

    func testKeepsCodeFencesVerbatim() {
        XCTAssertEqual(
            ReleaseNotes.blocks("Run:\n\n```bash\n  docker compose pull\n# not a heading\n```\nAfter."),
            [.paragraph("Run:"), .code("  docker compose pull\n# not a heading"), .paragraph("After.")]
        )
    }

    func testClosesAnUnterminatedFence() {
        XCTAssertEqual(ReleaseNotes.blocks("```\nline"), [.code("line")])
    }

    func testReadsQuotesAndSkipsComments() {
        XCTAssertEqual(
            ReleaseNotes.blocks("<!-- generated -->\n> Note one\n> continues"),
            [.quote("Note one continues")]
        )
    }

    func testHandlesWindowsLineEndings() {
        XCTAssertEqual(
            ReleaseNotes.blocks("## Title\r\n\r\nText"),
            [.heading(level: 2, text: "Title"), .paragraph("Text")]
        )
    }

    func testEmptyBodyHasNoBlocks() {
        XCTAssertTrue(ReleaseNotes.blocks("").isEmpty)
        XCTAssertTrue(ReleaseNotes.blocks("\n\n  \n").isEmpty)
    }

    func testSummaryIsTheFirstParagraph() {
        XCTAssertEqual(ReleaseNotes.summary("### Highlights\n\n- item\n\nFirst para.\n\nSecond."), "First para.")
        XCTAssertNil(ReleaseNotes.summary("- only a list"))
    }
}

final class ReleaseNotesReferenceTests: XCTestCase {
    func testLinksPullRequestReferences() {
        XCTAssertEqual(
            ReleaseNotes.linkingReferences("Fixed (#387, #389).", repo: "owner/app"),
            "Fixed ([#387](https://github.com/owner/app/issues/387), [#389](https://github.com/owner/app/issues/389))."
        )
    }

    func testLeavesCodeSpansAndExistingLinksAlone() {
        XCTAssertEqual(
            ReleaseNotes.linkingReferences("Use `#12` and [#13](https://x) but #14", repo: "o/a"),
            "Use `#12` and [#13](https://x) but [#14](https://github.com/o/a/issues/14)"
        )
    }

    func testNoRepoMeansNoLinks() {
        XCTAssertEqual(ReleaseNotes.linkingReferences("See #5", repo: nil), "See #5")
    }
}

final class ReleaseNotesHeadlineTests: XCTestCase {
    func testDropsTheTagPrefix() {
        XCTAssertEqual(ReleaseNotes.headline(name: "v1.2.0 — Faster search", tag: "v1.2.0"), "Faster search")
        XCTAssertEqual(ReleaseNotes.headline(name: "v1.2.0: Faster search", tag: "v1.2.0"), "Faster search")
    }

    func testNilWhenTheNameIsJustTheTag() {
        XCTAssertNil(ReleaseNotes.headline(name: "v1.2.0", tag: "v1.2.0"))
        XCTAssertNil(ReleaseNotes.headline(name: nil, tag: "v1.2.0"))
        XCTAssertNil(ReleaseNotes.headline(name: "  ", tag: "v1.2.0"))
    }

    func testKeepsANameWithoutTheTag() {
        XCTAssertEqual(ReleaseNotes.headline(name: "Autumn update", tag: "v1.2.0"), "Autumn update")
    }
}

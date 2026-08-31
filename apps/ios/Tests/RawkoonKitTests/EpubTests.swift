import XCTest

@testable import RawkoonKit

/// A minimal but real EPUB: stored `mimetype`, deflated everything else, an OPF
/// in `OEBPS/` (so spine hrefs must be rebased) and one manifest href that
/// escapes upward with `..`.
private enum Fixture {
    static var epubData: Data {
        Data(base64Encoded: base64)!
    }

    private static let base64 = [
            "UEsDBBQAAAAAADxrH11vYassFAAAABQAAAAIAAAAbWltZXR5cGVhcHBsaWNhdGlvbi9lcHVi"
            "K3ppcFBLAwQUAAAACAA8ax9dHTIDNp8AAADiAAAAFgAAAE1FVEEtSU5GL2NvbnRhaW5lci54"
            "bWxVjkEOwiAURPc9BWFrWnRLgCYmrjXxBF/6q0TgE6BGby+6qHE3ycy8GTU+g2cPzMVR1Hw3"
            "bPloOmUpVnAR87/FWjgWzZccJUFxRUYIWGS1khLGiewSMFb5jckVwk3HmMpEdXYei1klmxfv"
            "+wT1pvnxsD+dxafTCAOlmbOAk4O+vhJqDil5Z6G2L4Lwkkqr2TtccdPGuDBK/PidEuu2eQNQ"
            "SwMEFAAAAAgAPGsfXUg9rGYIAQAAHwIAABEAAABPRUJQUy9jb250ZW50Lm9wZqXRQW7DIBAF"
            "0H1OgdhWYWx3UcmynQt02QsgGMejAiZm3CS3L3Wc1GrVVbd8/htGNIeLd+IDp0RjaGWpCnno"
            "dk3U5l0fUeQwpFYOzLEGOJ/Pimzs1TgdoSqKFxhjL7/bz7kt5kCnGfdkMTD1hFMrycpuJ0Tj"
            "kbXVrG9sbc1DjvPkFtUaQIc+dxOUqoSlmKvW1EzssHtF8YaJG3icfMlwp29zdKA+X1q7xOgF"
            "2VaaUophwr6VjBcGM5TqMrB3Uni0pPd8jdhKHaMjozmvBEv8lJ8r4RdW/cCq/2Ap3TWlIPHV"
            "YQKvKagl2Yq3afkU1s03yzYpUsANnsXsL25eHv5Iqru11htY/7/7BFBLAwQUAAAACAA8ax9d"
            "0X6zqTwAAACBCQAAFAAAAE9FQlBTL3RleHQvY2gxLnhodG1ss8koyc2xs0nKT6m0symwS85I"
            "LMgsKUpVKM1TGGWPskfZo+xR9ih7lD3KHmVTzrbRL7Cz0Ye0tvTBTS8AUEsDBBQAAAAIADxr"
            "H13cM6inKQAAAC4AAAAUAAAAT0VCUFMvdGV4dC9jaDIueGh0bWyzySjJzbGzScpPqbSzKbBL"
            "zkgsyCwpSlVISS2tsNEvsLPRh0jpg9UBAFBLAwQUAAAACAA8ax9dSI6nfRAAAAAOAAAADwAA"
            "AHN0eWxlcy9tYWluLmNzc0vKT6mszk0sSs/MszKoBQBQSwECFAMUAAAAAAA8ax9db2GrLBQA"
            "AAAUAAAACAAAAAAAAAAAAAAAgAEAAAAAbWltZXR5cGVQSwECFAMUAAAACAA8ax9dHTIDNp8A"
            "AADiAAAAFgAAAAAAAAAAAAAAgAE6AAAATUVUQS1JTkYvY29udGFpbmVyLnhtbFBLAQIUAxQA"
            "AAAIADxrH11IPaxmCAEAAB8CAAARAAAAAAAAAAAAAACAAQ0BAABPRUJQUy9jb250ZW50Lm9w"
            "ZlBLAQIUAxQAAAAIADxrH13RfrOpPAAAAIEJAAAUAAAAAAAAAAAAAACAAUQCAABPRUJQUy90"
            "ZXh0L2NoMS54aHRtbFBLAQIUAxQAAAAIADxrH13cM6inKQAAAC4AAAAUAAAAAAAAAAAAAACA"
            "AbICAABPRUJQUy90ZXh0L2NoMi54aHRtbFBLAQIUAxQAAAAIADxrH11Ijqd9EAAAAA4AAAAP"
            "AAAAAAAAAAAAAACAAQ0DAABzdHlsZXMvbWFpbi5jc3NQSwUGAAAAAAYABgB6AQAASgMAAAAA"
    ].joined()
}

final class InflateTests: XCTestCase {
    /// Raw DEFLATE (no zlib wrapper, `-15` window) of "la femme de menage "
    /// repeated 400 times, produced by zlib at level 9 — the exact shape a ZIP
    /// entry holds. Covers dynamic Huffman plus long overlapping matches.
    private static let deflated: [UInt8] = [
            0xED, 0xC8, 0xA1, 0x11, 0x00, 0x20, 0x0C, 0x04, 0xB0, 0x55, 0xBA, 0x1A, 0x77, 0x3C,
            0x18, 0xCA, 0xFE, 0x92, 0x29, 0x70, 0x89, 0xCC, 0x19, 0xB5, 0xD2, 0x9D, 0x9A, 0xA9,
            0xCE, 0x1D, 0x3B, 0x75, 0x94, 0x52, 0x4A, 0x29, 0xA5, 0x94, 0x52, 0x4A, 0x29, 0xA5,
            0x94, 0x52, 0x4A, 0x29, 0xA5, 0x94, 0x52, 0x4A, 0xFD, 0xAF, 0x07,
    ]

    func testInflatesADynamicHuffmanBlock() throws {
        let expected = String(repeating: "la femme de menage ", count: 400)
        let bytes = try Inflate.decompress(Self.deflated, expectedSize: expected.utf8.count)
        XCTAssertEqual(String(decoding: bytes, as: UTF8.self), expected)
    }

    /// The reader must not read past the declared size when the caller
    /// under-guesses it.
    func testExpectedSizeIsOnlyAHint() throws {
        let bytes = try Inflate.decompress(Self.deflated, expectedSize: 1)
        XCTAssertEqual(bytes.count, 19 * 400)
    }

    func testRejectsTruncatedInput() {
        XCTAssertThrowsError(try Inflate.decompress([0xFF]))
        XCTAssertThrowsError(try Inflate.decompress(Array(Self.deflated.prefix(4))))
    }

    func testStoredBlockRoundTripsThroughTheFixture() throws {
        // `mimetype` is stored, not deflated: it proves the non-inflate path.
        let archive = try ZipArchive(data: Fixture.epubData)
        XCTAssertEqual(archive.entry(named: "mimetype")?.compressionMethod, 0)
        XCTAssertEqual(
            String(data: try archive.contents(ofEntryNamed: "mimetype"), encoding: .utf8),
            "application/epub+zip"
        )
    }
}

final class ZipArchiveTests: XCTestCase {
    func testReadsDeflatedEntries() throws {
        let archive = try ZipArchive(data: Fixture.epubData)
        let entry = try XCTUnwrap(archive.entry(named: "OEBPS/text/ch1.xhtml"))
        XCTAssertEqual(entry.compressionMethod, 8)

        let chapter = try archive.contents(of: entry)
        // The fixture chapter is long enough that deflate really compressed it,
        // so this covers inflate rather than a pass-through.
        XCTAssertGreaterThan(entry.uncompressedSize, entry.compressedSize)
        XCTAssertEqual(chapter.count, entry.uncompressedSize)
        XCTAssertTrue(
            String(data: chapter, encoding: .utf8)?.hasPrefix("<html>") == true
        )
    }

    func testEveryEntryInflatesToItsDeclaredSize() throws {
        let archive = try ZipArchive(data: Fixture.epubData)
        for entry in archive.entries where !entry.isDirectory {
            let bytes = try archive.contents(of: entry)
            XCTAssertEqual(bytes.count, entry.uncompressedSize, entry.name)
        }
    }

    func testReportsNonArchives() {
        XCTAssertThrowsError(try ZipArchive(data: Data("definitely not a zip".utf8))) { error in
            XCTAssertEqual(error as? ZipError, .notAZipArchive)
        }
    }

    func testExtractsEveryFileEntry() throws {
        let archive = try ZipArchive(data: Fixture.epubData)
        let destination = FileManager.default.temporaryDirectory
            .appendingPathComponent("epub-extract-\(UUID().uuidString)", isDirectory: true)
        defer { try? FileManager.default.removeItem(at: destination) }

        try archive.extract(to: destination)

        for name in ["mimetype", "OEBPS/content.opf", "OEBPS/text/ch2.xhtml", "styles/main.css"] {
            XCTAssertTrue(
                FileManager.default.fileExists(
                    atPath: destination.appendingPathComponent(name).path
                ),
                "missing \(name)"
            )
        }
    }

    func testRejectsEntryNamesThatEscapeTheDestination() {
        XCTAssertThrowsError(try ZipArchive.sanitize("../../etc/passwd"))
        XCTAssertThrowsError(try ZipArchive.sanitize("/etc/passwd"))
        XCTAssertThrowsError(try ZipArchive.sanitize(""))
        XCTAssertEqual(try ZipArchive.sanitize("OEBPS//text/ch1.xhtml"), "OEBPS/text/ch1.xhtml")
    }
}

final class EpubPackageTests: XCTestCase {
    func testResolvesSpineOrderAgainstTheOpfDirectory() throws {
        let package = try EpubParser.parse(archive: try ZipArchive(data: Fixture.epubData))

        XCTAssertEqual(package.opfPath, "OEBPS/content.opf")
        XCTAssertEqual(package.title, "Le Test")
        XCTAssertEqual(
            package.documents.map(\.path),
            ["OEBPS/text/ch1.xhtml", "OEBPS/text/ch2.xhtml"]
        )
        // `styles/main.css` is in the manifest but not the spine.
        XCTAssertEqual(package.documents.count, 2)
    }

    func testEverySpineDocumentExistsInTheArchive() throws {
        let archive = try ZipArchive(data: Fixture.epubData)
        let package = try EpubParser.parse(archive: archive)
        let names = Set(archive.entries.map(\.name))
        for document in package.documents {
            XCTAssertTrue(names.contains(document.path), "spine points at missing \(document.path)")
        }
    }

    func testResolveRebasesAndCollapsesRelativeHrefs() {
        XCTAssertEqual(
            EpubParser.resolve(href: "text/ch1.xhtml", relativeTo: "OEBPS"),
            "OEBPS/text/ch1.xhtml"
        )
        XCTAssertEqual(
            EpubParser.resolve(href: "../styles/main.css", relativeTo: "OEBPS"),
            "styles/main.css"
        )
        XCTAssertEqual(
            EpubParser.resolve(href: "ch1.xhtml#frag", relativeTo: "OEBPS"),
            "OEBPS/ch1.xhtml"
        )
        XCTAssertEqual(
            EpubParser.resolve(href: "/abs/ch1.xhtml", relativeTo: "OEBPS"),
            "abs/ch1.xhtml"
        )
        XCTAssertEqual(EpubParser.resolve(href: "a%20b.xhtml", relativeTo: ""), "a b.xhtml")
    }

    func testRejectsAnEmptySpine() {
        let opf = Data(#"<package><manifest><item id="a" href="a.xhtml"/></manifest><spine/></package>"#.utf8)
        XCTAssertThrowsError(try EpubParser.parsePackage(opf, opfPath: "content.opf")) { error in
            XCTAssertEqual(error as? EpubError, .emptySpine)
        }
    }
}

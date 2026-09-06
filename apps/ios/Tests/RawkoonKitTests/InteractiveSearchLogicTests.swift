@testable import RawkoonKit
import XCTest

private struct Row: InteractiveSortable {
    var qualityScoreValue: Double?
    var seedersValue: Int?
    var ageValue: Int?
    var sizeBytesValue: Int?
    var titleValue: String
    var rejectedFlag: Bool

    init(
        title: String,
        quality: Double? = nil,
        seeders: Int? = nil,
        age: Int? = nil,
        size: Int? = nil,
        rejected: Bool = false
    ) {
        titleValue = title
        qualityScoreValue = quality
        seedersValue = seeders
        ageValue = age
        sizeBytesValue = size
        rejectedFlag = rejected
    }
}

final class InteractiveSearchLogicTests: XCTestCase {
    typealias L = InteractiveSearchLogic

    // MARK: Normalization

    func testNormalizeKeyStripsDiacriticsTrimsLowercases() {
        XCTAssertEqual(L.normalizeKey("  Rézo-Béta  "), "rezo-beta")
        XCTAssertEqual(L.normalizeKey("YGGtorrent"), "yggtorrent")
    }

    func testNormalizeForMatchCollapsesPunctuation() {
        XCTAssertEqual(L.normalizeForMatch("The.Matrix (1999)"), "the matrix 1999 ")
        XCTAssertEqual(L.normalizeForMatch("Amélie"), "amelie")
    }

    func testStripTitleSuffixes() {
        XCTAssertEqual(L.stripTitleSuffixes("The Wire S01E05"), "The Wire")
        XCTAssertEqual(L.stripTitleSuffixes("The Wire S03"), "The Wire")
        XCTAssertEqual(L.stripTitleSuffixes("Dune 2021"), "Dune")
        // Web parity: the naive year regex `(?:19|20)\d{2}` also matches 2049,
        // so a trailing-year title loses it — matched behavior, not a bug here.
        XCTAssertEqual(L.stripTitleSuffixes("Blade Runner 2049"), "Blade Runner")
        XCTAssertEqual(L.stripTitleSuffixes("Plain Title"), "Plain Title")
    }

    func testDistinctiveWordsDropsStopWordsAndShortWords() {
        XCTAssertEqual(L.distinctiveWords("The Lord of the Rings"), ["lord", "rings"])
        XCTAssertEqual(L.distinctiveWords("Up"), [])
    }

    // MARK: Client rejection heuristic

    func testRejectsYearMismatch() {
        XCTAssertTrue(L.isClientRejected(
            releaseTitle: "Dune 1984 1080p BluRay",
            expectedTitle: "Dune",
            expectedYear: 2021
        ))
    }

    func testAcceptsMatchingYear() {
        XCTAssertFalse(L.isClientRejected(
            releaseTitle: "Dune 2021 2160p",
            expectedTitle: "Dune",
            expectedYear: 2021
        ))
    }

    func testRejectsWhenTitleWordsMissingBelowSeventyPercent() {
        // Expected distinctive words: blade, runner (2). 70% → need 2. Only 1 present → reject.
        XCTAssertTrue(L.isClientRejected(
            releaseTitle: "Runner 2160p",
            expectedTitle: "Blade Runner",
            expectedYear: nil
        ))
    }

    func testAcceptsWhenTitleWordsMeetThreshold() {
        // 3 distinctive words: lord, rings (the/of are stop/short). ceil(2*0.7)=2, both present.
        XCTAssertFalse(L.isClientRejected(
            releaseTitle: "The.Lord.of.the.Rings.1080p",
            expectedTitle: "The Lord of the Rings",
            expectedYear: nil
        ))
    }

    func testShortExpectedTitleNeverRejectsOnWords() {
        XCTAssertFalse(L.isClientRejected(
            releaseTitle: "Something Else 1080p",
            expectedTitle: "Up",
            expectedYear: nil
        ))
    }

    func testDiacriticInsensitiveTitleMatch() {
        XCTAssertFalse(L.isClientRejected(
            releaseTitle: "Amelie.2001.1080p",
            expectedTitle: "Amélie",
            expectedYear: nil
        ))
    }

    // MARK: Sorting

    func testQualitySortSinksRejectedThenOrdersByScoreDesc() {
        let rows = [
            Row(title: "A", quality: 10, rejected: false),
            Row(title: "B", quality: 100, rejected: true),
            Row(title: "C", quality: 50, rejected: false),
        ]
        let sorted = L.sortReleases(rows, by: .quality, dir: .desc)
        XCTAssertEqual(sorted.map(\.titleValue), ["C", "A", "B"])
    }

    func testQualitySortNullScoreSinksToBottom() {
        let rows = [
            Row(title: "A", quality: nil),
            Row(title: "B", quality: 5),
        ]
        XCTAssertEqual(L.sortReleases(rows, by: .quality, dir: .desc).map(\.titleValue), ["B", "A"])
    }

    func testSeedersSortAscAndDescWithNullSentinel() {
        let rows = [
            Row(title: "A", seeders: 5),
            Row(title: "B", seeders: nil),
            Row(title: "C", seeders: 20),
        ]
        XCTAssertEqual(L.sortReleases(rows, by: .seeders, dir: .desc).map(\.titleValue), ["C", "A", "B"])
        XCTAssertEqual(L.sortReleases(rows, by: .seeders, dir: .asc).map(\.titleValue), ["B", "A", "C"])
    }

    func testAgeSortNullGoesLastAscending() {
        let rows = [
            Row(title: "A", age: 30),
            Row(title: "B", age: nil),
            Row(title: "C", age: 2),
        ]
        // asc = youngest first; nil → MAX_INT sinks to bottom.
        XCTAssertEqual(L.sortReleases(rows, by: .age, dir: .asc).map(\.titleValue), ["C", "A", "B"])
    }

    func testSizeSortDesc() {
        let rows = [
            Row(title: "A", size: 100),
            Row(title: "B", size: 900),
            Row(title: "C", size: nil),
        ]
        XCTAssertEqual(L.sortReleases(rows, by: .size, dir: .desc).map(\.titleValue), ["B", "A", "C"])
    }

    func testTitleSortAscDesc() {
        let rows = [Row(title: "Charlie"), Row(title: "alpha"), Row(title: "Bravo")]
        XCTAssertEqual(L.sortReleases(rows, by: .title, dir: .asc).map(\.titleValue), ["alpha", "Bravo", "Charlie"])
        XCTAssertEqual(L.sortReleases(rows, by: .title, dir: .desc).map(\.titleValue), ["Charlie", "Bravo", "alpha"])
    }

    func testSeedersTieBreakByTitle() {
        let rows = [Row(title: "Zeta", seeders: 5), Row(title: "Alpha", seeders: 5)]
        XCTAssertEqual(L.sortReleases(rows, by: .seeders, dir: .desc).map(\.titleValue), ["Alpha", "Zeta"])
    }

    // MARK: Filter options

    func testTrackerOptionsNormalizeDedupeAndUnknownBucket() {
        let options = L.trackerOptions(indexers: ["YGG", "ygg", "  ", nil, "RARBG"])
        XCTAssertEqual(options.map(\.key), ["rarbg", "__unknown_tracker__", "ygg"]) // alphabetical by label: RARBG, Unknown, YGG
    }

    func testLanguageOptionsEmptyListBecomesUnknown() {
        let options = L.languageOptions(languageLists: [["French"], [], ["french"]])
        XCTAssertEqual(Set(options.map(\.key)), ["french", "__unknown_language__"])
    }

    // MARK: buildTitleOptions

    func testTitleOptionsPlatformFirstDedupesAndAppliesSuffix() {
        let options = L.buildTitleOptions(
            localized: "The Matrix",
            localizedLanguage: "en",
            original: "The Matrix",
            originalLanguage: "en",
            translations: [
                .init(languageCode: "de", title: "Matrix"),
                .init(languageCode: "ja", title: "マトリックス"),
            ],
            suffix: " S01"
        )
        XCTAssertEqual(options.map(\.query), ["The Matrix S01", "Matrix S01", "マトリックス S01"])
        XCTAssertEqual(options.map(\.languageCode), ["en", "de", "ja"])
        XCTAssertFalse(options.contains { $0.isOriginal })
    }

    func testTitleOptionsTagsOriginalLanguageTitle() {
        let options = L.buildTitleOptions(
            localized: "Spirited Away",
            localizedLanguage: "en",
            original: "千と千尋の神隠し",
            originalLanguage: "ja",
            translations: [],
            suffix: ""
        )
        XCTAssertEqual(options.map(\.query), ["Spirited Away", "千と千尋の神隠し"])
        XCTAssertEqual(options.first(where: { $0.isOriginal })?.query, "千と千尋の神隠し")
    }

    func testTitleOptionsSkipsSingleCharSecondaryTitles() {
        let options = L.buildTitleOptions(
            localized: "Up",
            localizedLanguage: "en",
            original: nil,
            originalLanguage: nil,
            translations: [.init(languageCode: "es", title: "A")],
            suffix: ""
        )
        // Platform title kept (min length 1); the 1-char Spanish title dropped.
        XCTAssertEqual(options.map(\.query), ["Up"])
    }

    func testTitleOptionsPinsEnglishAndFrenchWhenNotCovered() {
        let options = L.buildTitleOptions(
            localized: "El Laberinto del Fauno",
            localizedLanguage: "es",
            original: "El Laberinto del Fauno",
            originalLanguage: "es",
            translations: [
                .init(languageCode: "en", title: "Pan's Labyrinth"),
                .init(languageCode: "fr", title: "Le Labyrinthe de Pan"),
            ],
            suffix: ""
        )
        XCTAssertEqual(options.map(\.query), [
            "El Laberinto del Fauno", "Pan's Labyrinth", "Le Labyrinthe de Pan",
        ])
        XCTAssertEqual(options.map(\.languageCode), ["es", "en", "fr"])
    }
}

import Foundation

/// Pure, Linux-testable port of the web interactive-search client logic
/// (`apps/web/src/lib/utils/interactive-search.ts`). Behavior parity with the
/// web picker is the contract: constants and thresholds are copied verbatim.
public enum InteractiveSearchLogic {
    public static let unknownTrackerKey = "__unknown_tracker__"
    public static let unknownLanguageKey = "__unknown_language__"

    /// The 29 stop words excluded from distinctive-title matching, verbatim from
    /// `interactive-search.ts`.
    public static let stopWords: Set<String> = [
        "the", "and", "for", "are", "but", "not", "all", "can", "had", "her",
        "was", "one", "our", "out", "has", "him", "his", "how", "its", "let",
        "new", "now", "old", "see", "two", "way", "who", "did", "via",
    ]

    // MARK: Normalization

    /// Strip canonical combining marks (Unicode NFD → drop `\p{Mn}`).
    private static func stripMarks(_ value: String) -> String {
        String(String.UnicodeScalarView(
            value.decomposedStringWithCanonicalMapping.unicodeScalars
                .filter { $0.properties.generalCategory != .nonspacingMark }
        ))
    }

    /// `normalizeFilterKey`: NFD → strip marks → trim → lowercase. Punctuation is
    /// kept (used for tracker/language keys and the client filter haystack).
    public static func normalizeKey(_ value: String) -> String {
        stripMarks(value).trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
    }

    /// Match normalization: NFD → strip marks → lowercase → collapse every run of
    /// non-alphanumeric characters to a single space (used for title/year checks).
    public static func normalizeForMatch(_ value: String) -> String {
        let lowered = stripMarks(value).lowercased()
        var out = ""
        var lastWasSpace = false
        for ch in lowered {
            if ch.isLetter || ch.isNumber {
                out.append(ch)
                lastWasSpace = false
            } else if !lastWasSpace {
                out.append(" ")
                lastWasSpace = true
            }
        }
        return out
    }

    /// Strip a trailing SxxExx / Sxx / year suffix from a search title before the
    /// client rejection check (`useInteractiveSearchState.ts:214-222`).
    public static func stripTitleSuffixes(_ value: String) -> String {
        var result = value
        let patterns = [
            #"\s+[Ss]\d{1,2}[Ee]\d{1,3}\s*$"#,
            #"\s+[Ss]\d{1,2}\s*$"#,
            #"\s+(?:19|20)\d{2}\s*$"#,
        ]
        for pattern in patterns {
            if let regex = try? NSRegularExpression(pattern: pattern) {
                let range = NSRange(result.startIndex..., in: result)
                result = regex.stringByReplacingMatches(in: result, range: range, withTemplate: "")
            }
        }
        return result.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    /// Distinctive words of a title: normalized, length ≥ 3, not a stop word.
    public static func distinctiveWords(_ title: String) -> [String] {
        normalizeForMatch(title)
            .split(separator: " ")
            .map(String.init)
            .filter { $0.count >= 3 && !stopWords.contains($0) }
    }

    // MARK: Client rejection heuristic

    /// Client-side rejection for Prowlarr results (no arr-side rejection):
    /// rejects when the release title carries a mismatched year, or when it is
    /// missing more than 30% of the expected title's distinctive words.
    /// (`interactive-search.ts:219-252`.)
    public static func isClientRejected(
        releaseTitle: String,
        expectedTitle: String,
        expectedYear: Int?
    ) -> Bool {
        let normalizedRelease = normalizeForMatch(releaseTitle)

        if let expectedYear, expectedYear != 0 {
            if let releaseYear = firstYear(in: normalizedRelease), releaseYear != expectedYear {
                return true
            }
        }

        let titleWords = distinctiveWords(expectedTitle)
        if titleWords.isEmpty {
            return false
        } // title too short to judge

        let matchCount = titleWords.filter { normalizedRelease.contains($0) }.count
        let threshold = Int((Double(titleWords.count) * 0.7).rounded(.up))
        return matchCount < threshold
    }

    /// First 4-digit `19xx`/`20xx` word boundary year in an already-normalized string.
    private static func firstYear(in normalized: String) -> Int? {
        guard let regex = try? NSRegularExpression(pattern: #"\b((?:19|20)\d{2})\b"#) else { return nil }
        let range = NSRange(normalized.startIndex..., in: normalized)
        guard
            let match = regex.firstMatch(in: normalized, range: range),
            let r = Range(match.range(at: 1), in: normalized)
        else { return nil }
        return Int(normalized[r])
    }

    // MARK: Sorting

    public enum SortKey: String, Sendable, CaseIterable {
        case quality, seeders, age, size, title
    }

    public enum SortDir: String, Sendable {
        case asc, desc
    }

    /// Sort exactly like `filterAndSortReleases` (`interactive-search.ts:319-340`):
    /// quality sinks rejected rows first then orders by score; other keys use null
    /// sentinels with a title tie-break; `sortDir` flips non-quality comparators.
    public static func sortReleases<T: InteractiveSortable>(
        _ releases: [T],
        by sortBy: SortKey,
        dir: SortDir
    ) -> [T] {
        releases.sorted { a, b in
            switch sortBy {
            case .quality:
                let aRej = a.rejectedFlag
                let bRej = b.rejectedFlag
                if aRej != bRej {
                    return !aRej
                } // non-rejected first
                let av = a.qualityScoreValue ?? -Double(Int.max)
                let bv = b.qualityScoreValue ?? -Double(Int.max)
                if av != bv {
                    return dir == .desc ? av > bv : av < bv
                }
                return titleLess(a.titleValue, b.titleValue)
            case .seeders:
                return compareInt(a.seedersValue ?? -1, b.seedersValue ?? -1, a.titleValue, b.titleValue, dir)
            case .age:
                return compareInt(a.ageValue ?? Int.max, b.ageValue ?? Int.max, a.titleValue, b.titleValue, dir)
            case .size:
                return compareInt(a.sizeBytesValue ?? -1, b.sizeBytesValue ?? -1, a.titleValue, b.titleValue, dir)
            case .title:
                // Title sort is itself the comparator; dir flips it.
                let asc = titleLess(a.titleValue, b.titleValue)
                if a.titleValue == b.titleValue {
                    return false
                }
                return dir == .asc ? asc : !asc
            }
        }
    }

    private static func compareInt(
        _ av: Int, _ bv: Int, _ at: String, _ bt: String, _ dir: SortDir
    ) -> Bool {
        if av == bv {
            return titleLess(at, bt)
        }
        return dir == .asc ? av < bv : av > bv
    }

    /// Deterministic, case-insensitive title tie-break (approximates `localeCompare`).
    private static func titleLess(_ a: String, _ b: String) -> Bool {
        a.lowercased() < b.lowercased()
    }

    // MARK: Filter option derivation

    public struct FilterOption: Equatable, Sendable, Identifiable {
        public let key: String
        public let label: String
        public var id: String {
            key
        }

        public init(key: String, label: String) {
            self.key = key
            self.label = label
        }
    }

    /// Distinct tracker options from loaded results, alphabetical by label, with an
    /// `__unknown_tracker__` bucket for blank indexers.
    public static func trackerOptions(indexers: [String?]) -> [FilterOption] {
        options(from: indexers.map { indexer in
            let trimmed = indexer?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
            return trimmed.isEmpty ? nil : trimmed
        }, unknownKey: unknownTrackerKey, unknownLabel: "Unknown")
    }

    /// Distinct language options from loaded results, alphabetical by label, with an
    /// `__unknown_language__` bucket for releases that list no languages.
    public static func languageOptions(languageLists: [[String]]) -> [FilterOption] {
        var values: [String?] = []
        for list in languageLists {
            if list.isEmpty {
                values.append(nil)
            } else {
                values.append(contentsOf: list.map { $0 as String? })
            }
        }
        return options(from: values, unknownKey: unknownLanguageKey, unknownLabel: "Unknown")
    }

    private static func options(
        from values: [String?], unknownKey: String, unknownLabel: String
    ) -> [FilterOption] {
        var byKey: [String: String] = [:]
        for value in values {
            guard let value, !value.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
                byKey[unknownKey] = unknownLabel
                continue
            }
            let key = normalizeKey(value)
            if byKey[key] == nil {
                byKey[key] = value
            }
        }
        return byKey
            .map { FilterOption(key: $0.key, label: $0.value) }
            .sorted { $0.label.lowercased() < $1.label.lowercased() }
    }
}

// MARK: Language / title picker (Phase 5)

public extension InteractiveSearchLogic {
    /// Languages offered in the search-title picker beyond the platform,
    /// English, French, and original-language titles — verbatim from
    /// `interactive-search.ts` `COMMON_TITLE_LANGUAGES`.
    static let commonTitleLanguages = ["es", "de", "it", "pt", "ja", "ko", "zh", "ru"]

    /// One TMDB per-language title fed to `buildTitleOptions`.
    struct TitleTranslationInput: Sendable {
        public let languageCode: String
        public let title: String
        public init(languageCode: String, title: String) {
            self.languageCode = languageCode
            self.title = title
        }
    }

    /// A resolved search-title option for the picker.
    struct TitleOption: Equatable, Sendable, Identifiable {
        public let languageCode: String
        public let query: String
        public let isOriginal: Bool
        public var id: String {
            query
        }

        public init(languageCode: String, query: String, isOriginal: Bool) {
            self.languageCode = languageCode
            self.query = query
            self.isOriginal = isOriginal
        }
    }

    /// Ordered search-title options (`buildTitleOptions`, `interactive-search.ts:58-157`),
    /// ported verbatim: platform title first (the default), English & French pinned,
    /// then the original-language title, then the common allowlist — each only when a
    /// non-empty title exists, deduped by lowercased query. Secondary titles need ≥2
    /// chars; the platform title is always kept.
    static func buildTitleOptions(
        localized: String,
        localizedLanguage: String,
        original: String?,
        originalLanguage: String?,
        translations: [TitleTranslationInput],
        suffix: String = ""
    ) -> [TitleOption] {
        let platform = localizedLanguage.lowercased()
        let originalLang = (originalLanguage ?? "").lowercased()

        var translationByLang: [String: String] = [:]
        for entry in translations {
            let code = entry.languageCode.lowercased()
            let title = entry.title.trimmingCharacters(in: .whitespacesAndNewlines)
            if !code.isEmpty, !title.isEmpty, translationByLang[code] == nil {
                translationByLang[code] = title
            }
        }

        struct Candidate {
            let languageCode: String
            let title: String?
            let isOriginal: Bool
            let isPlatform: Bool
        }

        let coveredCodes = Set([platform, originalLang].filter { !$0.isEmpty })

        var candidates: [Candidate] = [
            Candidate(languageCode: platform, title: localized, isOriginal: false, isPlatform: true),
        ]
        for code in ["en", "fr"] where !coveredCodes.contains(code) {
            candidates.append(Candidate(languageCode: code, title: translationByLang[code], isOriginal: false, isPlatform: false))
        }
        if !originalLang.isEmpty {
            let originalTitle = original?.trimmingCharacters(in: .whitespacesAndNewlines)
            let resolved = (originalTitle?.isEmpty == false ? originalTitle : nil) ?? translationByLang[originalLang]
            candidates.append(Candidate(languageCode: originalLang, title: resolved, isOriginal: true, isPlatform: false))
        }
        for code in commonTitleLanguages where !coveredCodes.contains(code) {
            candidates.append(Candidate(languageCode: code, title: translationByLang[code], isOriginal: false, isPlatform: false))
        }

        var options: [TitleOption] = []
        var seenQueries = Set<String>()
        for candidate in candidates {
            let base = candidate.title?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
            let minLength = candidate.isPlatform ? 1 : 2
            if base.isEmpty || base.count < minLength {
                continue
            }
            let query = base + suffix
            let dedupeKey = query.lowercased()
            if seenQueries.contains(dedupeKey) {
                continue
            }
            seenQueries.insert(dedupeKey)
            options.append(TitleOption(languageCode: candidate.languageCode, query: query, isOriginal: candidate.isOriginal))
        }
        return options
    }
}

/// Minimal shape `sortReleases` needs; `ReleaseItem` conforms in the app target.
public protocol InteractiveSortable {
    var qualityScoreValue: Double? { get }
    var seedersValue: Int? { get }
    var ageValue: Int? { get }
    var sizeBytesValue: Int? { get }
    var titleValue: String { get }
    var rejectedFlag: Bool { get }
}

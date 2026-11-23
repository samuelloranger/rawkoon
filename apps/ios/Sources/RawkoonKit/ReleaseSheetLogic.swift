import Foundation

public enum ReleaseLanguageKind: Equatable, Sendable {
    /// Audio in a language the profile wants.
    case audio
    /// Audio in the same language family, but not the preferred version.
    case fallback
    /// French subtitles over foreign audio: not a match for a French-audio profile.
    case subtitlesOnly
}

/// A release as the best-match picker sees it; `ReleaseItem` conforms in the app target.
public protocol BestMatchCandidate: InteractiveSortable {
    var guidValue: String { get }
    var languageFallbackFlag: Bool { get }
}

/// Pure rules behind the release sheet: language tags, the other-versions group, the pinned best match.
/// Mirrors the web helpers `languageFallback.ts` and `bestMatch.ts`.
public enum ReleaseSheetLogic {
    public struct LanguageTag: Equatable, Sendable {
        public let label: String
        public let kind: ReleaseLanguageKind
    }

    private static let frenchFlags: Set<String> = ["vff", "vfq", "vfi", "vf2", "truefrench", "vf", "french", "fr"]

    private static let variantOrder = ["VFF", "VFI", "VFQ", "VF2", "VF", "FRENCH"]

    /// Audio and subtitle markers in a release name, following the server's `parseAudioFlags`:
    /// VF2 stands alone, a bare VF or FRENCH only counts when no specific variant is named,
    /// and TRUEFRENCH is the Parisian dub (VFF). The search payload's own `languages` list is
    /// empty for most indexers, so the title is the reliable source.
    static func titleFlags(_ title: String) -> Set<String> {
        let tokens = Set(
            title.uppercased().split { !$0.isLetter && !$0.isNumber }.map(String.init)
        )
        var flags = Set<String>()
        if tokens.contains("MULTI") {
            flags.insert("MULTI")
        }
        if tokens.contains("VF2") {
            flags.insert("VF2")
            return flags
        }
        // VOF/VOQ: original French audio from France/Québec.
        if tokens.contains("TRUEFRENCH") || tokens.contains("VFF") || tokens.contains("VOF") {
            flags.insert("VFF")
        }
        if tokens.contains("VFQ") || tokens.contains("VQC") || tokens.contains("VOQ") {
            flags.insert("VFQ")
        }
        if tokens.contains("VFI") {
            flags.insert("VFI")
        }
        let hasVariant = !flags.isDisjoint(with: ["VFF", "VFQ", "VFI"])
        if tokens.contains("VF"), !hasVariant {
            flags.insert("VF")
        }
        if tokens.contains("FRENCH"), flags.subtracting(["MULTI"]).isEmpty {
            flags.insert("FRENCH")
        }
        if tokens.contains("VOSTFR") {
            flags.insert("VOSTFR")
        }
        if tokens.contains("VFSTFR") {
            flags.insert("VFSTFR")
        }
        return flags
    }

    /// The tag shown on a row, from the server's fallback marker plus the language markers in the name.
    public static func languageTag(
        title: String, languages: [String], isFallback: Bool, fallbackTag: String?
    ) -> LanguageTag? {
        if isFallback {
            return LanguageTag(label: fallbackTag ?? "?", kind: .fallback)
        }
        var flags = titleFlags(title)
        // A VF2 name already says both dubs; a payload flag must not add a second variant to it.
        let payload = languages.map { $0.trimmingCharacters(in: .whitespaces).uppercased() }
        if !flags.contains("VF2") {
            flags.formUnion(payload.filter { !$0.isEmpty })
        }
        let hasSubtitles = !flags.isDisjoint(with: ["VOSTFR", "VFSTFR"])
        let variants = variantOrder.filter { flags.contains($0) }
        let isMulti = flags.contains("MULTI")
        if !variants.isEmpty {
            let names = variants.joined(separator: "/")
            return LanguageTag(label: isMulti ? "MULTi \(names)" : names, kind: .audio)
        }
        if isMulti {
            return LanguageTag(label: "MULTi", kind: .audio)
        }
        if hasSubtitles {
            return LanguageTag(label: "VOSTFR", kind: .subtitlesOnly)
        }
        return nil
    }

    /// True for MULTi and every French variant tag.
    public static func isFrenchTag(_ tag: String) -> Bool {
        let lowered = tag.lowercased()
        return lowered == "multi" || frenchFlags.contains(lowered)
    }

    public struct FallbackSummary: Equatable, Sendable {
        public let total: Int
        public let isFrench: Bool
        /// "VFF (4), VFI (2)", most common first.
        public let breakdown: String
    }

    public static func fallbackSummary(counts: [String: Int]) -> FallbackSummary {
        let sorted = counts.sorted { $0.value != $1.value ? $0.value > $1.value : $0.key < $1.key }
        return FallbackSummary(
            total: sorted.reduce(0) { $0 + $1.value },
            isFrench: sorted.allSatisfy { isFrenchTag($0.key) },
            breakdown: sorted.map { "\($0.key) (\($0.value))" }.joined(separator: ", ")
        )
    }

    /// "VFQ", "VFQ or VF2", "VFQ, VF2 or VFI".
    public static func joinLanguages(_ languages: [String], or word: String) -> String {
        guard languages.count > 1 else { return languages.joined() }
        return languages.dropLast().joined(separator: ", ") + " \(word) " + (languages.last ?? "")
    }

    /// The release an automatic search would grab: the AI pick when set, else the top score
    /// among releases it may grab. Pass releases in server order; ties keep it.
    public static func pickBestMatch<T: BestMatchCandidate>(
        _ releases: [T], aiPickKey: String?, blockedGuids: Set<String>
    ) -> T? {
        let eligible = releases.filter {
            !$0.rejectedFlag && !$0.languageFallbackFlag && !blockedGuids.contains($0.guidValue)
        }
        if let aiPickKey, let picked = eligible.first(where: { $0.guidValue == aiPickKey }) {
            return picked
        }
        var best: T?
        for release in eligible {
            guard let score = release.qualityScoreValue else { continue }
            if best == nil || score > (best?.qualityScoreValue ?? 0) {
                best = release
            }
        }
        return best
    }
}

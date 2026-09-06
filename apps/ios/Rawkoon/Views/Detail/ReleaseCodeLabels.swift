import Foundation
import RawkoonKit

/// English labels for the server's scoring codes, mirroring the web i18n maps
/// (`apps/web/src/lib/i18n/scoringCodes.ts` → `scoring.reject.*` /
/// `scoring.component.*`). Unknown codes fall back to the raw code.
enum ReleaseScoringLabels {
    static let rejection: [String: String] = [
        "resolution_below_min": "Below minimum resolution",
        "resolution_above_cutoff": "Exceeds cutoff resolution",
        "hdr_required_absent": "HDR required but not present",
        "language_no_match": "Language does not match profile",
        "size_over_cap": "File size exceeds cap",
        "is_sample": "Sample file rejected",
        "seeders_below_min": "Not enough seeders",
        "custom_format_required_absent": "Required custom format absent",
        "custom_format_forbidden_present": "Forbidden custom format present",
    ]

    static let component: [String: String] = [
        "resolution_tier": "Resolution tier",
        "preferred_source": "Preferred source",
        "preferred_codec": "Preferred codec",
        "language_match": "Language match",
        "prefer_hdr": "HDR preference",
        "proper_repack": "Proper/repack",
        "freeleech": "Freeleech",
        "tracker_priority": "Tracker priority",
        "size_penalty": "Size penalty",
        "custom_format": "Custom format",
    ]

    static func rejectionLabel(_ code: String) -> String {
        rejection[code] ?? code
    }

    static func componentLabel(_ code: String) -> String {
        component[code] ?? code
    }
}

/// Lets `InteractiveSearchLogic.sortReleases` order `ReleaseItem`s without the
/// kit knowing the app's DTO.
extension ReleaseItem: InteractiveSortable {
    var qualityScoreValue: Double? {
        qualityScore
    }

    var seedersValue: Int? {
        seeders
    }

    var ageValue: Int? {
        age
    }

    var sizeBytesValue: Int? {
        sizeBytes
    }

    var titleValue: String {
        title
    }

    var rejectedFlag: Bool {
        rejected ?? false
    }
}

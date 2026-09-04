import SwiftUI

/// Maps known server status / kind tokens to catalog keys for display.
/// Unknown or dynamic values stay verbatim so they are never treated as keys.
enum LocalizedStatus {
    static func text(_ raw: String) -> Text {
        if let key = key(for: raw) {
            Text(key)
        } else {
            Text(verbatim: raw.capitalized)
        }
    }

    // swiftlint:disable:next cyclomatic_complexity
    static func key(for raw: String) -> LocalizedStringKey? {
        switch raw.lowercased() {
        case "pending": "Pending"
        case "approved": "Approved"
        case "denied": "Denied"
        case "available": "Available"
        case "wanted": "Wanted"
        case "downloading": "Downloading"
        case "downloaded": "Downloaded"
        case "skipped": "Skipped"
        case "returning": "Returning"
        case "in_production": "In production"
        case "planned": "Planned"
        case "upgrading": "Upgrading"
        case "missing": "Missing"
        case "accepted": "Accepted"
        case "revoked": "Revoked"
        case "expired": "Expired"
        case "completed": "Completed"
        case "stalled": "Stalled"
        case "error": "Error"
        case "paused": "Paused"
        case "failed": "Failed"
        case "active": "Active"
        case "ebook": "Ebook"
        case "audiobook": "Audiobook"
        case "both": "Both"
        case "not-configured": "Not configured"
        case "awaiting-first": "Awaiting first"
        case "stale": "Stale"
        case "foreign-program": "Foreign program"
        default: nil
        }
    }
}

func statusBadge(_ status: String, tint: Color) -> StatusBadge {
    if let key = LocalizedStatus.key(for: status) {
        StatusBadge(text: key, tint: tint)
    } else {
        StatusBadge(text: status.capitalized, tint: tint)
    }
}

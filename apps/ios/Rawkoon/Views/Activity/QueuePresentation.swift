import RawkoonKit
import SwiftUI

extension QueueStatus {
    var label: LocalizedStringKey {
        switch self {
        case .downloading: "Downloading"
        case .waiting: "Waiting"
        case .importing: "Importing"
        case .stalled: "Stalled"
        case .failed: "Failed"
        }
    }

    var tint: Color {
        switch self {
        case .downloading: Theme.importing
        case .waiting: Theme.muted
        case .importing: Theme.seed
        case .stalled: Theme.apricotSoft
        case .failed: Theme.danger
        }
    }
}

extension QueueReason {
    /// The reason line, worded for the card; nil when the status says it all.
    var text: String? {
        switch self {
        case .none: nil
        case .paused: String(localized: "Paused in the download client")
        case .queued: String(localized: "Queued behind other downloads")
        case .checking: String(localized: "Checking files already on disk")
        case .fetchingMetadata: String(localized: "Fetching the torrent's details")
        case .noPeers: String(localized: "No one is sending data right now")
        case .importing: String(localized: "Moving the files into your library")
        case .clientError: String(localized: "The download client reported an error")
        case let .detail(text): text
        }
    }
}

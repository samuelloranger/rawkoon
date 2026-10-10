import Foundation

/// Which actions an ebook file row shows; mirrors the row's branch order so its swap keys on the visible face.
nonisolated enum EbookFileAction: Equatable {
    case downloading, opening, saved, remote

    static func phase(downloading: Bool, opening: Bool, downloaded: Bool) -> Self {
        if downloading {
            return .downloading
        }
        if opening {
            return .opening
        }
        return downloaded ? .saved : .remote
    }
}

/// What the ebook Files card shows; a reload spins even over a known list, as it always has.
nonisolated enum EbookFilesPhase: Equatable {
    case loading, empty, list

    static func resolve(loading: Bool, isEmpty: Bool) -> Self {
        if loading {
            return .loading
        }
        return isEmpty ? .empty : .list
    }
}

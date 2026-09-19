import RawkoonKit
import SwiftUI

enum LibrarySection: String, CaseIterable, Identifiable {
    case media = "Media"
    case books = "Books"
    var id: String {
        rawValue
    }

    var title: LocalizedStringKey {
        switch self {
        case .media: "Media"
        case .books: "Books"
        }
    }
}

/// Defaults mirror the web app: type=all, status=all, sort=added_at desc.
enum MediaTypeFilter: String, CaseIterable, Identifiable {
    case all, movie, show
    var id: String {
        rawValue
    }

    var title: LocalizedStringKey {
        switch self {
        case .all: "All"
        case .movie: "Movies"
        case .show: "Shows"
        }
    }

    var param: String? {
        self == .all ? nil : rawValue
    }
}

enum MediaStatusFilter: String, CaseIterable, Identifiable {
    case all, downloaded, wanted, downloading
    var id: String {
        rawValue
    }

    var title: LocalizedStringKey {
        switch self {
        case .all: "All"
        case .downloaded: "Downloaded"
        case .wanted: "Missing"
        case .downloading: "Downloading"
        }
    }

    var param: String? {
        self == .all ? nil : rawValue
    }
}

/// Load failures reach the cache already localized, so the list and its
/// pagination footer show the same copy they always have.
nonisolated struct LibraryLoadError: LocalizedError {
    let message: String
    var errorDescription: String? {
        message
    }
}

nonisolated func libraryErrorMessage(for error: Error) -> String {
    if let loadError = error as? LibraryLoadError {
        return loadError.message
    }
    guard let apiError = error as? APIError else { return String(localized: "Unexpected error.") }
    return apiError.userMessage(
        unauthorized: String(localized: "Sign in required."),
        transport: String(localized: "Network error.")
    )
}

enum MediaSort: String, CaseIterable, Identifiable {
    case added_at, last_grabbed_at, title, year, status, digital_release_date, file_size
    var id: String {
        rawValue
    }

    var title: LocalizedStringKey {
        switch self {
        case .added_at: "Date added"
        case .last_grabbed_at: "Last download"
        case .title: "Title"
        case .year: "Year"
        case .status: "Status"
        case .digital_release_date: "Digital release"
        case .file_size: "File size"
        }
    }
}

enum BookKindFilter: String, CaseIterable, Identifiable {
    case all, audiobook, ebook
    var id: String {
        rawValue
    }

    var title: LocalizedStringKey {
        switch self {
        case .all: "All"
        case .audiobook: "Audiobook"
        case .ebook: "Ebook"
        }
    }
}

enum BookSort: String, CaseIterable, Identifiable {
    /// Books still being read/listened, most recently touched first, then the
    /// rest in the server's latest-added order. The web app's default order.
    case recent, title, author
    var id: String {
        rawValue
    }

    var title: LocalizedStringKey {
        switch self {
        case .recent: "Recent"
        case .title: "Title"
        case .author: "Author"
        }
    }
}

/// Two densities only (not the web's three): the default poster grid and an
/// opt-in list. Persisted per-device via `@AppStorage`.
enum LibraryDensity: String, CaseIterable {
    case grid, list
}

extension View {
    /// On regular width (iPad, Mac) caps a stacked list to a readable measure and
    /// centers it, so rows don't stretch a wide window. No-op on compact (phone).
    @ViewBuilder
    func libraryReadingWidth(_ regular: Bool) -> some View {
        if regular {
            frame(maxWidth: 720).frame(maxWidth: .infinity)
        } else {
            self
        }
    }
}

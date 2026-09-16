import Foundation

/// What a Library row may show and do for one item.
///
/// A row for an add the server has not confirmed yet carries a fake negative id,
/// so it must not navigate anywhere or offer actions that would address that id.
/// The rules live here, outside the view bodies, so both the grid and the list
/// read from one place and the behaviour is testable without rendering.
nonisolated struct LibraryRowPresentation: Equatable, Sendable {
    enum Status: Equatable, Sendable {
        case adding
        case server(String)
    }

    let status: Status
    let isInteractive: Bool
    let showsSpinner: Bool

    init(media: LibraryMedia, isBusy: Bool = false) {
        if media.isProvisional {
            status = .adding
            isInteractive = false
            showsSpinner = true
        } else {
            status = .server(media.status)
            isInteractive = true
            showsSpinner = isBusy
        }
    }
}

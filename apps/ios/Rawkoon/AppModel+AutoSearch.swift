import Foundation

extension AppModel {
    /// Searches the indexers and grabs the best release for a movie, then says how
    /// it went. `onChoose` backs the "Choose…" action on a miss. True when grabbed.
    /// `canChoose` is read when the result lands: a screen left mid-search can't open the sheet.
    @discardableResult
    func autoSearchMovie(
        libraryId: Int,
        canChoose: () -> Bool = { true },
        onChoose: @escaping () -> Void
    ) async -> Bool {
        guard let client = api() else { return false }
        do {
            let result = try await client.searchMovie(id: libraryId)
            reportGrab(result, onChoose: result.grabbed || !canChoose() ? nil : onChoose)
            return result.grabbed
        } catch {
            toast(String(localized: "Auto search failed."), style: .error)
            return false
        }
    }

    /// Toast for a search+grab response; a miss carries the server's reason.
    func reportGrab(_ result: LibrarySearchResponse, onChoose: (() -> Void)? = nil) {
        if result.grabbed {
            let release = result.releaseTitle ?? String(localized: "a release")
            let message = result.aiPicked == true
                ? String(localized: "Grabbed \(release) (AI pick).")
                : String(localized: "Grabbed \(release).")
            toast(message, style: .success)
        } else {
            let action = onChoose.map { ToastAction(label: String(localized: "Choose…"), handler: $0) }
            toast(result.reason ?? String(localized: "No release grabbed."), style: .info, action: action)
        }
    }

    /// Asks the server to look for an upgrade after a quality-profile change.
    func startUpgradeSearch(libraryId: Int) async {
        guard let client = api() else { return }
        do {
            _ = try await client.startUpgradeSearch(id: libraryId)
            toast(String(localized: "Upgrade search started."), style: .success)
        } catch {
            toast(String(localized: "Upgrade search failed."), style: .error)
        }
    }
}

extension ConfirmRequest {
    /// Shown after a quality-profile change that leaves the downloaded file(s)
    /// below the new profile. Shows get no manual choice: there is no single sheet
    /// for "every failing episode".
    static func upgradePrompt(
        isShow: Bool,
        profileName: String,
        affectedEpisodes: Int,
        onAutoSearch: @escaping @MainActor () -> Void,
        onChoose: @escaping @MainActor () -> Void
    ) -> ConfirmRequest {
        ConfirmRequest(
            title: isShow
                ? String(localized: "Some episodes don't meet “\(profileName)”")
                : String(localized: "The current file doesn't meet “\(profileName)”"),
            message: isShow
                ? String(localized: "\(affectedEpisodes) downloaded episodes fall short. Look for better releases now?")
                : String(localized: "Look for a better release now?"),
            confirmTitle: String(localized: "Auto search for an upgrade"),
            isDestructive: false,
            action: onAutoSearch,
            secondaryTitle: isShow ? nil : String(localized: "Choose a release"),
            secondaryAction: isShow ? nil : onChoose,
            cancelTitle: String(localized: "Keep the current file")
        )
    }
}

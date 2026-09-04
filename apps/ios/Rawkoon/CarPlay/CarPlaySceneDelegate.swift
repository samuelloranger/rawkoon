import CarPlay
import Observation
import RawkoonKit
import UIKit

/// Owns the CarPlay interface. Declared in project.yml's scene manifest as the
/// delegate for the CarPlay scene role; the phone window is untouched SwiftUI.
///
/// CarPlay can launch the app straight into the car with no phone view ever
/// shown, so this delegate — not a SwiftUI `.task` — is responsible for making
/// sure the library is loaded before it builds the browse list.
final class CarPlaySceneDelegate: UIResponder, CPTemplateApplicationSceneDelegate {
    private var interfaceController: CPInterfaceController?
    /// The browse list, kept so a background refresh can update its rows in
    /// place instead of resetting the root (which would tear down a pushed Now
    /// Playing template). Nil while a message template is showing.
    private var browseTemplate: CPListTemplate?

    func templateApplicationScene(
        _: CPTemplateApplicationScene,
        didConnect interfaceController: CPInterfaceController
    ) {
        self.interfaceController = interfaceController
        browseTemplate = nil
        Log.playback.info("CarPlay scene connected")
        Task { @MainActor in
            await refresh()
            observeAppState()
        }
    }

    func templateApplicationScene(
        _: CPTemplateApplicationScene,
        didDisconnectInterfaceController _: CPInterfaceController
    ) {
        Log.playback.info("CarPlay scene disconnected")
        interfaceController = nil
        browseTemplate = nil
    }

    /// Re-renders whenever the app state CarPlay depends on changes — sign-in
    /// (a phone login, or a cold launch that logs in later) and the library
    /// itself (a download finishing, a first audiobook arriving). Armed in every
    /// state, not just the populated one, so the car recovers without a
    /// reconnect. `withObservationTracking` fires once, so it re-arms after each
    /// change — but only while a scene is connected.
    @MainActor
    private func observeAppState() {
        guard interfaceController != nil else { return }
        withObservationTracking {
            _ = AppModel.shared.isLoggedIn
            _ = AppModel.shared.library
        } onChange: { [weak self] in
            Task { @MainActor in
                guard let self, self.interfaceController != nil else { return }
                await self.refresh()
                self.observeAppState()
            }
        }
    }

    @MainActor
    private func refresh() async {
        let model = AppModel.shared

        guard model.isLoggedIn else {
            showMessage(String(localized: "Open Rawkoon on your phone to sign in."))
            return
        }
        await model.ensureLibraryLoaded()
        let entries = await model.carPlayAudiobooks()
        guard !entries.isEmpty else {
            showMessage(model.errorMessage ?? String(localized: "No audiobooks yet."))
            return
        }
        showBrowse(entries: entries, model: model)
    }

    /// Populated state. Updates the existing list in place when one is already
    /// shown, so a pushed Now Playing template survives a background refresh;
    /// only the first build (or a return from a message state) sets the root.
    @MainActor
    private func showBrowse(entries: [CarPlayBrowseEntry], model: AppModel) {
        let sections = CarPlayInterface.browseSections(entries: entries, model: model) { [weak self] editionId in
            self?.play(editionId: editionId, model: model)
        }
        if let browseTemplate {
            browseTemplate.updateSections(sections)
        } else {
            let template = CPListTemplate(title: "Rawkoon", sections: sections)
            browseTemplate = template
            interfaceController?.setRootTemplate(template, animated: false, completion: nil)
        }
    }

    @MainActor
    private func showMessage(_ text: String) {
        browseTemplate = nil
        interfaceController?.setRootTemplate(
            CarPlayInterface.message(text, title: "Rawkoon"), animated: false, completion: nil
        )
    }

    @MainActor
    private func play(editionId: Int, model: AppModel) {
        Task { @MainActor in
            await model.openPlayer(editionId: editionId)
            guard model.errorMessage == nil else { return }
            model.player.play()
            configureNowPlayingButtons(model: model)
            interfaceController?.pushTemplate(
                CPNowPlayingTemplate.shared, animated: true, completion: nil
            )
        }
    }

    /// The two custom controls on the Now Playing screen. CarPlay owns the
    /// transport row and the black ground; these are the only surface an audio
    /// app may add. The rate button reads its label from the now-playing info,
    /// so it reflects a speed change without being rebuilt.
    @MainActor
    private func configureNowPlayingButtons(model: AppModel) {
        let rate = CPNowPlayingPlaybackRateButton { _ in
            model.player.cycleRate()
        }
        let chapters = CPNowPlayingImageButton(
            image: UIImage(systemName: "list.bullet") ?? UIImage()
        ) { [weak self] _ in
            self?.showChapters(model: model)
        }
        CPNowPlayingTemplate.shared.updateNowPlayingButtons([rate, chapters])
    }

    /// Pushes a chapter picker over Now Playing. Tapping a chapter seeks there
    /// and pops straight back, so the driver lands on the playing screen again.
    /// The current chapter carries the playing indicator.
    @MainActor
    private func showChapters(model: AppModel) {
        let chapters = model.player.chapterList
        guard !chapters.isEmpty else { return }
        let currentIndex = model.player.currentChapterIndex

        let items = chapters.map { chapter -> CPListItem in
            let item = CPListItem(
                text: chapter.title,
                detailText: Self.chapterLength(chapter.durationSecs)
            )
            item.isPlaying = chapter.index == currentIndex
            item.handler = { [weak self] _, completion in
                model.player.jumpToChapter(chapter)
                self?.interfaceController?.popTemplate(animated: true, completion: nil)
                completion()
            }
            return item
        }

        let template = CPListTemplate(
            title: "Chapters",
            sections: [CPListSection(items: items)]
        )
        interfaceController?.pushTemplate(template, animated: true, completion: nil)
    }

    /// A chapter's length as `H:MM:SS` (dropping a leading zero hour → `M:SS`),
    /// for the picker's detail line.
    private static func chapterLength(_ seconds: Double) -> String {
        let total = Int(seconds.rounded())
        let hours = total / 3600
        let minutes = (total % 3600) / 60
        let secs = total % 60
        return hours > 0
            ? String(format: "%d:%02d:%02d", hours, minutes, secs)
            : String(format: "%d:%02d", minutes, secs)
    }
}

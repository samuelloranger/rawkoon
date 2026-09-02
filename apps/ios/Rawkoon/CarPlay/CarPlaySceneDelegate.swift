import CarPlay
import Observation

/// Owns the CarPlay interface. Declared in project.yml's scene manifest as the
/// delegate for the CarPlay scene role; the phone window is untouched SwiftUI.
///
/// CarPlay can launch the app straight into the car with no phone view ever
/// shown, so this delegate — not a SwiftUI `.task` — is responsible for making
/// sure the library is loaded before it builds the browse list.
final class CarPlaySceneDelegate: UIResponder, CPTemplateApplicationSceneDelegate {
    private var interfaceController: CPInterfaceController?
    private var observing = false

    func templateApplicationScene(
        _ templateApplicationScene: CPTemplateApplicationScene,
        didConnect interfaceController: CPInterfaceController
    ) {
        self.interfaceController = interfaceController
        Log.playback.info("CarPlay scene connected")
        Task { await rebuildRoot() }
    }

    func templateApplicationScene(
        _ templateApplicationScene: CPTemplateApplicationScene,
        didDisconnectInterfaceController interfaceController: CPInterfaceController
    ) {
        Log.playback.info("CarPlay scene disconnected")
        self.interfaceController = nil
        self.observing = false
    }

    /// Rebuilds the browse list when the library changes (a download finishing,
    /// a reload) while a CarPlay scene is connected. `withObservationTracking`
    /// fires once, so it re-arms after each change.
    @MainActor
    private func observeLibrary() {
        observing = true
        withObservationTracking {
            _ = AppModel.shared.library
        } onChange: { [weak self] in
            Task { @MainActor in
                guard let self, self.interfaceController != nil else { return }
                await self.rebuildRoot()
                self.observeLibrary()
            }
        }
    }

    @MainActor
    private func rebuildRoot() async {
        let model = AppModel.shared
        guard model.isLoggedIn else {
            setRoot(CarPlayInterface.message(
                "Open Rawkoon on your phone to sign in.", title: "Rawkoon"
            ))
            return
        }
        await model.ensureLibraryLoaded()
        let entries = await model.carPlayAudiobooks()
        guard !entries.isEmpty else {
            setRoot(CarPlayInterface.message("No audiobooks yet.", title: "Rawkoon"))
            return
        }
        let template = CarPlayInterface.browseTemplate(entries: entries, model: model) { editionId in
            Task { @MainActor in
                await model.openPlayer(editionId: editionId)
                guard model.errorMessage == nil else { return }
                model.player.play()
                self.interfaceController?.pushTemplate(
                    CPNowPlayingTemplate.shared, animated: true, completion: nil
                )
            }
        }
        setRoot(template)
        if !observing { observeLibrary() }
    }

    @MainActor
    private func setRoot(_ template: CPTemplate) {
        interfaceController?.setRootTemplate(template, animated: false, completion: nil)
    }
}

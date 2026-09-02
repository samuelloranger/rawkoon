import CarPlay

/// Owns the CarPlay interface. Declared in project.yml's scene manifest as the
/// delegate for the CarPlay scene role; the phone window is untouched SwiftUI.
///
/// CarPlay can launch the app straight into the car with no phone view ever
/// shown, so this delegate — not a SwiftUI `.task` — is responsible for making
/// sure the library is loaded before it builds the browse list.
final class CarPlaySceneDelegate: UIResponder, CPTemplateApplicationSceneDelegate {
    private var interfaceController: CPInterfaceController?

    func templateApplicationScene(
        _ templateApplicationScene: CPTemplateApplicationScene,
        didConnect interfaceController: CPInterfaceController
    ) {
        self.interfaceController = interfaceController
        Log.playback.info("CarPlay scene connected")
        // Placeholder root; Task 4 replaces this with the real browse list.
        let item = CPInformationItem(title: "Rawkoon", detail: "CarPlay coming online")
        let template = CPInformationTemplate(
            title: "Rawkoon",
            layout: .leading,
            items: [item],
            actions: []
        )
        interfaceController.setRootTemplate(template, animated: false, completion: nil)
    }

    func templateApplicationScene(
        _ templateApplicationScene: CPTemplateApplicationScene,
        didDisconnectInterfaceController interfaceController: CPInterfaceController
    ) {
        Log.playback.info("CarPlay scene disconnected")
        self.interfaceController = nil
    }
}

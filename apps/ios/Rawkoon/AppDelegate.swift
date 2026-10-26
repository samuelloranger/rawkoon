import RawkoonKit
import UIKit

final class AppDelegate: UIResponder, UIApplicationDelegate {
    #if targetEnvironment(macCatalyst)
        /// SwiftUI's `CommandGroup(replacing:)` leaves these UIKit menus in place on Catalyst.
        override func buildMenu(with builder: any UIMenuBuilder) {
            super.buildMenu(with: builder)
            guard builder.system == .main else { return }
            builder.remove(menu: .document)
            builder.remove(menu: .help)
        }
    #endif

    /// Resolved at launch rather than from a view's onAppear: a background launch
    /// for finished downloads may never render anything.
    @MainActor private var appModel: AppModel {
        AppModel.shared
    }

    func application(
        _: UIApplication,
        didFinishLaunchingWithOptions _: [UIApplication.LaunchOptionsKey: Any]?
    ) -> Bool {
        AppModel.registerBackgroundRefresh()
        #if !targetEnvironment(macCatalyst)
            CastController.configure(player: appModel.player)
        #endif
        Task { @MainActor in
            if appModel.isLoggedIn {
                ReencodeActivityCoordinator.shared.start(model: appModel)
            }
        }
        return true
    }

    func application(_: UIApplication,
                     didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data)
    {
        let token = deviceToken.map { String(format: "%02x", $0) }.joined()
        Task { @MainActor in
            appModel.handleApnsToken(token)
        }
    }

    func application(_: UIApplication,
                     didFailToRegisterForRemoteNotificationsWithError _: Error)
    {
        // Registration can fail in the simulator or without a provisioning
        // profile that includes the push entitlement — non-fatal.
    }

    func application(_: UIApplication,
                     handleEventsForBackgroundURLSession identifier: String,
                     completionHandler: @escaping () -> Void)
    {
        Task { @MainActor in
            appModel.handleBackgroundEvents(identifier: identifier, completionHandler: completionHandler)
        }
    }
}

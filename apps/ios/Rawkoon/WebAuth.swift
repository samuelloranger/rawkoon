import AuthenticationServices
import UIKit

/// Runs a native OAuth round-trip in a system browser sheet and returns the
/// custom-scheme callback URL (`rawkoon://auth?token=…`). Standard native OAuth
/// via ASWebAuthenticationSession.
@MainActor
final class WebAuthCoordinator: NSObject, ASWebAuthenticationPresentationContextProviding {
    static let shared = WebAuthCoordinator()

    private var session: ASWebAuthenticationSession?

    func start(url: URL, scheme: String) async -> URL? {
        await withCheckedContinuation { continuation in
            // The callback fires on a background XPC queue (Mac Catalyst especially).
            // Typing it as an explicit nonisolated @Sendable closure stops Swift 6's
            // default-MainActor isolation from marking it MainActor — which would trap
            // the runtime executor check when it runs off the main thread.
            // `continuation.resume` is safe to call from any thread.
            let onComplete: @Sendable (URL?, (any Error)?) -> Void = { callback, _ in
                continuation.resume(returning: callback)
            }
            let session = ASWebAuthenticationSession(
                url: url, callbackURLScheme: scheme, completionHandler: onComplete
            )
            session.presentationContextProvider = self
            session.prefersEphemeralWebBrowserSession = false
            self.session = session
            session.start()
        }
    }

    func presentationAnchor(for _: ASWebAuthenticationSession) -> ASPresentationAnchor {
        UIApplication.shared.connectedScenes
            .compactMap { $0 as? UIWindowScene }
            .flatMap(\.windows)
            .first { $0.isKeyWindow } ?? ASPresentationAnchor()
    }
}

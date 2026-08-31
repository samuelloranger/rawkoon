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
            let session = ASWebAuthenticationSession(url: url, callbackURLScheme: scheme) { callback, _ in
                continuation.resume(returning: callback)
            }
            session.presentationContextProvider = self
            session.prefersEphemeralWebBrowserSession = false
            self.session = session
            session.start()
        }
    }

    func presentationAnchor(for session: ASWebAuthenticationSession) -> ASPresentationAnchor {
        UIApplication.shared.connectedScenes
            .compactMap { $0 as? UIWindowScene }
            .flatMap { $0.windows }
            .first { $0.isKeyWindow } ?? ASPresentationAnchor()
    }
}

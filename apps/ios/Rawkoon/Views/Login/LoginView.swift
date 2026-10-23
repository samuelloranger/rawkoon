import SwiftUI

/// Sign-in in steps: the server first, then the ways that server offers to sign in.
struct LoginView: View {
    @Environment(AppModel.self) private var model
    @State private var path: [LoginStep]
    /// Set on a user's sign-in tap, so a session restored after unlock doesn't celebrate.
    @State private var signInAttempted = false

    /// A known server skips straight to its sign-in options; the server step stays one back.
    init(hasSavedServer: Bool) {
        _path = State(initialValue: hasSavedServer ? [.signIn] : [])
    }

    var body: some View {
        NavigationStack(path: $path) {
            LoginServerStep { path = [.signIn] }
                .navigationDestination(for: LoginStep.self) { step in
                    switch step {
                    case .signIn:
                        LoginSignInStep(signInAttempted: $signInAttempted) { path.append(.jellyfin) }
                    case .jellyfin:
                        LoginJellyfinStep(signInAttempted: $signInAttempted)
                    }
                }
        }
        .tint(Theme.apricot)
        // An error belongs to the step that raised it.
        .onChange(of: path) { _, _ in
            model.errorMessage = nil
        }
    }
}

/// How the root hands over from Login to the tabs: Login stays on top long enough for its success moment.
nonisolated enum LoginExit {
    /// The sign-in celebration's ring runs about 0.44s.
    static let linger: Duration = .milliseconds(450)

    static func showsLogin(isLoggedIn: Bool, exitFinished: Bool) -> Bool {
        !isLoggedIn || !exitFinished
    }
}

/// What the Sign In button shows; an open session wins over the library load still running behind it.
nonisolated enum SignInFace: Equatable {
    case signedIn, loading, idle

    static func face(loading: Bool, signedIn: Bool) -> Self {
        if signedIn {
            return .signedIn
        }
        return loading ? .loading : .idle
    }
}

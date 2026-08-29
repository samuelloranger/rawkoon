import SwiftUI

@main
struct RawkoonApp: App {
    @UIApplicationDelegateAdaptor(AppDelegate.self) var delegate
    var body: some Scene { WindowGroup { ProbeView() } }
}

final class AppDelegate: NSObject, UIApplicationDelegate {
    func application(_ application: UIApplication,
                     handleEventsForBackgroundURLSession identifier: String,
                     completionHandler: @escaping () -> Void) {
        BackgroundProbe.shared.wakeCompletion = completionHandler
    }
}

struct ProbeView: View {
    @State private var lines: [String] = []
    var body: some View {
        VStack(spacing: 16) {
            Button("Start background download") {
                BackgroundProbe.shared.start(
                    url: URL(string: "https://speed.hetzner.de/100MB.bin")!)
                lines = BackgroundProbe.shared.log
            }
            Button("Refresh log") { lines = BackgroundProbe.shared.log }
            List(lines, id: \.self) { Text($0).font(.caption.monospaced()) }
        }.padding()
    }
}

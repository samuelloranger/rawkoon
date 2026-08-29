import Foundation

final class BackgroundProbe: NSObject, URLSessionDownloadDelegate {
    static let shared = BackgroundProbe()
    private static let logKey = "probe.log"
    /// Set by the app delegate when iOS wakes us for the session.
    var wakeCompletion: (() -> Void)?
    private let defaults: UserDefaults
    private(set) var log: [String] {
        get { defaults.stringArray(forKey: Self.logKey) ?? [] }
        set { defaults.set(newValue, forKey: Self.logKey) }
    }

    private lazy var session: URLSession = {
        let config = URLSessionConfiguration.background(withIdentifier: "cloud.samlo.rawkoon.probe")
        config.isDiscretionary = false
        config.sessionSendsLaunchEvents = true
        return URLSession(configuration: config, delegate: self, delegateQueue: nil)
    }()

    override init() {
        self.defaults = .standard
        super.init()
        append("app launched \(Date())")
    }

    func start(url: URL) {
        append("started \(Date())")
        session.downloadTask(with: url).resume()
    }

    func urlSession(_ session: URLSession, downloadTask: URLSessionDownloadTask,
                    didFinishDownloadingTo location: URL) {
        let status = (downloadTask.response as? HTTPURLResponse)?.statusCode ?? -1
        append("finished status=\(status) at \(Date())")
    }

    func urlSessionDidFinishEvents(forBackgroundURLSession session: URLSession) {
        append("WOKE for background session at \(Date())")
        DispatchQueue.main.async { self.wakeCompletion?(); self.wakeCompletion = nil }
    }

    private func append(_ line: String) {
        var lines = log
        lines.append(line)
        log = lines
    }
}

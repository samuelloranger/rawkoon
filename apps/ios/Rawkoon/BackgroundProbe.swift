import Foundation

final class BackgroundProbe: NSObject, URLSessionDownloadDelegate {
    static let shared = BackgroundProbe()
    /// Set by the app delegate when iOS wakes us for the session.
    var wakeCompletion: (() -> Void)?
    private(set) var log: [String] = []

    private lazy var session: URLSession = {
        let config = URLSessionConfiguration.background(withIdentifier: "cloud.samlo.rawkoon.probe")
        config.isDiscretionary = false
        config.sessionSendsLaunchEvents = true
        return URLSession(configuration: config, delegate: self, delegateQueue: nil)
    }()

    func start(url: URL) {
        log.append("started \(Date())")
        session.downloadTask(with: url).resume()
    }

    func urlSession(_ session: URLSession, downloadTask: URLSessionDownloadTask,
                    didFinishDownloadingTo location: URL) {
        let status = (downloadTask.response as? HTTPURLResponse)?.statusCode ?? -1
        log.append("finished status=\(status) at \(Date())")
    }

    func urlSessionDidFinishEvents(forBackgroundURLSession session: URLSession) {
        log.append("WOKE for background session at \(Date())")
        DispatchQueue.main.async { self.wakeCompletion?(); self.wakeCompletion = nil }
    }
}

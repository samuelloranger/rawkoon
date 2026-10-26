#if !targetEnvironment(macCatalyst)
    import Foundation
    @preconcurrency import GoogleCast
    import RawkoonKit

    /// Plays the loaded audiobook on a Google Cast receiver (the Default Media
    /// Receiver). The receiver streams the same signed URLs the phone does, and
    /// its position flows back into `AudiobookPlayer`, which keeps saving progress.
    @Observable
    final class CastController: NSObject {
        static let shared = CastController()

        /// False under XCTest, where Cast is never set up; the SDK traps if its UI
        /// is built before `configure`.
        private(set) static var isConfigured = false

        /// The receiver's name while it has the book.
        private(set) var deviceName: String?
        /// Why casting stopped, for an alert.
        var castError: String?

        @ObservationIgnored private weak var player: AudiobookPlayer?
        /// Keyed by URL path, which survives a grant refresh, so a status can name its file.
        @ObservationIgnored private var filesByPath: [String: ManifestFile] = [:]
        @ObservationIgnored private var currentFile: ManifestFile?
        /// While a load or seek is in flight the receiver's status still describes
        /// the old place, and must not drag the position back.
        @ObservationIgnored private var awaitingReceiver = false
        /// One refresh-and-reload per failure streak, like the local stream retry.
        @ObservationIgnored private var retriedFailure = false
        @ObservationIgnored private var ticker: Task<Void, Never>?

        /// Must run at launch, before any Cast UI exists.
        static func configure(player: AudiobookPlayer) {
            guard ProcessInfo.processInfo.environment["XCTestConfigurationFilePath"] == nil else { return }
            let criteria = GCKDiscoveryCriteria(applicationID: kGCKDefaultMediaReceiverApplicationID)
            let options = GCKCastOptions(discoveryCriteria: criteria)
            options.physicalVolumeButtonsWillControlDeviceVolume = true
            GCKCastContext.setSharedInstanceWith(options)
            isConfigured = true
            shared.player = player
            GCKCastContext.sharedInstance().sessionManager.add(shared)
        }

        private var sessionManager: GCKSessionManager {
            GCKCastContext.sharedInstance().sessionManager
        }

        private var client: GCKRemoteMediaClient? {
            sessionManager.currentCastSession?.remoteMediaClient
        }

        // MARK: Receiver status

        /// The SDK only reports on changes, so position is sampled once a second
        /// from its extrapolated stream position, like a local periodic observer.
        private func startTicker() {
            ticker?.cancel()
            ticker = Task { [weak self] in
                while !Task.isCancelled {
                    try? await Task.sleep(for: .seconds(1))
                    self?.report()
                }
            }
        }

        private func stopTicker() {
            ticker?.cancel()
            ticker = nil
        }

        private func report() {
            guard !awaitingReceiver, let player, player.isCasting, let client,
                  let status = client.mediaStatus, let file = currentFile
            else { return }
            let playing = [.playing, .buffering, .loading].contains(status.playerState)
            let position = CastQueuePlan.wholeBookPosition(
                file: file, streamPosition: client.approximateStreamPosition()
            )
            player.applyCastStatus(wholeBookPosition: position, playing: playing)
        }

        private func file(for status: GCKMediaStatus) -> ManifestFile? {
            guard let path = status.mediaInformation?.contentURL?.path else { return nil }
            return filesByPath[path]
        }

        private func indexFiles(_ manifest: BookManifest, baseURL: URL?) -> [(ManifestFile, URL)]? {
            var resolved: [(ManifestFile, URL)] = []
            for file in manifest.files {
                guard let url = URL(string: file.url, relativeTo: baseURL)?.absoluteURL else { return nil }
                resolved.append((file, url))
            }
            filesByPath = Dictionary(resolved.map { ($0.1.path, $0.0) }, uniquingKeysWith: { first, _ in first })
            return resolved
        }

        // MARK: Failure

        private func handleFailure() {
            guard let player, player.isCasting else { return }
            guard !retriedFailure, let editionId = player.manifest?.editionId,
                  let refresh = player.refreshManifest
            else {
                stopCasting(reason: failureMessage())
                return
            }
            // An expired grant is the likely cause: fresh URLs, then one more try.
            retriedFailure = true
            let position = player.positionSecs
            Task { [weak self] in
                if let fresh = await refresh(editionId) {
                    self?.player?.adoptRefreshedManifest(fresh)
                }
                self?.load(at: position, autoplay: true)
            }
        }

        private func failureMessage() -> String {
            if player?.baseURL?.scheme == "http" {
                return String(localized: "Cast devices can only play from a server address that starts with https.")
            }
            return String(localized: "The cast device couldn't play this book.")
        }

        private func stopCasting(reason: String) {
            castError = reason
            sessionManager.endSessionAndStopCasting(true)
        }

        private func attach(_ session: GCKSession) {
            deviceName = session.device.friendlyName
            session.remoteMediaClient?.add(self)
            startTicker()
        }
    }

    // MARK: - AudiobookCastRoute

    extension CastController: AudiobookCastRoute {
        func load(at wholeBookPosition: Double, autoplay: Bool) {
            guard let player, let manifest = player.manifest, let client,
                  let start = CastQueuePlan.start(files: manifest.files, at: wholeBookPosition),
                  let files = indexFiles(manifest, baseURL: player.baseURL)
            else { return }

            let cover = player.artworkURL.flatMap { $0.scheme?.hasPrefix("http") == true ? $0 : nil }
            let items = files.map { file, url in
                let metadata = GCKMediaMetadata(metadataType: .audioBookChapter)
                let chapterTitle = manifest.chapters.first(where: { $0.fileId == file.id })?.title
                metadata.setString(manifest.files.count > 1 ? chapterTitle ?? manifest.title : manifest.title,
                                   forKey: kGCKMetadataKeyTitle)
                metadata.setString(manifest.title, forKey: kGCKMetadataKeyBookTitle)
                metadata.setString(manifest.authors.joined(separator: ", "), forKey: kGCKMetadataKeyArtist)
                if let cover {
                    metadata.addImage(GCKImage(url: cover, width: 600, height: 600))
                }
                let info = GCKMediaInformationBuilder(contentURL: url)
                info.streamType = .buffered
                info.contentType = CastQueuePlan.contentType(for: file)
                info.streamDuration = file.durationSecs
                info.metadata = metadata
                let item = GCKMediaQueueItemBuilder()
                item.mediaInformation = info.build()
                item.autoplay = true
                return item.build()
            }

            let queue = GCKMediaQueueDataBuilder(queueType: .audioBook)
            queue.name = manifest.title
            queue.items = items
            queue.startIndex = UInt(start.index)
            queue.startTime = start.offset
            let request = GCKMediaLoadRequestDataBuilder()
            request.queueData = queue.build()
            request.autoplay = NSNumber(value: autoplay)
            request.playbackRate = player.rate

            currentFile = manifest.files[start.index]
            awaitingReceiver = true
            client.loadMedia(with: request.build()).delegate = self
        }

        func play() {
            client?.play()
        }

        func pause() {
            client?.pause()
        }

        func seek(toWholeBook position: Double, autoplay: Bool) {
            guard let player, let manifest = player.manifest, let client,
                  let start = CastQueuePlan.start(files: manifest.files, at: position)
            else { return }
            let target = manifest.files[start.index]
            if target.id == currentFile?.id {
                let options = GCKMediaSeekOptions()
                options.interval = start.offset
                options.resumeState = autoplay ? .play : .unchanged
                awaitingReceiver = true
                client.seek(with: options).delegate = self
                return
            }
            // Another file: jump within the receiver's queue when it knows the item, else reload there.
            let itemID = client.mediaQueue.itemID(at: UInt(start.index))
            guard itemID != kGCKMediaQueueInvalidItemID else {
                load(at: position, autoplay: autoplay)
                return
            }
            currentFile = target
            awaitingReceiver = true
            client.queueJumpToItem(withID: itemID, playPosition: start.offset, customData: nil).delegate = self
        }

        func setRate(_ rate: Float) {
            client?.setPlaybackRate(rate)
        }

        func stop() {
            stopTicker()
            deviceName = nil
            sessionManager.endSessionAndStopCasting(true)
        }
    }

    // MARK: - Session events

    extension CastController: @preconcurrency GCKSessionManagerListener {
        func sessionManager(_: GCKSessionManager, didStart session: GCKSession) {
            guard let player, player.manifest != nil else { return }
            retriedFailure = false
            attach(session)
            player.beginCasting(self, loadBook: true)
        }

        /// Back from the background, or relaunched into a session that outlived the app.
        func sessionManager(_: GCKSessionManager, didResumeSession session: GCKSession) {
            guard let player, let manifest = player.manifest else { return }
            if !player.isCasting {
                // Only adopt a receiver that is still playing this book.
                _ = indexFiles(manifest, baseURL: player.baseURL)
                guard let status = session.remoteMediaClient?.mediaStatus, let file = file(for: status) else { return }
                currentFile = file
                player.beginCasting(self, loadBook: false)
            }
            awaitingReceiver = false
            attach(session)
        }

        func sessionManager(_: GCKSessionManager, didSuspend _: GCKSession, with _: GCKConnectionSuspendReason) {
            stopTicker()
        }

        func sessionManager(_: GCKSessionManager, didEnd session: GCKSession, withError error: (any Error)?) {
            stopTicker()
            session.remoteMediaClient?.remove(self)
            if error != nil, castError == nil, let name = deviceName {
                castError = String(localized: "Lost the connection to \(name).")
            }
            deviceName = nil
            currentFile = nil
            awaitingReceiver = false
            player?.endCasting()
        }

        func sessionManager(_: GCKSessionManager, didFailToStart session: GCKSession, withError _: any Error) {
            let name = session.device.friendlyName ?? String(localized: "the cast device")
            castError = String(localized: "Couldn't connect to \(name).")
        }
    }

    // MARK: - Media status

    extension CastController: @preconcurrency GCKRemoteMediaClientListener {
        func remoteMediaClient(_: GCKRemoteMediaClient, didUpdate mediaStatus: GCKMediaStatus?) {
            guard let mediaStatus, let player, player.isCasting else { return }
            if let file = file(for: mediaStatus) {
                currentFile = file
            }
            switch mediaStatus.playerState {
            case .playing:
                retriedFailure = false
            case .idle:
                switch mediaStatus.idleReason {
                case .finished where currentFile?.id == player.manifest?.files.last?.id:
                    // The last file ended: the book is done, at its very end.
                    player.applyCastStatus(wholeBookPosition: player.duration, playing: false)
                    return
                case .error:
                    handleFailure()
                    return
                default:
                    break
                }
            default:
                break
            }
            report()
        }
    }

    extension CastController: @preconcurrency GCKRequestDelegate {
        func requestDidComplete(_: GCKRequest) {
            awaitingReceiver = false
            report()
        }

        /// Superseded by a newer request, which will report for itself.
        func request(_: GCKRequest, didAbortWith _: GCKRequestAbortReason) {
            awaitingReceiver = false
        }

        func request(_: GCKRequest, didFailWithError error: GCKError) {
            awaitingReceiver = false
            Log.playback.error("Cast request failed: \(error.localizedDescription, privacy: .public)")
            handleFailure()
        }
    }
#endif

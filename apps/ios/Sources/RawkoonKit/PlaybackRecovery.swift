import Foundation

/// The MIME type of an audio file, judged from its first bytes, or nil.
///
/// Downloaded chapters are stored as `<fileId>.bin` because grant URLs carry
/// no extension, and AVFoundation picks its parser from the extension: a
/// `.bin` fails with "Cannot Open" however valid the bytes are. Passing the
/// sniffed type as `AVURLAssetOverrideMIMETypeKey` is what makes it open.
public func sniffedAudioMIMEType(_ header: Data) -> String? {
    let bytes = [UInt8](header.prefix(12))
    func matches(_ ascii: String, at offset: Int = 0) -> Bool {
        let expected = Array(ascii.utf8)
        guard bytes.count >= offset + expected.count else { return false }
        return Array(bytes[offset ..< offset + expected.count]) == expected
    }
    if matches("ID3") {
        return "audio/mpeg"
    }
    if matches("ftyp", at: 4) {
        return "audio/mp4"
    }
    if matches("OggS") {
        return "audio/ogg"
    }
    if matches("fLaC") {
        return "audio/flac"
    }
    if matches("RIFF"), matches("WAVE", at: 8) {
        return "audio/wav"
    }
    // Both start on a frame sync; the layer bits are 00 for ADTS AAC and
    // non-zero for MPEG audio (an untagged MP3).
    if bytes.count >= 2, bytes[0] == 0xFF, bytes[1] & 0xF0 == 0xF0, bytes[1] & 0x06 == 0 {
        return "audio/aac"
    }
    if bytes.count >= 2, bytes[0] == 0xFF, bytes[1] & 0xE0 == 0xE0, bytes[1] & 0x06 != 0 {
        return "audio/mpeg"
    }
    return nil
}

/// Whether two manifests describe the same physical files, so only their
/// signed URLs differ. A re-import changes ids, sizes or offsets, and must be
/// reloaded rather than having fresh URLs swapped in.
public func sameFileLayout(_ lhs: [ManifestFile], _ rhs: [ManifestFile]) -> Bool {
    guard lhs.count == rhs.count else { return false }
    let byId = Dictionary(rhs.map { ($0.id, $0) }, uniquingKeysWith: { first, _ in first })
    return lhs.allSatisfy { file in
        guard let other = byId[file.id] else { return false }
        return other.sizeBytes == file.sizeBytes
            && other.startSecs == file.startSecs
            && other.durationSecs == file.durationSecs
    }
}

/// Why playback had to stop, so the listener is told what actually went wrong.
public enum PlaybackStopReason: Equatable, Sendable {
    /// No network, and the chapter is not playable from this device.
    case offline
    /// The stream failed again right after a retry with fresh URLs.
    case streamFailed
    /// Neither the local copy nor a stream could be opened.
    case unreadable
}

/// What to do when a chapter's player item fails.
public enum PlaybackFailureAction: Equatable, Sendable {
    /// The local copy failed to open: stream it this session, keep the file.
    case streamInstead
    /// The stream failed: fetch fresh signed URLs and rebuild once.
    case refreshAndRetry
    case stop(PlaybackStopReason)
}

/// A stream retried this recently and failing again is not a blip.
let streamRetryWindowSecs = 60.0

/// Decides the next step after a player item fails.
///
/// A stream fails for two reasons in practice: the cached manifest's signed
/// grant expired (seven days), or the signal dropped mid-drive. Both deserve
/// one retry with fresh URLs before the book stops.
public func playbackFailureAction(
    isLocalFile: Bool,
    localAlreadyFailed: Bool,
    secondsSinceStreamRetry: Double?,
    isOnline: Bool
) -> PlaybackFailureAction {
    if isLocalFile {
        return localAlreadyFailed ? .stop(.unreadable) : .streamInstead
    }
    guard isOnline else {
        return .stop(.offline)
    }
    if let secondsSinceStreamRetry, secondsSinceStreamRetry < streamRetryWindowSecs {
        return .stop(.streamFailed)
    }
    return .refreshAndRetry
}

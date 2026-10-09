import ImageIO
import SwiftUI
import UIKit

/// Immutable downsampled result, safe to hand back from the nonisolated loader
/// to the `@MainActor` view (`UIImage` is not `Sendable`, but a decoded one is
/// never mutated).
private struct LoadedImage: @unchecked Sendable {
    let image: UIImage
}

/// Shared poster/cover cache. `AsyncImage` keeps nothing across a view's
/// lifetime, so scrolling a list refetches and re-decodes every cover; this
/// holds decoded images in memory (`NSCache`) and raw bytes on disk
/// (`URLCache`), and downsamples to the display size so a 46pt row never
/// decodes a 500px poster.
enum PosterCache {
    /// Decoded images, keyed by URL+size. `NSCache` is internally synchronized,
    /// so the shared instance is safe to touch from any task.
    nonisolated(unsafe) static let decoded: NSCache<NSString, UIImage> = {
        let cache = NSCache<NSString, UIImage>()
        cache.totalCostLimit = 64 * 1024 * 1024 // ~64 MB of decoded pixels
        return cache
    }()

    /// A dedicated session so image bytes never evict the API client's JSON
    /// responses (and vice-versa).
    static let session: URLSession = {
        let config = URLSessionConfiguration.default
        config.urlCache = URLCache(
            memoryCapacity: 16 * 1024 * 1024,
            diskCapacity: 256 * 1024 * 1024,
            directory: nil
        )
        config.requestCachePolicy = .useProtocolCachePolicy
        return URLSession(configuration: config)
    }()

    private static func key(_ url: URL, _ maxPixel: CGFloat) -> NSString {
        "\(url.absoluteString)|\(Int(maxPixel))" as NSString
    }

    /// Synchronous memory-cache peek — lets a recycled cell paint instantly on
    /// scroll-back instead of flashing its placeholder for a frame.
    static func cached(_ url: URL?, maxPixel: CGFloat) -> UIImage? {
        guard let url else { return nil }
        return decoded.object(forKey: key(url, maxPixel))
    }

    fileprivate static func load(_ url: URL, maxPixel: CGFloat) async -> LoadedImage? {
        let cacheKey = key(url, maxPixel)
        if let hit = decoded.object(forKey: cacheKey) {
            return LoadedImage(image: hit)
        }
        guard let data = await fetchData(url) else { return nil }
        guard !Task.isCancelled, let image = downsample(data: data, maxPixel: maxPixel) else { return nil }
        decoded.setObject(image, forKey: cacheKey, cost: cost(image))
        return LoadedImage(image: image)
    }

    /// A request right after the app resumes often dies on a stale connection, so a
    /// transient failure is retried before giving up; a stored copy still wins offline.
    private static func fetchData(_ url: URL) async -> Data? {
        for attempt in 0 ..< 3 {
            do {
                return try await session.data(for: URLRequest(url: url, cachePolicy: policy(for: url))).0
            } catch {
                if error is CancellationError || (error as? URLError)?.code == .cancelled {
                    return nil
                }
                if let stored = try? await session.data(for: URLRequest(url: url, cachePolicy: .returnCacheDataDontLoad)) {
                    return stored.0
                }
                try? await Task.sleep(for: .milliseconds(500 * (attempt + 1)))
            }
        }
        return nil
    }

    static var diskUsage: Int {
        session.configuration.urlCache?.currentDiskUsage ?? 0
    }

    static func removeAll() {
        session.configuration.urlCache?.removeAllCachedResponses()
        decoded.removeAllObjects()
    }

    /// Downloads an image into the disk cache at the size `CachedAsyncImage` will
    /// ask for, without decoding it — so a screen opened offline has its artwork.
    static func prefetch(_ url: URL, targetSize: CGSize, scale: CGFloat) async {
        let sized = url.tmdbSized(maxPixelWidth: targetSize.width * scale) ?? url
        var request = URLRequest(url: sized, cachePolicy: policy(for: sized))
        request.allowsConstrainedNetworkAccess = false
        request.allowsExpensiveNetworkAccess = false
        _ = try? await session.data(for: request)
    }

    /// TMDB never changes the image behind a URL, so a stored copy needs no
    /// revalidation; self-hosted artwork can be replaced in place, so it keeps
    /// the server's cache headers.
    private static func policy(for url: URL) -> URLRequest.CachePolicy {
        url.host == "image.tmdb.org" ? .returnCacheDataElseLoad : .useProtocolCachePolicy
    }

    private static func downsample(data: Data, maxPixel: CGFloat) -> UIImage? {
        let sourceOptions = [kCGImageSourceShouldCache: false] as CFDictionary
        guard let source = CGImageSourceCreateWithData(data as CFData, sourceOptions) else {
            return nil
        }
        let options: [CFString: Any] = [
            kCGImageSourceCreateThumbnailFromImageAlways: true,
            kCGImageSourceShouldCacheImmediately: true,
            kCGImageSourceCreateThumbnailWithTransform: true,
            kCGImageSourceThumbnailMaxPixelSize: Int(max(1, maxPixel)),
        ]
        guard let cgImage = CGImageSourceCreateThumbnailAtIndex(source, 0, options as CFDictionary) else {
            return nil
        }
        return UIImage(cgImage: cgImage)
    }

    private static func cost(_ image: UIImage) -> Int {
        guard let cgImage = image.cgImage else { return 0 }
        return cgImage.bytesPerRow * cgImage.height
    }
}

extension URL {
    /// Rewrites a TMDB image URL's size segment (`/t/p/{size}/…`) to the
    /// smallest bucket that covers `maxPixelWidth`. Returns `nil` for non-TMDB
    /// hosts (Google Books covers, self-hosted posters) so the caller keeps the
    /// original URL. Mirrors the web `toThumbnailUrl`.
    func tmdbSized(maxPixelWidth: CGFloat) -> URL? {
        guard host == "image.tmdb.org" else { return nil }
        let parts = pathComponents // ["/", "t", "p", "w500", "poster.jpg"]
        guard parts.count >= 5, parts[1] == "t", parts[2] == "p" else { return nil }

        let buckets = [92, 154, 185, 342, 500, 780]
        let want = Int(maxPixelWidth.rounded(.up))
        let pick = buckets.first(where: { $0 >= want }) ?? buckets[buckets.count - 1]

        var rewritten = parts
        rewritten[3] = "w\(pick)"
        var components = URLComponents(url: self, resolvingAgainstBaseURL: false)
        components?.path = "/" + rewritten.dropFirst().joined(separator: "/")
        return components?.url
    }
}

/// Drop-in caching replacement for `AsyncImage` with the same `content` /
/// `placeholder` closure shape. `targetSize` is the frame in points; the view
/// picks the TMDB size bucket and downsamples to `targetSize × displayScale`.
struct CachedAsyncImage<Content: View, Placeholder: View>: View {
    private let url: URL?
    private let targetSize: CGSize
    private let content: (Image) -> Content
    private let placeholder: () -> Placeholder

    @Environment(\.displayScale) private var displayScale
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.scenePhase) private var scenePhase
    @State private var uiImage: UIImage?
    @State private var loadedURL: URL?

    init(
        url: URL?,
        targetSize: CGSize,
        @ViewBuilder content: @escaping (Image) -> Content,
        @ViewBuilder placeholder: @escaping () -> Placeholder
    ) {
        self.url = url
        self.targetSize = targetSize
        self.content = content
        self.placeholder = placeholder
    }

    private var maxPixel: CGFloat {
        max(targetSize.width, targetSize.height) * displayScale
    }

    private var resolvedURL: URL? {
        guard let url else { return nil }
        return url.tmdbSized(maxPixelWidth: targetSize.width * displayScale) ?? url
    }

    var body: some View {
        let shown = uiImage ?? PosterCache.cached(resolvedURL, maxPixel: maxPixel)
        Group {
            if let shown {
                content(Image(uiImage: shown)).transition(.opacity)
            } else {
                placeholder().transition(.opacity)
            }
        }
        // Crossfade the placeholder → image swap so posters/covers fade in
        // instead of popping. A synchronous cache hit renders `shown` non-nil on
        // the first pass, so cached images never animate — only real loads fade.
        // motion-ok: already gates on Reduce Motion here
        .animation(reduceMotion ? nil : .easeOut(duration: 0.35), value: shown != nil)
        // Re-keyed on scene phase so a cover that failed while the app was away loads on return.
        .task(id: LoadKey(url: resolvedURL, active: scenePhase == .active)) { await load() }
    }

    private struct LoadKey: Hashable {
        var url: URL?
        var active: Bool
    }

    private func load() async {
        guard let resolvedURL else {
            uiImage = nil
            loadedURL = nil
            return
        }
        if uiImage != nil, loadedURL == resolvedURL {
            return
        }
        if let loaded = await PosterCache.load(resolvedURL, maxPixel: maxPixel) {
            uiImage = loaded.image
            loadedURL = resolvedURL
        }
    }
}

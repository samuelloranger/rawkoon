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
    // NSCache is internally synchronized; the URLSession is its own so image
    // bytes never evict the API client's JSON responses (and vice-versa).
    nonisolated(unsafe) static let decoded: NSCache<NSString, UIImage> = {
        let cache = NSCache<NSString, UIImage>()
        cache.totalCostLimit = 64 * 1024 * 1024 // ~64 MB of decoded pixels
        return cache
    }()

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
        do {
            let (data, _) = try await session.data(from: url)
            try Task.checkCancellation()
            guard let image = downsample(data: data, maxPixel: maxPixel) else { return nil }
            decoded.setObject(image, forKey: cacheKey, cost: cost(image))
            return LoadedImage(image: image)
        } catch {
            return nil
        }
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
    @State private var uiImage: UIImage?

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
                content(Image(uiImage: shown))
            } else {
                placeholder()
            }
        }
        .task(id: resolvedURL) { await load() }
    }

    private func load() async {
        guard let resolvedURL else {
            uiImage = nil
            return
        }
        if let loaded = await PosterCache.load(resolvedURL, maxPixel: maxPixel) {
            uiImage = loaded.image
        }
    }
}

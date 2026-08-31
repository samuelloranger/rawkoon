import RawkoonKit
import SwiftUI
import UIKit
import WebKit

struct EbookPreviewDocument: Identifiable, Sendable {
    /// The book file's id — also what names the extracted directory.
    let id: Int
    /// The ebook edition this file belongs to, when the server told us.
    /// Reading progress is keyed by edition, so it is off without one.
    let editionId: Int?
    let title: String
    let localURL: URL
}

/// What the reader needs once the archive is on disk: where it was unpacked and
/// the spine order to page through.
private struct OpenedEpub: Sendable {
    let root: URL
    let package: EpubPackage
}

private enum ReaderState {
    case opening
    case ready(OpenedEpub)
    case failed(String)
}

/// In-app EPUB reading.
///
/// QuickLook was the first attempt and it has no EPUB previewer on iOS — it
/// renders the generic "here is a file" card with the name and size, which is
/// not reading. So the archive is unpacked and its spine documents are rendered
/// in a `WKWebView` one at a time.
struct EbookReaderSheet: View {
    let document: EbookPreviewDocument

    @EnvironmentObject private var model: AppModel
    @Environment(\.dismiss) private var dismiss
    @State private var state: ReaderState = .opening
    @State private var spineIndex = 0
    /// Offset to apply once the next document has loaded, then cleared — a
    /// restore must not fight the reader's own scrolling afterwards.
    @State private var pendingScrollFraction: Double?
    @State private var scrollFraction: Double = 0
    @State private var lastPersistMillis: Int64 = 0

    /// A scroll inside one chapter is not worth a write per frame; a chapter
    /// change always is.
    private static let scrollPersistIntervalMillis: Int64 = 3_000

    var body: some View {
        NavigationStack {
            content
                .background(Theme.base)
                .navigationTitle(navigationTitle)
                .navigationBarTitleDisplayMode(.inline)
                .toolbar {
                    ToolbarItem(placement: .topBarLeading) {
                        Button("Done") {
                            persist(force: true)
                            dismiss()
                        }
                    }
                }
                .safeAreaInset(edge: .bottom) {
                    if case let .ready(epub) = state {
                        pager(epub)
                    }
                }
        }
        .task { await open() }
        // Backgrounding or a swipe-to-dismiss never runs the Done button.
        .onDisappear { persist(force: true) }
    }

    private var navigationTitle: String {
        if case let .ready(epub) = state, let title = epub.package.title, !title.isEmpty {
            return title
        }
        return document.title
    }

    @ViewBuilder private var content: some View {
        switch state {
        case .opening:
            VStack(spacing: 10) {
                ProgressView().tint(Theme.importing)
                Text("Opening book…")
                    .font(.subheadline)
                    .foregroundStyle(Theme.muted)
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)

        case let .failed(message):
            VStack(spacing: 8) {
                Image(systemName: "book.closed")
                    .font(.system(size: 30))
                    .foregroundStyle(Theme.muted)
                Text("Could not open this EPUB")
                    .font(.display(17))
                    .foregroundStyle(Theme.textStrong)
                Text(message)
                    .font(.caption)
                    .foregroundStyle(Theme.muted)
                    .multilineTextAlignment(.center)
            }
            .padding(24)
            .frame(maxWidth: .infinity, maxHeight: .infinity)

        case let .ready(epub):
            let clamped = min(max(spineIndex, 0), epub.package.documents.count - 1)
            EpubWebView(
                fileURL: epub.root.appendingPathComponent(
                    epub.package.documents[clamped].path
                ),
                readAccessRoot: epub.root,
                restoreScrollFraction: pendingScrollFraction,
                onRestored: { pendingScrollFraction = nil },
                onScroll: { fraction in
                    scrollFraction = fraction
                    persist(force: false)
                }
            )
            .id(clamped)
        }
    }

    private func pager(_ epub: OpenedEpub) -> some View {
        let total = epub.package.documents.count
        return HStack(spacing: 12) {
            Button {
                move(to: spineIndex - 1, in: epub)
            } label: {
                Label("Previous", systemImage: "chevron.left")
                    .labelStyle(.iconOnly)
                    .frame(width: 40, height: 32)
            }
            .buttonStyle(.bordered)
            .tint(Theme.importing)
            .disabled(spineIndex <= 0)

            Text("\(spineIndex + 1) / \(total)")
                .font(.system(.caption, design: .monospaced))
                .foregroundStyle(Theme.muted)
                .frame(maxWidth: .infinity)

            Button {
                move(to: spineIndex + 1, in: epub)
            } label: {
                Label("Next", systemImage: "chevron.right")
                    .labelStyle(.iconOnly)
                    .frame(width: 40, height: 32)
            }
            .buttonStyle(.bordered)
            .tint(Theme.importing)
            .disabled(spineIndex >= total - 1)
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 8)
        .background(.ultraThinMaterial)
    }

    private func move(to index: Int, in epub: OpenedEpub) {
        let total = epub.package.documents.count
        let target = min(max(index, 0), total - 1)
        guard target != spineIndex else { return }
        spineIndex = target
        // A new chapter starts at the top, and the offset from the old one must
        // not be carried over or reported for it.
        scrollFraction = 0
        pendingScrollFraction = nil
        persist(force: true)
    }

    private func open() async {
        guard case .opening = state else { return }
        let source = document.localURL
        let destination = FileStore.epubExtractionURL(fileId: document.id)

        let result = await Task.detached(priority: .userInitiated) { () -> Result<OpenedEpub, Error> in
            do {
                let archive = try ZipArchive(data: try Data(contentsOf: source, options: .mappedIfSafe))
                let package = try EpubParser.parse(archive: archive)

                // Re-extract when the spine's first document is missing: a
                // half-written extraction from a previous crash is worse than
                // paying the unzip again.
                let probe = destination.appendingPathComponent(package.documents[0].path)
                if !FileManager.default.fileExists(atPath: probe.path) {
                    try? FileManager.default.removeItem(at: destination)
                    try archive.extract(to: destination)
                }
                return .success(OpenedEpub(root: destination, package: package))
            } catch {
                return .failure(error)
            }
        }.value

        switch result {
        case let .success(epub):
            if let editionId = document.editionId {
                let resumed = await model.readingPosition(
                    editionId: editionId,
                    spine: epub.package.documents.map(\.path)
                )
                spineIndex = resumed.index
                scrollFraction = resumed.scrollFraction
                pendingScrollFraction = resumed.scrollFraction > 0 ? resumed.scrollFraction : nil
            } else {
                spineIndex = 0
                scrollFraction = 0
            }
            state = .ready(epub)
        case let .failure(error):
            state = .failed(Self.describe(error))
        }
    }

    private func persist(force: Bool) {
        guard case let .ready(epub) = state, let editionId = document.editionId else { return }
        let now = Int64(Date().timeIntervalSince1970 * 1000)
        if !force, now - lastPersistMillis < Self.scrollPersistIntervalMillis { return }
        lastPersistMillis = now

        let total = epub.package.documents.count
        let index = min(max(spineIndex, 0), total - 1)
        model.saveReadingPosition(
            ReadingPosition(
                editionId: editionId,
                fileId: document.id,
                spineIndex: index,
                spinePath: epub.package.documents[index].path,
                spineCount: total,
                scrollFraction: scrollFraction,
                // Only the last document scrolled to the end counts as read.
                finished: index == total - 1 && scrollFraction >= 0.99,
                updatedAtMillis: now
            )
        )
    }

    private static func describe(_ error: Error) -> String {
        switch error {
        case ZipError.notAZipArchive:
            return "The file is not a valid EPUB container."
        case ZipError.zip64Unsupported:
            return "This EPUB uses ZIP64, which Rawkoon cannot read yet."
        case let ZipError.unsupportedCompression(method):
            return "Unsupported compression in the archive (method \(method))."
        case EpubError.missingContainer, EpubError.missingRootfile:
            return "The EPUB is missing its container manifest."
        case let EpubError.missingPackage(path):
            return "The EPUB package file is missing (\(path))."
        case EpubError.emptySpine:
            return "The EPUB declares no reading order."
        default:
            return error.localizedDescription
        }
    }
}

/// One spine document, rendered from the extracted directory.
///
/// `loadFileURL(_:allowingReadAccessTo:)` must be granted the archive root, not
/// the document's own directory, or every relative stylesheet and image in a
/// sibling folder fails to load and the page renders unstyled.
private struct EpubWebView: UIViewRepresentable {
    let fileURL: URL
    let readAccessRoot: URL
    let restoreScrollFraction: Double?
    let onRestored: () -> Void
    let onScroll: (Double) -> Void

    private static let scrollHandlerName = "rawkoonScroll"

    func makeCoordinator() -> Coordinator {
        Coordinator(onScroll: onScroll, onRestored: onRestored)
    }

    func makeUIView(context: Context) -> WKWebView {
        let configuration = WKWebViewConfiguration()
        configuration.userContentController.addUserScript(
            WKUserScript(
                source: Self.readingStyle,
                injectionTime: .atDocumentEnd,
                forMainFrameOnly: true
            )
        )
        configuration.userContentController.addUserScript(
            WKUserScript(
                source: Self.scrollReporter,
                injectionTime: .atDocumentEnd,
                forMainFrameOnly: true
            )
        )
        configuration.userContentController.add(
            context.coordinator,
            name: Self.scrollHandlerName
        )

        let webView = WKWebView(frame: .zero, configuration: configuration)
        webView.navigationDelegate = context.coordinator
        webView.isOpaque = false
        webView.backgroundColor = .clear
        webView.scrollView.backgroundColor = .clear
        webView.allowsBackForwardNavigationGestures = true
        context.coordinator.restoreFraction = restoreScrollFraction
        webView.loadFileURL(fileURL, allowingReadAccessTo: readAccessRoot)
        return webView
    }

    func updateUIView(_ webView: WKWebView, context: Context) {
        context.coordinator.onScroll = onScroll
        context.coordinator.onRestored = onRestored
        guard webView.url?.standardizedFileURL != fileURL.standardizedFileURL else { return }
        context.coordinator.restoreFraction = restoreScrollFraction
        webView.loadFileURL(fileURL, allowingReadAccessTo: readAccessRoot)
    }

    final class Coordinator: NSObject, WKNavigationDelegate, WKScriptMessageHandler {
        var onScroll: (Double) -> Void
        var onRestored: () -> Void
        var restoreFraction: Double?

        init(onScroll: @escaping (Double) -> Void, onRestored: @escaping () -> Void) {
            self.onScroll = onScroll
            self.onRestored = onRestored
        }

        func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
            guard let fraction = restoreFraction, fraction > 0 else {
                onRestored()
                return
            }
            restoreFraction = nil
            // Layout is not final at didFinish for a document that is still
            // loading images, so the offset is applied on the next frame.
            let script = """
            requestAnimationFrame(function () {
              var target = document.documentElement.scrollHeight - window.innerHeight;
              window.scrollTo(0, Math.max(target, 0) * \(fraction));
            });
            """
            webView.evaluateJavaScript(script) { _, _ in }
            onRestored()
        }

        func userContentController(
            _ controller: WKUserContentController,
            didReceive message: WKScriptMessage
        ) {
            guard let fraction = message.body as? Double else { return }
            onScroll(min(max(fraction, 0), 1))
        }
    }

    /// The app is dark-only, and publisher CSS assumes paper. Force a readable
    /// dark page with `!important` because most EPUB stylesheets set colors on
    /// body and on individual paragraphs.
    private static let readingStyle = """
    (function () {
      var css = "html,body{background:#14100e!important;color:#ece3d8!important;" +
        "font-size:19px!important;line-height:1.62!important;" +
        "padding:6px 18px 24px!important;margin:0!important;" +
        "-webkit-text-size-adjust:100%;}" +
        "p,div,span,li,td,h1,h2,h3,h4,h5,h6,blockquote{color:#ece3d8!important;" +
        "background:transparent!important;}" +
        "a{color:#e79b6b!important;}" +
        "img,svg,image{max-width:100%!important;height:auto!important;}" +
        "hr{border-color:#3a2f28!important;}";
      var style = document.createElement("style");
      style.appendChild(document.createTextNode(css));
      document.head ? document.head.appendChild(style)
                    : document.documentElement.appendChild(style);
    })();
    """

    /// Reports the scroll offset as a 0–1 fraction, coalesced to one message per
    /// frame — a raw scroll listener fires often enough to saturate the bridge.
    private static let scrollReporter = """
    (function () {
      var queued = false;
      function report() {
        queued = false;
        var target = document.documentElement.scrollHeight - window.innerHeight;
        var fraction = target > 0 ? window.scrollY / target : 0;
        window.webkit.messageHandlers.rawkoonScroll.postMessage(fraction);
      }
      window.addEventListener("scroll", function () {
        if (queued) return;
        queued = true;
        requestAnimationFrame(report);
      }, { passive: true });
    })();
    """
}

import RawkoonKit
@preconcurrency import ReadiumNavigator
@preconcurrency import ReadiumShared
@preconcurrency import ReadiumStreamer
import SwiftUI
import UIKit

private typealias EPUBLink = ReadiumShared.Link

struct EbookPreviewDocument: Identifiable, Sendable {
    /// The book file's id on disk.
    let id: Int
    /// The ebook edition this file belongs to, when the server told us.
    /// Reading progress is keyed by edition, so it is off without one.
    let editionId: Int?
    /// Rawkoon's own language for the book, used to override the EPUB's.
    ///
    /// An EPUB can declare several `dc:language` values and the reader takes the
    /// first. "La femme de ménage" lists `ar, en, fr`, so Readium picked Arabic
    /// and laid a French novel out right-to-left. Rawkoon knows the real
    /// language, so it wins.
    let language: String?
    let title: String
    let localURL: URL
}

private enum ReaderState {
    case opening
    case ready(ReaderSession)
    case failed(String)
}

/// Global (not per-book) typography, persisted in UserDefaults and submitted
/// to the navigator as `EPUBPreferences`. `lineHeight` only takes effect when
/// publisher styles are off, so that flag is always included in the mapping.
private struct ReaderPreferences: Codable, Equatable {
    var fontSize: Double
    var lineHeight: Double
    var pageMargins: Double
    var theme: ReaderTheme

    static let `default` = ReaderPreferences(
        fontSize: 1.0,
        lineHeight: 1.5,
        pageMargins: 1.0,
        theme: .dark
    )

    private static let defaultsKey = "rawkoon.reader.epub.preferences"

    static func load() -> ReaderPreferences {
        guard
            let data = UserDefaults.standard.data(forKey: defaultsKey),
            let decoded = try? JSONDecoder().decode(ReaderPreferences.self, from: data)
        else {
            return .default
        }
        return decoded
    }

    func save() {
        guard let data = try? JSONEncoder().encode(self) else { return }
        UserDefaults.standard.set(data, forKey: Self.defaultsKey)
    }

    func asEPUBPreferences(language: String?) -> EPUBPreferences {
        EPUBPreferences(
            fontSize: fontSize,
            language: language.map { Language(code: .bcp47($0)) },
            lineHeight: lineHeight,
            pageMargins: pageMargins,
            publisherStyles: false,
            scroll: false,
            theme: theme.readiumTheme
        )
    }
}

private enum ReaderTheme: String, Codable, CaseIterable, Identifiable {
    case light
    case sepia
    case dark

    var id: String {
        rawValue
    }

    var label: String {
        switch self {
        case .light: "Light"
        case .sepia: "Sepia"
        case .dark: "Dark"
        }
    }

    var readiumTheme: ReadiumNavigator.Theme {
        switch self {
        case .light: .light
        case .sepia: .sepia
        case .dark: .dark
        }
    }
}

/// Observable chrome so the footer and TOC highlight refresh when the
/// navigator reports a new locator. The session itself is not observed.
@MainActor
@Observable
private final class ReaderChrome {
    var currentLocator: Locator?
    var percent: Double?
}

@MainActor
private final class ReaderSession {
    let publication: Publication
    let host: ReaderViewController
    let tableOfContents: [EPUBLink]
    private var lastPersistMillis: Int64 = 0
    private var currentLocator: Locator?
    private let editionId: Int?
    private let fileId: Int
    private let save: (ReadingPosition) -> Void

    var navigator: EPUBNavigatorViewController {
        host.navigator
    }

    init(
        publication: Publication,
        host: ReaderViewController,
        tableOfContents: [EPUBLink],
        editionId: Int?,
        fileId: Int,
        save: @escaping (ReadingPosition) -> Void
    ) {
        self.publication = publication
        self.host = host
        self.tableOfContents = tableOfContents
        self.editionId = editionId
        self.fileId = fileId
        self.save = save
    }

    func handleLocationChange(_ locator: Locator) {
        currentLocator = locator
        persist(force: false)
    }

    func persist(force: Bool) {
        guard let editionId else { return }
        guard let locator = currentLocator ?? navigator.currentLocation else { return }
        let now = Int64(Date().timeIntervalSince1970 * 1000)
        if !force, now - lastPersistMillis < 3000 {
            return
        }
        lastPersistMillis = now
        save(position(from: locator, editionId: editionId, now: now))
    }

    private func position(from locator: Locator, editionId: Int, now: Int64) -> ReadingPosition {
        let index = publication.readingOrder.firstIndexWithHREF(locator.href) ?? 0
        let spinePath: String = if publication.readingOrder.indices.contains(index) {
            publication.readingOrder[index].href
        } else {
            locator.href.string
        }
        return ReadingPosition(
            editionId: editionId,
            fileId: fileId,
            spineIndex: index,
            spinePath: spinePath,
            spineCount: publication.readingOrder.count,
            scrollFraction: locator.locations.progression ?? 0,
            finished: (locator.locations.totalProgression ?? 0) >= 0.99,
            updatedAtMillis: now,
            locator: try? locator.jsonString()
        )
    }
}

/// In-app EPUB reading via Readium's navigator. Readium owns the WKWebView,
/// its injected JS and the scheme handler that serves publication resources.
struct EbookReaderSheet: View {
    let document: EbookPreviewDocument

    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss
    @State private var chrome = ReaderChrome()
    @State private var state: ReaderState = .opening
    @State private var preferences = ReaderPreferences.load()
    @State private var showTOC = false
    @State private var showSettings = false
    // DEBUG only: RAWKOON_CONTROLS=1 starts with the capsule shown, so the
    // controls can be screenshotted on the simulator without tap injection.
    #if DEBUG
        @State private var controlsVisible =
            ProcessInfo.processInfo.environment["RAWKOON_CONTROLS"] == "1"
    #else
        @State private var controlsVisible = false
    #endif
    /// Cancelled and restarted on every reveal, so the controls always fade a
    /// fixed time after the last interaction rather than the first.
    @State private var hideTask: Task<Void, Never>?

    var body: some View {
        // No navigation bar and no title: a reader's job is to disappear, and a
        // bar costs about a tenth of the screen on every page. The controls are
        // summoned by a tap in the middle third instead.
        ZStack {
            Theme.base.ignoresSafeArea()
            content
                .ignoresSafeArea()
            percentReadout
            floatingControls
        }
        .statusBarHidden(!controlsVisible)
        .persistentSystemOverlays(controlsVisible ? .automatic : .hidden)
        .animation(.easeInOut(duration: 0.2), value: controlsVisible)
        .sheet(isPresented: $showTOC) {
            if case let .ready(session) = state {
                TableOfContentsSheet(
                    links: session.tableOfContents,
                    currentLocator: chrome.currentLocator,
                    onSelect: { link in
                        showTOC = false
                        Task { await session.navigator.go(to: link, options: .animated) }
                    }
                )
            }
        }
        .sheet(isPresented: $showSettings) {
            ReaderSettingsSheet(preferences: $preferences)
        }
        .task { await open() }
        .onChange(of: preferences) { _, new in
            new.save()
            if case let .ready(session) = state {
                session.navigator.submitPreferences(new.asEPUBPreferences(language: document.language))
            }
        }
        // Backgrounding or a swipe-to-dismiss never runs the Done button.
        .onDisappear {
            if case let .ready(session) = state {
                session.persist(force: true)
            }
        }
    }

    private var navigationTitle: String {
        if case let .ready(session) = state,
           let title = session.publication.metadata.title,
           !title.isEmpty
        {
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
            VStack(spacing: 12) {
                Image(systemName: "book.closed")
                    .font(.system(size: 30))
                    .foregroundStyle(Theme.muted)
                Text("Could not open this ebook")
                    .font(.display(17))
                    .foregroundStyle(Theme.textStrong)
                Text(message)
                    .font(.caption)
                    .foregroundStyle(Theme.muted)
                    .multilineTextAlignment(.center)
                Button("Close") { persistAndDismiss() }
                    .frame(minHeight: 44)
                    .padding(.horizontal, 20)
                    .background(Theme.raised, in: Capsule())
                    .overlay(Capsule().strokeBorder(Theme.borderStrong, lineWidth: 1))
                    .foregroundStyle(Theme.textStrong)
            }
            .padding(24)
            .frame(maxWidth: .infinity, maxHeight: .infinity)

        case let .ready(session):
            ReaderViewControllerWrapper(viewController: session.host)
                .frame(maxWidth: .infinity, maxHeight: .infinity)
        }
    }

    /// The only permanent mark on screen. Without a bar it is the sole
    /// orientation the reader keeps, so it stays visible and stays quiet.
    @ViewBuilder private var percentReadout: some View {
        if case .ready = state, let percent = chrome.percent {
            VStack {
                Spacer()
                Text("\(Int((percent * 100).rounded()))%")
                    .font(.system(.caption2, design: .monospaced))
                    .foregroundStyle(Theme.faint)
                    .padding(.bottom, 6)
            }
            .allowsHitTesting(false)
        }
    }

    @ViewBuilder private var floatingControls: some View {
        if case .ready = state, controlsVisible {
            VStack {
                Spacer()
                HStack(spacing: 22) {
                    controlButton("chevron.down", "Close the book") { persistAndDismiss() }
                    controlButton("list.bullet", "Contents") {
                        revealControls()
                        showTOC = true
                    }
                    controlButton("textformat.size", "Text options") {
                        revealControls()
                        showSettings = true
                    }
                }
                .padding(.horizontal, 22)
                .padding(.vertical, 13)
                // Opaque rather than ultraThin: the capsule floats over body
                // text, and letting the page bleed through it turned two lines
                // into noise instead of reading as a layer above them.
                .background(Theme.raised, in: Capsule())
                .overlay(Capsule().strokeBorder(Theme.borderStrong, lineWidth: 1))
                .shadow(color: .black.opacity(0.5), radius: 14, y: 6)
                .padding(.bottom, 26)
            }
            .transition(.opacity)
        }
    }

    private func controlButton(
        _ systemImage: String,
        _ label: String,
        action: @escaping () -> Void
    ) -> some View {
        Button(action: action) {
            Image(systemName: systemImage)
                .font(.system(size: 17, weight: .medium))
                .foregroundStyle(Theme.textStrong)
                .frame(width: 44, height: 44)
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(label)
    }

    private func revealControls() {
        controlsVisible = true
        hideTask?.cancel()
        hideTask = Task {
            try? await Task.sleep(for: .seconds(3))
            guard !Task.isCancelled else { return }
            controlsVisible = false
        }
    }

    private func hideControls() {
        hideTask?.cancel()
        controlsVisible = false
    }

    private func persistAndDismiss() {
        if case let .ready(session) = state {
            session.persist(force: true)
        }
        dismiss()
    }

    private func open() async {
        guard case .opening = state else { return }
        do {
            let publication = try await Self.openPublication(at: document.localURL)
            let stored: ReadingPosition? = if let editionId = document.editionId {
                await model.readingPosition(editionId: editionId)
            } else {
                nil
            }
            let initialLocation = await Self.resumeLocator(
                publication: publication,
                stored: stored
            )
            let navigator = try EPUBNavigatorViewController(
                publication: publication,
                initialLocation: initialLocation.map { publication.normalizeLocator($0) },
                config: EPUBNavigatorViewController.Configuration(
                    preferences: preferences.asEPUBPreferences(language: document.language),
                    defaults: EPUBDefaults(
                        fontSize: 1.0,
                        lineHeight: 1.5,
                        pageMargins: 1.0,
                        publisherStyles: false,
                        scroll: false
                    )
                )
            )
            // Edge taps turn pages, a tap in the middle third summons the
            // controls. Returning true consumes the event so Readium does not
            // also page on a centre tap. This is the Apple Books / Kindle
            // idiom, so it needs no explaining in the UI.
            _ = navigator.addObserver(.tap { [weak navigator] event in
                guard let navigator else { return false }
                let width = navigator.view.bounds.width
                guard width > 0 else { return false }
                let x = event.location.x
                if x < width / 3 {
                    await navigator.goBackward(options: NavigatorGoOptions())
                    hideControls()
                    return true
                }
                if x > width * 2 / 3 {
                    await navigator.goForward(options: NavigatorGoOptions())
                    hideControls()
                    return true
                }
                if controlsVisible {
                    hideControls()
                } else {
                    revealControls()
                }
                return true
            })

            let host = ReaderViewController(navigator: navigator)
            let toc = await Self.loadTableOfContents(publication)
            let session = ReaderSession(
                publication: publication,
                host: host,
                tableOfContents: toc,
                editionId: document.editionId,
                fileId: document.id,
                save: { model.saveReadingPosition($0) }
            )
            let chrome = chrome
            host.onLocationChange = { [weak session] locator in
                session?.handleLocationChange(locator)
                chrome.currentLocator = locator
                chrome.percent = locator.locations.totalProgression
            }
            if let initialLocation {
                chrome.currentLocator = initialLocation
                chrome.percent = initialLocation.locations.totalProgression
            }
            state = .ready(session)
        } catch {
            state = .failed(Self.describe(error))
        }
    }

    /// Asset → Publication through the streamer. EPUB-only in this slice.
    private static func openPublication(at url: URL) async throws -> Publication {
        guard let fileURL = FileURL(url: url) else {
            throw OpenError.notAFile
        }
        let httpClient = DefaultHTTPClient()
        let assetRetriever = AssetRetriever(httpClient: httpClient)
        let opener = PublicationOpener(parser: EPUBParser())
        let asset = try await assetRetriever.retrieve(url: fileURL).get()
        return try await opener.open(asset: asset, allowUserInteraction: false).get()
    }

    /// Prefer a stored Locator JSON if it still parses; otherwise the coarse
    /// spine path/index via `ReadingProgressReconciler.resolve`.
    private static func resumeLocator(
        publication: Publication,
        stored: ReadingPosition?
    ) async -> Locator? {
        if let json = stored?.locator, let locator = try? Locator(jsonString: json) {
            return publication.normalizeLocator(locator)
        }
        guard let stored else { return nil }
        let spine = publication.readingOrder.map(\.href)
        let resolved = ReadingProgressReconciler.resolve(stored, spine: spine)
        return await locator(at: resolved.index, progression: resolved.scrollFraction, in: publication)
    }

    private static func locator(
        at index: Int,
        progression: Double,
        in publication: Publication
    ) async -> Locator? {
        guard publication.readingOrder.indices.contains(index) else { return nil }
        let link = publication.readingOrder[index]
        if let located = await publication.locate(link) {
            return located.copy(locations: { $0.progression = progression })
        }
        return Locator(
            href: link.url(),
            mediaType: link.mediaType ?? .xhtml,
            title: link.title,
            locations: Locator.Locations(progression: progression)
        )
    }

    private static func loadTableOfContents(_ publication: Publication) async -> [EPUBLink] {
        let loaded = await (try? publication.tableOfContents().get()) ?? []
        return loaded.isEmpty ? publication.readingOrder : loaded
    }

    private static func describe(_ error: Error) -> String {
        if error is OpenError {
            return String(localized: "The book file is missing from disk.")
        }
        if let open = error as? PublicationOpenError {
            switch open {
            case .formatNotSupported:
                return String(localized: "This file is not a supported EPUB.")
            case .reading:
                return error.localizedDescription
            }
        }
        if let retrieve = error as? AssetRetrieveURLError {
            switch retrieve {
            case .formatNotSupported:
                return String(localized: "This file is not a supported EPUB.")
            case .schemeNotSupported:
                return String(localized: "Could not open the file from this location.")
            case .reading:
                return error.localizedDescription
            }
        }
        if let epubError = error as? EPUBNavigatorViewController.EPUBError,
           case .publicationRestricted = epubError
        {
            return String(localized: "This publication is locked and cannot be opened.")
        }
        return error.localizedDescription
    }

    private enum OpenError: Error {
        case notAFile
    }
}

// MARK: - SwiftUI wrapper (Readium Navigator / SwiftUI guide)

/// SwiftUI wrapper for the host view controller.
private struct ReaderViewControllerWrapper: UIViewControllerRepresentable {
    let viewController: ReaderViewController

    func makeUIViewController(context _: Context) -> ReaderViewController {
        viewController
    }

    func updateUIViewController(_: ReaderViewController, context _: Context) {}
}

/// Host view controller for a Readium Navigator.
private final class ReaderViewController: UIViewController, EPUBNavigatorDelegate {
    let navigator: EPUBNavigatorViewController
    var onLocationChange: ((Locator) -> Void)?

    init(navigator: EPUBNavigatorViewController) {
        self.navigator = navigator
        super.init(nibName: nil, bundle: nil)
        navigator.delegate = self
    }

    @available(*, unavailable)
    required init?(coder _: NSCoder) {
        fatalError("init?(coder: NSCoder) not implemented")
    }

    override func viewDidLoad() {
        super.viewDidLoad()

        addChild(navigator)
        navigator.view.frame = view.bounds
        navigator.view.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        view.addSubview(navigator.view)
        navigator.didMove(toParent: self)
    }

    func navigator(_: Navigator, locationDidChange locator: Locator) {
        onLocationChange?(locator)
    }

    func navigator(_: Navigator, presentError _: NavigatorError) {}
}

// MARK: - Table of contents

private struct TableOfContentsSheet: View {
    let links: [EPUBLink]
    let currentLocator: Locator?
    let onSelect: (EPUBLink) -> Void
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            Group {
                if links.isEmpty {
                    Text("This book has no table of contents.")
                        .font(.subheadline)
                        .foregroundStyle(Theme.muted)
                        .frame(maxWidth: .infinity, maxHeight: .infinity)
                } else {
                    List {
                        TOCSection(links: links, currentLocator: currentLocator, onSelect: onSelect)
                    }
                    .listStyle(.plain)
                    .scrollContentBackground(.hidden)
                }
            }
            .background(Theme.base)
            .navigationTitle("Contents")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button("Done") { dismiss() }
                }
            }
        }
    }
}

private struct TOCSection: View {
    let links: [EPUBLink]
    let currentLocator: Locator?
    let onSelect: (EPUBLink) -> Void

    var body: some View {
        ForEach(Array(links.enumerated()), id: \.offset) { _, link in
            if link.children.isEmpty {
                TOCRow(link: link, currentLocator: currentLocator, onSelect: onSelect)
            } else {
                DisclosureGroup {
                    TOCSection(links: link.children, currentLocator: currentLocator, onSelect: onSelect)
                } label: {
                    TOCRow(link: link, currentLocator: currentLocator, onSelect: onSelect)
                }
            }
        }
        .listRowBackground(Theme.raised)
    }
}

private struct TOCRow: View {
    let link: EPUBLink
    let currentLocator: Locator?
    let onSelect: (EPUBLink) -> Void

    private var isCurrent: Bool {
        guard let currentLocator else { return false }
        return link.url().isEquivalentTo(currentLocator.href)
    }

    private var title: String {
        if let title = link.title, !title.isEmpty {
            return title
        }
        return link.href
    }

    var body: some View {
        Button {
            onSelect(link)
        } label: {
            Text(title)
                .font(.body)
                .foregroundStyle(isCurrent ? Theme.apricot : Theme.textStrong)
                .frame(maxWidth: .infinity, alignment: .leading)
        }
    }
}

// MARK: - Settings

private struct ReaderSettingsSheet: View {
    @Binding var preferences: ReaderPreferences
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            Form {
                Section("Typography") {
                    Stepper(value: $preferences.fontSize, in: 0.7 ... 2.0, step: 0.1) {
                        HStack {
                            Text("Font size")
                                .foregroundStyle(Theme.text)
                            Spacer()
                            Text("\(Int((preferences.fontSize * 100).rounded()))%")
                                .foregroundStyle(Theme.muted)
                        }
                    }
                    Stepper(value: $preferences.lineHeight, in: 1.0 ... 2.0, step: 0.1) {
                        HStack {
                            Text("Line height")
                                .foregroundStyle(Theme.text)
                            Spacer()
                            Text(String(format: "%.1f", preferences.lineHeight))
                                .foregroundStyle(Theme.muted)
                        }
                    }
                    Stepper(value: $preferences.pageMargins, in: 0.0 ... 4.0, step: 0.3) {
                        HStack {
                            Text("Page margins")
                                .foregroundStyle(Theme.text)
                            Spacer()
                            Text(String(format: "%.1f", preferences.pageMargins))
                                .foregroundStyle(Theme.muted)
                        }
                    }
                }
                .listRowBackground(Theme.raised)

                Section("Theme") {
                    Picker("Theme", selection: $preferences.theme) {
                        ForEach(ReaderTheme.allCases) { theme in
                            Text(theme.label).tag(theme)
                        }
                    }
                    .pickerStyle(.segmented)
                }
                .listRowBackground(Theme.raised)
            }
            .scrollContentBackground(.hidden)
            .background(Theme.base)
            .navigationTitle("Reader")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button("Done") { dismiss() }
                }
            }
        }
    }
}

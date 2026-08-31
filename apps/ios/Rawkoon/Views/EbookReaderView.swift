import Combine
import RawkoonKit
import ReadiumNavigator
import ReadiumShared
import ReadiumStreamer
import SwiftUI
import UIKit

private typealias EPUBLink = ReadiumShared.Link

struct EbookPreviewDocument: Identifiable, Sendable {
    /// The book file's id on disk.
    let id: Int
    /// The ebook edition this file belongs to, when the server told us.
    /// Reading progress is keyed by edition, so it is off without one.
    let editionId: Int?
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

    func asEPUBPreferences() -> EPUBPreferences {
        EPUBPreferences(
            fontSize: fontSize,
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

    var id: String { rawValue }

    var label: String {
        switch self {
        case .light: return "Light"
        case .sepia: return "Sepia"
        case .dark: return "Dark"
        }
    }

    var readiumTheme: ReadiumNavigator.Theme {
        switch self {
        case .light: return .light
        case .sepia: return .sepia
        case .dark: return .dark
        }
    }
}

/// Observable chrome so the footer and TOC highlight refresh when the
/// navigator reports a new locator. The session itself is not observed.
@MainActor
private final class ReaderChrome: ObservableObject {
    @Published var currentLocator: Locator?
    @Published var percent: Double?
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

    var navigator: EPUBNavigatorViewController { host.navigator }

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
        if !force, now - lastPersistMillis < 3_000 { return }
        lastPersistMillis = now
        save(position(from: locator, editionId: editionId, now: now))
    }

    private func position(from locator: Locator, editionId: Int, now: Int64) -> ReadingPosition {
        let index = publication.readingOrder.firstIndexWithHREF(locator.href) ?? 0
        let spinePath: String
        if publication.readingOrder.indices.contains(index) {
            spinePath = publication.readingOrder[index].href
        } else {
            spinePath = locator.href.string
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

    @EnvironmentObject private var model: AppModel
    @Environment(\.dismiss) private var dismiss
    @StateObject private var chrome = ReaderChrome()
    @State private var state: ReaderState = .opening
    @State private var preferences = ReaderPreferences.load()
    @State private var showTOC = false
    @State private var showSettings = false

    var body: some View {
        NavigationStack {
            content
                .background(Theme.base)
                .navigationTitle(navigationTitle)
                .navigationBarTitleDisplayMode(.inline)
                .toolbar {
                    ToolbarItem(placement: .topBarLeading) {
                        Button("Done") {
                            persistAndDismiss()
                        }
                    }
                    if case .ready = state {
                        ToolbarItemGroup(placement: .topBarTrailing) {
                            Button {
                                showTOC = true
                            } label: {
                                Label("Contents", systemImage: "list.bullet")
                            }
                            .tint(Theme.importing)
                            Button {
                                showSettings = true
                            } label: {
                                Label("Settings", systemImage: "textformat.size")
                            }
                            .tint(Theme.importing)
                        }
                    }
                }
                .safeAreaInset(edge: .bottom) {
                    if case .ready = state, let percent = chrome.percent {
                        Text("\(Int((percent * 100).rounded()))%")
                            .font(.system(.caption, design: .monospaced))
                            .foregroundStyle(Theme.muted)
                            .frame(maxWidth: .infinity)
                            .padding(.vertical, 8)
                            .background(.ultraThinMaterial)
                    }
                }
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
        }
        .task { await open() }
        .onChange(of: preferences) { _, new in
            new.save()
            if case let .ready(session) = state {
                session.navigator.submitPreferences(new.asEPUBPreferences())
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

        case let .ready(session):
            ReaderViewControllerWrapper(viewController: session.host)
                .frame(maxWidth: .infinity, maxHeight: .infinity)
        }
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
            let stored: ReadingPosition?
            if let editionId = document.editionId {
                stored = await model.readingPosition(editionId: editionId)
            } else {
                stored = nil
            }
            let initialLocation = await Self.resumeLocator(
                publication: publication,
                stored: stored
            )
            let navigator = try EPUBNavigatorViewController(
                publication: publication,
                initialLocation: initialLocation.map { publication.normalizeLocator($0) },
                config: EPUBNavigatorViewController.Configuration(
                    preferences: preferences.asEPUBPreferences(),
                    defaults: EPUBDefaults(
                        fontSize: 1.0,
                        lineHeight: 1.5,
                        pageMargins: 1.0,
                        publisherStyles: false,
                        scroll: false
                    )
                )
            )
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
            let chrome = self.chrome
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
        let loaded = (try? await publication.tableOfContents().get()) ?? []
        return loaded.isEmpty ? publication.readingOrder : loaded
    }

    private static func describe(_ error: Error) -> String {
        if error is OpenError {
            return "The book file is missing from disk."
        }
        if let open = error as? PublicationOpenError {
            switch open {
            case .formatNotSupported:
                return "This file is not a supported EPUB."
            case .reading(_):
                return error.localizedDescription
            }
        }
        if let retrieve = error as? AssetRetrieveURLError {
            switch retrieve {
            case .formatNotSupported:
                return "This file is not a supported EPUB."
            case .schemeNotSupported(_):
                return "Could not open the file from this location."
            case .reading(_):
                return error.localizedDescription
            }
        }
        if let epubError = error as? EPUBNavigatorViewController.EPUBError,
           case .publicationRestricted = epubError
        {
            return "This publication is locked and cannot be opened."
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

    func makeUIViewController(context: Context) -> ReaderViewController {
        viewController
    }

    func updateUIViewController(_ uiViewController: ReaderViewController, context: Context) {}
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
    required init?(coder: NSCoder) {
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

    func navigator(_ navigator: Navigator, locationDidChange locator: Locator) {
        onLocationChange?(locator)
    }

    func navigator(_ navigator: Navigator, presentError _: NavigatorError) {}
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
        if let title = link.title, !title.isEmpty { return title }
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

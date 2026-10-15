import RawkoonKit
@preconcurrency import ReadiumNavigator
@preconcurrency import ReadiumShared
import SwiftUI
import UIKit

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
    /// Set when the button offered "Read" rather than "Resume" — a finished book
    /// reopens at the beginning instead of on its last page.
    var startFromBeginning = false
    /// Lets the reader offer "Listen from here" for the same book's audiobook.
    var bookId: Int?
}

/// In-app EPUB reading via Readium's navigator. Readium owns the WKWebView,
/// its injected JS and the scheme handler that serves publication resources.
struct EbookReaderSheet: View {
    let document: EbookPreviewDocument

    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss
    @Environment(\.scenePhase) private var scenePhase
    @State private var chrome = ReaderChrome()
    @State private var state: ReaderState = .opening
    @State private var preferences = ReaderPreferences.load()
    @State private var showTOC = false
    @State private var showSettings = false
    @State private var findingPlace = false
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
        .rawkoonMotion(.easeInOut(duration: 0.2), value: controlsVisible)
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
        // A swipe-to-dismiss never runs the Done button.
        .onDisappear {
            if case let .ready(session) = state {
                session.persist(force: true)
            }
        }
        // Backgrounding does not fire onDisappear (the sheet stays in the
        // hierarchy), so snapshot here too before a possible termination.
        .onChange(of: scenePhase) { _, phase in
            if phase == .background, case let .ready(session) = state {
                session.persist(force: true)
            }
        }
    }

    /// One slot, so opening, failure and the book crossfade instead of cutting.
    private var content: some View {
        ZStack {
            switch state {
            case .opening:
                VStack(spacing: 10) {
                    ProgressView().tint(Theme.importing)
                    Text("Opening book…")
                        .font(.subheadline)
                        .foregroundStyle(Theme.muted)
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                .transition(.rawkoonSwap)

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
                        .glassEffect(.regular.interactive(), in: .capsule)
                        .foregroundStyle(Theme.textStrong)
                }
                .padding(24)
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                .transition(.rawkoonSwap)

            case let .ready(session):
                ReaderViewControllerWrapper(viewController: session.host)
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                    .transition(.rawkoonSwap)
            }
        }
        .rawkoonMotion(RawkoonMotion.spring, value: state.phase)
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
                    .rawkoonNumeric((percent * 100).rounded())
                    .padding(.bottom, 6)
            }
            .allowsHitTesting(false)
        }
    }

    /// The container outlives the capsule so the glass can materialize and
    /// dissolve instead of fading as a flat layer.
    @ViewBuilder private var floatingControls: some View {
        if case .ready = state {
            VStack {
                Spacer()
                GlassEffectContainer {
                    if controlsVisible {
                        HStack(spacing: 22) {
                            if findingPlace {
                                ProgressView().tint(Theme.textStrong)
                                Text("Finding your place…")
                                    .font(.subheadline)
                                    .foregroundStyle(Theme.textStrong)
                                    .frame(minHeight: 44)
                            } else {
                                controlButton("chevron.down", "Close the book") { persistAndDismiss() }
                                controlButton("list.bullet", "Contents") {
                                    revealControls()
                                    showTOC = true
                                }
                                controlButton("textformat.size", "Text options") {
                                    revealControls()
                                    showSettings = true
                                }
                                if canListenFromHere {
                                    controlButton("headphones", String(localized: "Listen from here")) {
                                        listenFromHere()
                                    }
                                }
                            }
                        }
                        .padding(.horizontal, 22)
                        .padding(.vertical, 13)
                        // Heavily tinted: the capsule floats over body text, and a
                        // see-through layer turned two lines into noise.
                        .glassEffect(.regular.tint(Theme.raised.opacity(0.85)), in: .capsule)
                        .glassEffectTransition(.materialize)
                    }
                }
                .padding(.bottom, 26)
            }
            .allowsHitTesting(controlsVisible)
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

    /// Only for a book that also has an audiobook, and only online: the match runs on the server.
    private var canListenFromHere: Bool {
        guard model.isOnline, let bookId = document.bookId else { return false }
        return model.library.first(where: { $0.bookId == bookId })?.hasAudiobook == true
    }

    private func listenFromHere() {
        guard !findingPlace, let bookId = document.bookId,
              case let .ready(session) = state,
              let spot = session.currentSpot()
        else { return }
        findingPlace = true
        // The capsule must stay up while the server works.
        hideTask?.cancel()
        Task {
            defer { findingPlace = false }
            let started = await model.listenFromHere(
                bookId: bookId, spinePath: spot.spinePath, progression: spot.progression
            )
            if started {
                persistAndDismiss()
                model.presentPlayerAfterDismiss()
            } else {
                revealControls()
            }
        }
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
            let stored: ReadingPosition? = if let editionId = document.editionId,
                                              !document.startFromBeginning
            {
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
}

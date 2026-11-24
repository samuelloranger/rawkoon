import RawkoonKit
import SwiftUI

struct HomeView: View {
    @Environment(AppModel.self) var model
    @Environment(\.isActiveRootTab) var isActiveRootTab

    @State var recent: [LibraryMedia] = []
    @State private var upcoming: [UpcomingItem] = []
    @State private var hero: DashboardHeroResponse?
    @State var nowPlaying: NowPlayingResponse?
    @State var pipeline: DashboardPipeline?
    @State private var homeVisible = false
    @State private var loading = true
    @State private var heroHasChanged = false
    @State private var measuredTopInset: CGFloat = 0
    /// When the last full refresh finished, so switching back to Home within a
    /// few seconds doesn't refetch every rail.
    @State private var lastLoadedAt: Date?
    @State private var hydrated = false
    /// Bumped on pull-to-refresh and when Continue's player sheet dismisses
    /// so Listening reloads with Continue.
    @State private var continueToken = 0
    /// The just-landed banner while it's up, and a counter that fires its haptic.
    @State var attentionTarget: AttentionRoute?
    @State var landedBanner: LandedArrival?
    @State var landedBannerCount = 0

    /// Resolved detail destination for an attention row — Hashable so it can
    /// drive `navigationDestination(item:)`, which `LibraryMedia` can't.
    struct AttentionRoute: Identifiable, Hashable {
        let id: Int
        let tmdbId: Int
        let mediaType: String
        let title: String
        let posterUrl: String?
    }

    private var showsHero: Bool {
        hero?.items.isEmpty == false || nowPlaying?.sessions?.isEmpty == false
    }

    /// Status-bar height, measured live so rotation and resizes follow; the window is a cold-start fallback.
    private var heroTopInset: CGFloat {
        if measuredTopInset > 0 {
            return measuredTopInset
        }
        let scenes = UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }
        return scenes.lazy.compactMap(\.keyWindow).first?.safeAreaInsets.top ?? 0
    }

    /// DEBUG-only: `RAWKOON_HOME_ANCHOR=center` opens Home mid-scroll so screenshots reach the cards below the hero.
    private var debugScrollAnchor: UnitPoint? {
        #if DEBUG
            ProcessInfo.processInfo.environment["RAWKOON_HOME_ANCHOR"] == "center" ? .center : nil
        #else
            nil
        #endif
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 26) {
                if showsHero {
                    HomeHero(hero: hero ?? DashboardHeroResponse(items: []), nowPlaying: nowPlaying?.sessions ?? [], topInset: heroTopInset) { greeting(onHero: true) }
                } else {
                    greeting(onHero: false)
                }

                if loading, recent.isEmpty {
                    homeSkeleton
                } else {
                    loadedContent
                }
            }
            // The hero runs to the top edge; without it the greeting keeps its inset.
            .padding(.top, showsHero ? 0 : 12)
            .padding(.bottom, 108)
            .rawkoonMotion(heroHasChanged ? RawkoonMotion.spring : nil, value: showsHero)
        }
        // Behind the status bar, so rails scrolled past the hero don't run under the clock bare.
        .overlay(alignment: .top) {
            if showsHero {
                LinearGradient(colors: [Theme.base.opacity(0.85), .clear], startPoint: .top, endPoint: .bottom)
                    .frame(height: heroTopInset)
                    .allowsHitTesting(false)
            }
        }
        // Only the scroll view goes under the status bar; overlays such as the landed banner keep the safe area.
        .ignoresSafeArea(edges: showsHero ? .top : [])
        .background {
            // A reader that itself reaches into the status bar reports that bar's height as its top inset.
            Color.clear
                .ignoresSafeArea()
                .onGeometryChange(for: CGFloat.self) { $0.safeAreaInsets.top } action: { measuredTopInset = $0 }
        }
        .defaultScrollAnchor(debugScrollAnchor)
        .reportsTabBarScroll()
        .background(Theme.base)
        .onChange(of: model.router.pendingMediaLink, initial: true) { _, link in
            guard let link else { return }
            model.router.pendingMediaLink = nil
            attentionTarget = AttentionRoute(id: link.libraryId, tmdbId: link.tmdbId, mediaType: link.mediaType,
                                             title: link.title, posterUrl: nil)
        }
        .navigationDestination(item: $attentionTarget) { route in
            MediaDetailView(tmdbId: route.tmdbId, mediaType: route.mediaType,
                            title: route.title, posterPath: route.posterUrl, libraryId: route.id)
        }
        .navigationTitle("Home")
        .navigationBarTitleDisplayMode(.inline)
        // The hero is the header: no title bar over the film.
        .toolbarVisibility(showsHero ? .hidden : .automatic, for: .navigationBar)
        .overlay(alignment: .top) { landedBannerLayer }
        .sensoryFeedback(RawkoonHaptics.feedback(for: .success), trigger: landedBannerCount)
        .onChange(of: model.recentArrivals.first) { _, arrival in landedArrived(arrival) }
        .task(id: landedBanner?.ts) { await autoDismissLandedBanner() }
        .onAppear {
            homeVisible = true
            hydrateFromCache()
        }
        .onChange(of: showsHero) { _, _ in heroHasChanged = true }
        .onDisappear { homeVisible = false }
        .task { await load() }
        // Kept-alive iPhone tabs never re-appear, so a revisit refreshes like the old TabView did.
        .onChange(of: isActiveRootTab) { _, active in
            if active, Date().timeIntervalSince(lastLoadedAt ?? .distantPast) > 30 {
                Task { await load() }
            }
        }
        .task { await model.refreshUnreadNotificationCount() }
        .task(id: [homeVisible, isActiveRootTab, model.isAdmin, model.isOffline]) {
            guard model.isAdmin, homeVisible, isActiveRootTab, !model.isOffline else { return }
            while !Task.isCancelled {
                if let client = model.api() {
                    pipeline = try? await client.dashboardPipeline()
                }
                try? await Task.sleep(for: .seconds(15))
            }
        }
        .onChange(of: model.reconnectToken) { _, _ in
            continueToken += 1
            Task { await load() }
        }
        .refreshable {
            continueToken += 1
            await load()
        }
    }

    /// Everything below the greeting once the first load resolves.
    @ViewBuilder
    private var loadedContent: some View {
        VStack(alignment: .leading, spacing: 26) {
            ContinueListeningView(
                refreshToken: continueToken,
                limit: 3,
                onPlaybackDismiss: { continueToken += 1 }
            )
            if model.isAdmin {
                pipelineCard
                    .padding(.horizontal, 16)
            }
            if !recent.isEmpty || !model.recentArrivals.isEmpty {
                recentlyAddedRail
            }
            if !upcoming.isEmpty {
                rail("Upcoming", upcoming.map(RailItem.upcoming))
            }
        }
    }

    // MARK: Greeting

    private func greeting(onHero: Bool) -> some View {
        // Re-evaluated each minute so a Home left open overnight doesn't keep saying "Good morning".
        HStack(alignment: .top, spacing: 12) {
            greetingText(onHero: onHero)
            Spacer(minLength: 0)
        }
        // On the hero, the hero's own content inset applies.
        .padding(.horizontal, onHero ? 0 : 16)
        // The name arrives after first render; the load-swap spring must not animate its reflow.
        .transaction { $0.animation = nil }
    }

    private func greetingText(onHero: Bool) -> some View {
        TimelineView(.everyMinute) { context in
            let calendar = Calendar.current
            let hour = calendar.component(.hour, from: context.date)
            let weekday = calendar.component(.weekday, from: context.date)
            VStack(alignment: .leading, spacing: 4) {
                greetingLine(HomeGreeting.period(hour: hour))
                    .font(.display(28))
                    .foregroundStyle(Theme.textStrong)
                subtitle(hour: hour, weekday: weekday, now: context.date)
                    .font(.subheadline)
                    .foregroundStyle(onHero ? Theme.text : Theme.muted)
            }
        }
    }

    /// A fresh arrival outranks the time-of-day line.
    private func subtitle(hour: Int, weekday: Int, now: Date) -> Text {
        if let landed = LandedArrivals.fresh(model.recentArrivals, now: Self.epochMillis(now)).first {
            return landedSubtitle(display(landed))
        }
        return Text(subtitleKey(HomeGreeting.subtitle(hour: hour, weekday: weekday)))
    }

    /// With no name known yet the greeting stands alone rather than addressing
    /// a placeholder.
    private func greetingLine(_ period: HomeGreeting.Period) -> Text {
        let greeting = Text(greetingKey(period))
        guard let name = model.session.userFirstName, !name.isEmpty else { return greeting }
        return greeting + Text(verbatim: ", ") + Text(verbatim: name)
    }

    private func greetingKey(_ period: HomeGreeting.Period) -> LocalizedStringKey {
        switch period {
        case .morning: "Good morning"
        case .afternoon: "Good afternoon"
        case .evening: "Good evening"
        case .night: "Still up"
        }
    }

    private func subtitleKey(_ subtitle: HomeGreeting.Subtitle) -> LocalizedStringKey {
        switch subtitle {
        case .night: "One more episode? We won't tell."
        case .weekend: "Weekends are made for marathons."
        case .monday: "New week, new episodes."
        case .friday: "Friday. Pick tonight's movie."
        case .earlyMorning: "The world's still asleep. Your library isn't."
        case .morning: "Coffee's ready. So is the library."
        case .lateMorning: "Coffee break? One episode fits right in."
        case .afternoon: "Here's what's happening."
        case .evening: "Showtime. What are we watching?"
        }
    }

    // MARK: First-load skeleton

    /// Warm shimmer standing in for the first paint: Continue, Pipeline and poster rails.
    private var homeSkeleton: some View {
        VStack(alignment: .leading, spacing: 26) {
            // Continue-listening card.
            ShimmerView(cornerRadius: 16)
                .frame(height: 96)
                .padding(.horizontal, 16)
            if model.isAdmin {
                ShimmerView(cornerRadius: 16)
                    .frame(height: 120)
                    .padding(.horizontal, 16)
            }
            skeletonRail(titleWidth: 140)
            skeletonRail(titleWidth: 96)
        }
        .allowsHitTesting(false)
    }

    private func skeletonRail(titleWidth: CGFloat) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            ShimmerView(cornerRadius: 6)
                .frame(width: titleWidth, height: 20)
                .padding(.horizontal, 16)
            // A plain HStack, not a nested ScrollView: that one clipped the cards to a
            // hard edge mid-crossfade. The overflow runs off-screen like the real rail.
            HStack(spacing: 12) {
                ForEach(0 ..< 4, id: \.self) { _ in
                    ShimmerView(cornerRadius: RailPoster.corner)
                        .frame(width: RailPoster.width, height: RailPoster.height)
                }
            }
            .padding(.horizontal, 16)
            .frame(maxWidth: .infinity, alignment: .leading)
        }
    }

    // MARK: Load

    /// Paints every rail from the last saved responses before the first frame,
    /// so Home opens full — offline, or while the refetch below is in flight.
    private func hydrateFromCache() {
        guard !hydrated, let client = model.api() else { return }
        hydrated = true
        if recent.isEmpty, let cached = client.cached(Endpoints.recentlyAdded()) {
            recent = cached.value.items
        }
        if upcoming.isEmpty, let cached = client.cached(Endpoints.upcoming) {
            upcoming = cached.value.items
        }
        if hero == nil, let cached = client.cached(Endpoints.dashboardHero()) {
            hero = cached.value
        }
        if model.isAdmin, pipeline == nil, let cached = client.cached(Endpoints.dashboardPipeline) {
            pipeline = cached.value
        }
        if !recent.isEmpty || !upcoming.isEmpty {
            loading = false
        }
    }

    private func load() async {
        // The first onAppear can beat the API client; paint the saved copy before the fetch.
        hydrateFromCache()
        guard let client = model.api() else {
            loading = false
            return
        }
        // Books refresh on their own; the rails below don't read them, so they
        // no longer wait on every page of the library.
        if model.libraryStore.needsLibraryRefresh {
            Task { await model.libraryStore.loadLibrary() }
        }
        async let recentR = client.recentlyAdded()
        async let upcomingR = client.upcoming()
        async let heroR = client.dashboardHero()
        async let npR = client.nowPlaying()
        async let growthR: Void = model.libraryStore.refreshLibraryGrowth(force: true)

        // A failed refetch (a transient error on pull-to-refresh) must not blank
        // content already on screen: replace each section only when its request
        // succeeds, so the rails survive a hiccup instead of vanishing until the
        // view is rebuilt. `(try?)?.items` returns [] for a real empty result and
        // nil only on failure, so a genuinely empty section still clears.
        if let items = await (try? recentR)?.items {
            recent = items
            loading = false
            Task {
                await WidgetSnapshotWriter.shared.updateRecent(items, model: model)
                await WidgetSnapshotWriter.shared.updateWatch(model: model)
            }
        }
        if let items = await (try? upcomingR)?.items {
            upcoming = items
        }
        if let fresh = try? await heroR {
            hero = fresh
        }
        if let np = try? await npR {
            nowPlaying = np
        }
        await growthR

        loading = false
        lastLoadedAt = Date()
    }
}

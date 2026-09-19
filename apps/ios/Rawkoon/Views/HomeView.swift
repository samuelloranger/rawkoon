import RawkoonKit
import SwiftUI

/// The home screen for every user: greeting, Continue, Recently Added,
/// Upcoming and For-You rails, then a widget stack (Now Watching, Downloads,
/// Library Attention, RSS, Library stats). The ops widgets (Downloads, RSS,
/// Library stats) are admin-only; all widgets also self-hide when their
/// integration is off or has no data.
struct HomeView: View {
    @Environment(AppModel.self) private var model
    /// Local namespace shared directly by each poster source and its detail
    /// destination — the reliable pattern for the zoom transition.
    @Namespace private var zoomNamespace

    @State private var recent: [LibraryMedia] = []
    @State private var upcoming: [UpcomingItem] = []
    @State private var discover: DiscoverDeckResponse?
    @State private var nowPlaying: NowPlayingResponse?
    @State private var speed: SpeedResponse?
    @State private var attention: [AttentionItem] = []
    @State private var rss: RssStatusResponse?
    @State private var stats: LibraryStats?
    @State private var loading = true
    /// Bumped on pull-to-refresh and when Continue's player sheet dismisses
    /// so Listening reloads with Continue.
    @State private var continueToken = 0
    /// A "Needs attention" row tapped: the widget carries only a library id, so
    /// resolve the full item (for its tmdbId/poster) then push its detail.
    @State private var attentionTarget: AttentionRoute?
    @State private var resolvingAttentionId: Int?

    /// Resolved detail destination for an attention row — Hashable so it can
    /// drive `navigationDestination(item:)`, which `LibraryMedia` can't.
    private struct AttentionRoute: Identifiable, Hashable {
        let id: Int
        let tmdbId: Int
        let mediaType: String
        let title: String
        let posterUrl: String?
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 26) {
                greeting

                if loading, recent.isEmpty {
                    homeSkeleton
                        .transition(.opacity)
                } else {
                    loadedContent
                        .transition(.opacity)
                }
            }
            .padding(.vertical, 12)
            .padding(.bottom, 96)
            // Crossfade skeleton → content instead of a hard cut, so the rails
            // fade in rather than popping into place on first load.
            .rawkoonMotion(RawkoonMotion.spring, value: loading)
        }
        .background(Theme.base)
        .navigationDestination(item: $attentionTarget) { route in
            MediaDetailView(tmdbId: route.tmdbId, mediaType: route.mediaType,
                            title: route.title, posterPath: route.posterUrl, libraryId: route.id)
        }
        .navigationTitle("Home")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                NavigationLink {
                    NotificationsListView()
                } label: {
                    ZStack(alignment: .topTrailing) {
                        Image(systemName: "bell")
                        if model.unreadNotificationCount > 0 {
                            Circle()
                                .fill(Theme.terracotta)
                                .frame(width: 8, height: 8)
                                .offset(x: 3, y: -3)
                        }
                    }
                }
                .accessibilityLabel("Notifications")
            }
        }
        .task { await load() }
        .task { await model.refreshUnreadNotificationCount() }
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
            ListeningStatsCard(refreshToken: continueToken)
                .padding(.horizontal, 16)
            if !recent.isEmpty {
                rail("Recently added", recent.map(RailItem.library))
            }
            if !upcoming.isEmpty {
                rail("Upcoming", upcoming.map(RailItem.upcoming))
            }
            if let discover, !discover.items.isEmpty {
                rail(
                    discover.source == .personalized ? "For you" : "Trending",
                    discover.items.map(RailItem.discover)
                )
            }
            widgets
        }
    }

    // MARK: Greeting

    private var greeting: some View {
        VStack(alignment: .leading, spacing: 4) {
            greetingLine
                .font(.display(28))
                .foregroundStyle(Theme.textStrong)
            Text(subtitle)
                .font(.subheadline)
                .foregroundStyle(Theme.muted)
        }
        .padding(.horizontal, 16)
    }

    private var greetingLine: Text {
        let name = model.userFirstName ?? String(localized: "there")
        return Text(timeGreeting) + Text(verbatim: ", ") + Text(verbatim: name)
    }

    private var timeGreeting: LocalizedStringKey {
        switch Calendar.current.component(.hour, from: Date()) {
        case 5 ..< 12: "Good morning"
        case 12 ..< 18: "Good afternoon"
        default: "Good evening"
        }
    }

    private var subtitle: LocalizedStringKey {
        switch Calendar.current.component(.weekday, from: Date()) {
        case 1, 7: "Enjoy your weekend."
        case 2: "A fresh week begins."
        case 6: "The weekend's nearly here."
        default: "Here's what's happening."
        }
    }

    // MARK: First-load skeleton

    /// Warm shimmer standing in for the first paint: a greeting line and one
    /// poster rail, shaped like the real content below it.
    private var homeSkeleton: some View {
        VStack(alignment: .leading, spacing: 10) {
            ShimmerView(cornerRadius: 6)
                .frame(width: 200, height: 20)
                .padding(.horizontal, 16)
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 12) {
                    ForEach(0 ..< 4, id: \.self) { _ in
                        ShimmerView(cornerRadius: RailPoster.corner)
                            .frame(width: RailPoster.width, height: RailPoster.height)
                    }
                }
                .padding(.horizontal, 16)
            }
        }
        .allowsHitTesting(false)
    }

    // MARK: Poster rails

    private enum RailItem: Identifiable {
        case library(LibraryMedia)
        case upcoming(UpcomingItem)
        case discover(DiscoverDeckItem)
        var id: String {
            switch self {
            case let .library(m): "l\(m.id)"
            case let .upcoming(u): "u\(u.id)"
            case let .discover(d): "d\(d.id)"
            }
        }
    }

    private func rail(_ title: LocalizedStringKey, _ items: [RailItem]) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            Text(title).font(.sectionTitle).foregroundStyle(Theme.textStrong).padding(.horizontal, 16)
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 12) {
                    ForEach(items) { item in railCard(item) }
                }
                .padding(.horizontal, 16)
            }
            // Pin the rail height instead of inheriting it from the posters'
            // intrinsic size through the scroll view: an outer `.refreshable`
            // pull can momentarily collapse a nested horizontal ScrollView to
            // zero height, hiding the rail until the view is rebuilt. A fixed
            // height keeps it laid out across the refresh.
            .frame(height: RailPoster.height)
        }
    }

    @ViewBuilder
    private func railCard(_ item: RailItem) -> some View {
        switch item {
        case let .library(m):
            let zoomID = RawkoonZoom.media(tmdbId: m.tmdbId, mediaType: m.type == "show" ? "tv" : "movie")
            NavigationLink {
                MediaDetailView(tmdbId: m.tmdbId, mediaType: m.type == "show" ? "tv" : "movie",
                                title: m.title, posterPath: m.posterUrl, libraryId: m.id)
                    .navigationTransition(.zoom(sourceID: zoomID, in: zoomNamespace))
            } label: {
                poster(title: m.title, url: m.posterUrl)
                    .matchedTransitionSource(id: zoomID, in: zoomNamespace)
            }
            .buttonStyle(.plain)
        case let .upcoming(u):
            let zoomID = RawkoonZoom.media(tmdbId: u.tmdbId ?? 0, mediaType: u.mediaType)
            NavigationLink {
                MediaDetailView(tmdbId: u.tmdbId ?? 0, mediaType: u.mediaType,
                                title: u.title, posterPath: u.posterUrl, libraryId: u.libraryId)
                    .navigationTransition(.zoom(sourceID: zoomID, in: zoomNamespace))
            } label: {
                poster(title: u.title, url: u.posterUrl,
                       date: u.displayDate, episode: u.episodeLabel)
                    .matchedTransitionSource(id: zoomID, in: zoomNamespace)
            }
            .buttonStyle(.plain)
            .disabled(u.tmdbId == nil && u.libraryId == nil)
        case let .discover(d):
            let zoomID = RawkoonZoom.media(tmdbId: d.tmdbId, mediaType: d.mediaType)
            NavigationLink {
                MediaDetailView(tmdbId: d.tmdbId, mediaType: d.mediaType,
                                title: d.title, posterPath: d.posterUrl, libraryId: nil)
                    .navigationTransition(.zoom(sourceID: zoomID, in: zoomNamespace))
            } label: {
                poster(title: d.title, url: d.posterUrl)
                    .matchedTransitionSource(id: zoomID, in: zoomNamespace)
            }
            .buttonStyle(.plain)
        }
    }

    /// Matches the web `MediaPosterCard`: 2:3 poster with title (and optional
    /// date / episode) in a bottom glass panel, never captioned underneath.
    private enum RailPoster {
        static let width: CGFloat = 140
        static let height: CGFloat = 210
        static let corner: CGFloat = 16
    }

    private func poster(title: String, url: String?, date: String? = nil, episode: String? = nil) -> some View {
        let shape = RoundedRectangle(cornerRadius: RailPoster.corner, style: .continuous)
        return Rectangle()
            .fill(Theme.raised)
            .frame(width: RailPoster.width, height: RailPoster.height)
            .overlay {
                CachedAsyncImage(
                    url: model.absoluteURL(url),
                    targetSize: CGSize(width: RailPoster.width, height: RailPoster.height)
                ) { image in
                    image.resizable().scaledToFill()
                } placeholder: {
                    Image(systemName: "photo").foregroundStyle(Theme.faint)
                }
                .frame(width: RailPoster.width, height: RailPoster.height)
                .clipped()
            }
            .overlay {
                LinearGradient(
                    colors: [.black.opacity(0.55), .black.opacity(0.08), .clear],
                    startPoint: .bottom,
                    endPoint: .center
                )
                .allowsHitTesting(false)
            }
            .overlay(alignment: .bottom) {
                posterCaption(title: title, date: date, episode: episode)
            }
            .clipShape(shape)
            .overlay(shape.strokeBorder(.white.opacity(0.08), lineWidth: 1))
            .contentShape(shape)
            .accessibilityElement(children: .combine)
            .accessibilityLabel(posterAccessibilityLabel(title: title, date: date, episode: episode))
    }

    private func posterCaption(title: String, date: String?, episode: String?) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(title)
                .font(.caption.weight(.semibold))
                .foregroundStyle(.white)
                .lineLimit(2)
                .minimumScaleFactor(0.8)
            if date != nil || episode != nil {
                HStack(alignment: .firstTextBaseline, spacing: 6) {
                    if let date {
                        Text(date)
                            .font(.caption2.weight(.medium))
                            .foregroundStyle(.white.opacity(0.7))
                    }
                    Spacer(minLength: 0)
                    if let episode {
                        Text(episode)
                            .font(.caption2.weight(.semibold))
                            .foregroundStyle(Theme.apricot)
                    }
                }
                .lineLimit(1)
                .minimumScaleFactor(0.8)
            }
        }
        .padding(.horizontal, 10)
        .padding(.top, 8)
        .padding(.bottom, 10)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background {
            Rectangle()
                .fill(.ultraThinMaterial)
                .environment(\.colorScheme, .dark)
                .overlay(Color.black.opacity(0.32))
        }
    }

    private func posterAccessibilityLabel(title: String, date: String?, episode: String?) -> String {
        [title, date, episode].compactMap(\.self).joined(separator: ", ")
    }

    // MARK: Widgets

    private var widgets: some View {
        VStack(spacing: 14) {
            if let np = nowPlaying, np.enabled {
                nowWatchingWidget(np)
            }
            // Downloads and RSS are server-ops widgets: admins only.
            if model.isAdmin {
                downloadsWidget
            }
            if !attention.isEmpty {
                attentionWidget
            }
            if model.isAdmin, let rss {
                rssWidget(rss)
            }
            if model.isAdmin, let stats {
                libraryStatsWidget(stats)
            }
        }
        .padding(.horizontal, 16)
    }

    private func widgetCard(_ title: LocalizedStringKey, systemImage: String, @ViewBuilder _ content: () -> some View) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            Label(title, systemImage: systemImage)
                .font(.display(16)).foregroundStyle(Theme.textStrong)
            content()
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(16)
        .background(Theme.raised, in: RoundedRectangle(cornerRadius: 16))
        .overlay(RoundedRectangle(cornerRadius: 16).strokeBorder(Theme.border, lineWidth: 1))
    }

    private func nowWatchingWidget(_ np: NowPlayingResponse) -> some View {
        widgetCard("Now watching", systemImage: "play.tv") {
            if let sessions = np.sessions, !sessions.isEmpty {
                VStack(spacing: 10) {
                    ForEach(sessions) { s in
                        HStack(spacing: 10) {
                            VStack(alignment: .leading, spacing: 2) {
                                Text(s.title ?? String(localized: "Playing")).font(.subheadline.weight(.medium)).foregroundStyle(Theme.text).lineLimit(1)
                                Text(verbatim: [s.user, s.device].compactMap(\.self).filter { !$0.isEmpty }.joined(separator: " · ")).font(.caption2).foregroundStyle(Theme.faint).lineLimit(1)
                            }
                            Spacer()
                            if let p = s.progressPct {
                                Text("\(Int(p))%").font(.system(.caption, design: .monospaced)).foregroundStyle(Theme.muted)
                            }
                        }
                    }
                }
            } else {
                Text("Nobody's watching right now.").font(.subheadline).foregroundStyle(Theme.muted)
            }
        }
    }

    private var downloadsWidget: some View {
        widgetCard("Downloads", systemImage: "arrow.down.circle") {
            if let speed, speed.connected {
                HStack(spacing: 18) {
                    speedLabel("down", speed.dlSpeed, Theme.muted)
                    speedLabel("up", speed.ulSpeed, Theme.muted)
                }
            } else {
                Text(LocalizedStringKey(speed?.enabled == true ? "Download client offline." : "No download client configured."))
                    .font(.subheadline).foregroundStyle(Theme.muted)
            }
        }
    }

    private func speedLabel(_ dir: String, _ bytes: Double, _ tint: Color) -> some View {
        // `bytes <= 0` is false for .nan/.infinity (and finite overflow slips
        // past too), so guarding here rather than at the comparison: both would
        // otherwise fall through to a trapping Int64 init. dlSpeed/ulSpeed are
        // server-decoded Doubles, so an overflowing literal decodes to .infinity.
        let safeBytes = bytes.isFinite && bytes > 0 ? (Int64(exactly: bytes.rounded()) ?? 0) : 0
        let text = safeBytes <= 0 ? "0 KB/s"
            : "\(ByteCountFormatter.string(fromByteCount: safeBytes, countStyle: .file))/s"
        return HStack(spacing: 5) {
            Image(systemName: dir == "down" ? "arrow.down" : "arrow.up").font(.caption2).foregroundStyle(tint)
            Text(text).font(.system(.subheadline, design: .monospaced)).foregroundStyle(Theme.text)
        }
    }

    private var attentionWidget: some View {
        widgetCard("Needs attention", systemImage: "exclamationmark.triangle") {
            VStack(spacing: 10) {
                ForEach(attention.prefix(5)) { item in
                    attentionRow(item)
                }
            }
        }
    }

    /// A row tappable through to detail when it carries a library id; otherwise
    /// a plain informational row.
    @ViewBuilder
    private func attentionRow(_ item: AttentionItem) -> some View {
        if let mediaId = item.mediaId {
            Button {
                openAttention(mediaId: mediaId)
            } label: {
                attentionRowContent(item, busy: resolvingAttentionId == mediaId)
            }
            .buttonStyle(.plain)
            .disabled(resolvingAttentionId != nil)
        } else {
            attentionRowContent(item, busy: false)
        }
    }

    private func attentionRowContent(_ item: AttentionItem, busy: Bool) -> some View {
        HStack(alignment: .top, spacing: 10) {
            Circle().fill(Theme.terracotta).frame(width: 7, height: 7).padding(.top, 5)
            VStack(alignment: .leading, spacing: 2) {
                Text(item.mediaTitle ?? item.kind ?? "Item").font(.subheadline.weight(.medium)).foregroundStyle(Theme.text).lineLimit(1)
                if let detail = item.detail {
                    Text(detail).font(.caption2).foregroundStyle(Theme.muted).lineLimit(2)
                }
            }
            Spacer()
            if busy {
                ProgressView().tint(Theme.muted)
            } else if item.mediaId != nil {
                Image(systemName: "chevron.right").font(.caption2.weight(.semibold)).foregroundStyle(Theme.faint)
            }
        }
        .contentShape(Rectangle())
    }

    /// Resolve a library item by id (the attention feed omits tmdbId/poster) and
    /// push its detail. Silent no-op on missing api; toasts on fetch failure.
    private func openAttention(mediaId: Int) {
        guard let client = model.api(), resolvingAttentionId == nil else { return }
        resolvingAttentionId = mediaId
        Task {
            defer { resolvingAttentionId = nil }
            if let item = try? await client.libraryItem(id: mediaId) {
                attentionTarget = AttentionRoute(
                    id: item.id,
                    tmdbId: item.tmdbId,
                    mediaType: item.type == "show" ? "tv" : "movie",
                    title: item.title,
                    posterUrl: item.posterUrl
                )
            } else {
                model.toast(String(localized: "Couldn't open that item."), style: .error)
            }
        }
    }

    private func rssWidget(_ r: RssStatusResponse) -> some View {
        widgetCard("RSS", systemImage: "dot.radiowaves.up.forward") {
            if let run = r.lastRun {
                VStack(alignment: .leading, spacing: 6) {
                    HStack(spacing: 8) {
                        StatusBadge(text: run.status == "error" ? "Error" : "OK",
                                    tint: run.status == "error" ? Theme.terracotta : Theme.seed)
                        Text("\(run.releasesFound ?? 0) found · \(run.releasesGrabbed ?? 0) grabbed")
                            .font(.system(.caption, design: .monospaced)).foregroundStyle(Theme.muted)
                    }
                    if let err = run.error {
                        Text(err).font(.caption2).foregroundStyle(Theme.terracotta).lineLimit(1)
                    }
                }
            } else {
                Text("No RSS runs yet.").font(.subheadline).foregroundStyle(Theme.muted)
            }
        }
    }

    // MARK: Library stats widget (admin)

    private func libraryStatsWidget(_ s: LibraryStats) -> some View {
        widgetCard("Library", systemImage: "internaldrive") {
            VStack(alignment: .leading, spacing: 14) {
                HStack(alignment: .top, spacing: 18) {
                    statFigure("\(s.totalMovies)", "Movies")
                    statFigure("\(s.totalShows)", "Shows")
                    statFigure("\(s.downloaded)", "Downloaded")
                    if s.wanted > 0 {
                        statFigure("\(s.wanted)", "Wanted")
                    }
                    if s.returningSeries > 0 {
                        statFigure("\(s.returningSeries)", "Returning")
                    }
                    Spacer(minLength: 0)
                }
                HStack(spacing: 6) {
                    Text("Storage").font(.caption2).foregroundStyle(Theme.faint)
                    Text(byteString(s.storageUsedBytes))
                        .font(.system(.subheadline, design: .monospaced)).foregroundStyle(Theme.text)
                }
                let bars = orderedStorageBars(s.storageByResolution)
                if !bars.isEmpty {
                    storageBars(bars, total: s.storageUsedBytes)
                }
                if let total = s.diskTotalBytes, let free = s.diskFreeBytes, total > 0 {
                    diskGauge(total: total, free: free)
                }
            }
        }
    }

    private func statFigure(_ value: String, _ label: LocalizedStringKey) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(value).font(.system(.title3, design: .rounded).weight(.semibold)).foregroundStyle(Theme.textStrong)
            Text(label).font(.caption2).foregroundStyle(Theme.faint)
        }
    }

    /// Storage rows with a value, ordered low→high resolution with unknown last.
    private func orderedStorageBars(_ rows: [StorageByResolution]) -> [StorageByResolution] {
        rows.filter { $0.sizeBytes > 0 }.sorted { resolutionRank($0.resolution) < resolutionRank($1.resolution) }
    }

    /// Bars are each resolution's share of total library storage, so their
    /// widths sum to the whole rather than the largest bucket always filling.
    private func storageBars(_ rows: [StorageByResolution], total: Int) -> some View {
        let denom = max(total, 1)
        return VStack(spacing: 8) {
            ForEach(rows) { row in
                VStack(spacing: 4) {
                    HStack {
                        Text(resolutionLabel(row.resolution)).font(.caption).foregroundStyle(Theme.muted)
                        Spacer()
                        Text(byteString(row.sizeBytes))
                            .font(.system(.caption, design: .monospaced)).foregroundStyle(Theme.text)
                    }
                    GeometryReader { geo in
                        ZStack(alignment: .leading) {
                            Capsule().fill(Theme.base)
                            Capsule().fill(Theme.seed)
                                .frame(width: max(geo.size.width * CGFloat(row.sizeBytes) / CGFloat(denom), 2))
                        }
                    }
                    .frame(height: 6)
                }
            }
        }
    }

    /// Volume capacity: used fill over the whole disk, with a "free of total" label.
    private func diskGauge(total: Int, free: Int) -> some View {
        let used = max(min(total - free, total), 0)
        let fraction = CGFloat(used) / CGFloat(max(total, 1))
        return VStack(spacing: 4) {
            HStack {
                Text("Disk").font(.caption).foregroundStyle(Theme.muted)
                Spacer()
                Text("\(byteString(free)) free of \(byteString(total))")
                    .font(.system(.caption, design: .monospaced)).foregroundStyle(Theme.text)
            }
            GeometryReader { geo in
                ZStack(alignment: .leading) {
                    Capsule().fill(Theme.base)
                    Capsule().fill(fraction > 0.9 ? Theme.terracotta : Theme.apricot)
                        .frame(width: max(geo.size.width * fraction, 2))
                }
            }
            .frame(height: 6)
        }
    }

    private func resolutionRank(_ r: String) -> Int {
        switch r {
        case "480p": 0
        case "720p": 1
        case "1080p": 2
        case "4k": 3
        default: 4
        }
    }

    private func resolutionLabel(_ r: String) -> String {
        switch r {
        case "4k": "4K"
        case "unknown": String(localized: "SD / unknown")
        default: r
        }
    }

    private func byteString(_ bytes: Int) -> String {
        let safe = Int64(exactly: bytes) ?? .max
        return ByteCountFormatter.string(fromByteCount: max(safe, 0), countStyle: .file)
    }

    // MARK: Load

    private func load() async {
        guard let client = model.api() else {
            loading = false
            return
        }
        if model.library.isEmpty {
            await model.loadLibrary()
        }
        async let recentR = client.recentlyAdded()
        async let upcomingR = client.upcoming()
        async let discoverR = client.discoverDeck(exclude: [], limit: 12)
        async let npR = client.nowPlaying()
        async let speedR = client.speed()
        async let attnR = client.libraryAttention()
        async let rssR = client.rssStatus()

        // A failed refetch (a transient error on pull-to-refresh) must not blank
        // content already on screen: replace each section only when its request
        // succeeds, so the rails survive a hiccup instead of vanishing until the
        // view is rebuilt. `(try?)?.items` returns [] for a real empty result and
        // nil only on failure, so a genuinely empty section still clears.
        if let items = await (try? recentR)?.items {
            recent = items
        }
        if let items = await (try? upcomingR)?.items {
            upcoming = items
        }
        if let deck = try? await discoverR {
            discover = deck
        }
        if let np = try? await npR {
            nowPlaying = np
        }
        if let sp = try? await speedR {
            speed = sp
        }
        if let items = await (try? attnR)?.items {
            attention = items
        }
        if let status = try? await rssR {
            rss = status
        }
        if model.isAdmin, let s = try? await client.libraryStats() {
            stats = s
        }

        loading = false
    }
}

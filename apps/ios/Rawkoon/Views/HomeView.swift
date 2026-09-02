import SwiftUI

/// The home screen — admin dashboard: greeting, Continue, Recently Added and
/// Upcoming rails, then a widget stack (Now Watching, Downloads, Library
/// Attention, RSS). Widgets self-hide when their integration is off.
struct HomeView: View {
    @Environment(AppModel.self) private var model

    @State private var recent: [LibraryMedia] = []
    @State private var upcoming: [UpcomingItem] = []
    @State private var nowPlaying: NowPlayingResponse?
    @State private var speed: SpeedResponse?
    @State private var attention: [AttentionItem] = []
    @State private var rss: RssStatusResponse?
    @State private var loading = true
    /// Bumped on pull-to-refresh so the Continue card reloads with the rest of
    /// the dashboard; it owns its own fetch otherwise.
    @State private var continueToken = 0

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 26) {
                greeting

                if loading, recent.isEmpty {
                    ProgressView().tint(Theme.muted)
                        .frame(maxWidth: .infinity).padding(.top, 40)
                } else {
                    ContinueListeningView(refreshToken: continueToken, limit: 3)
                    if !recent.isEmpty {
                        rail("Recently added", recent.map(RailItem.library))
                    }
                    if !upcoming.isEmpty {
                        rail("Upcoming", upcoming.map(RailItem.upcoming))
                    }
                    widgets
                }
            }
            .padding(.vertical, 12)
            .padding(.bottom, 96)
        }
        .background(Theme.base)
        .navigationTitle("Home")
        .navigationBarTitleDisplayMode(.inline)
        .task { await load() }
        .refreshable {
            continueToken += 1
            await load()
        }
    }

    // MARK: Greeting

    private var greeting: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text("\(timeGreeting), \(model.userFirstName ?? "there")")
                .font(.display(28))
                .foregroundStyle(Theme.textStrong)
            Text(subtitle)
                .font(.subheadline)
                .foregroundStyle(Theme.muted)
        }
        .padding(.horizontal, 16)
    }

    private var timeGreeting: String {
        switch Calendar.current.component(.hour, from: Date()) {
        case 5 ..< 12: "Good morning"
        case 12 ..< 18: "Good afternoon"
        default: "Good evening"
        }
    }

    private var subtitle: String {
        let weekday = Calendar.current.component(.weekday, from: Date())
        switch weekday {
        case 1, 7: return "Enjoy your weekend."
        case 2: return "A fresh week begins."
        case 6: return "The weekend's nearly here."
        default: return "Here's what's happening."
        }
    }

    // MARK: Poster rails

    private enum RailItem: Identifiable {
        case library(LibraryMedia)
        case upcoming(UpcomingItem)
        var id: String {
            switch self {
            case let .library(m): "l\(m.id)"
            case let .upcoming(u): "u\(u.id)"
            }
        }
    }

    private func rail(_ title: String, _ items: [RailItem]) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            Text(title).font(.display(19)).foregroundStyle(Theme.textStrong).padding(.horizontal, 16)
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 12) {
                    ForEach(items) { item in railCard(item) }
                }
                .padding(.horizontal, 16)
            }
        }
    }

    @ViewBuilder
    private func railCard(_ item: RailItem) -> some View {
        switch item {
        case let .library(m):
            NavigationLink {
                MediaDetailView(tmdbId: m.tmdbId, mediaType: m.type == "show" ? "tv" : "movie",
                                title: m.title, posterPath: m.posterUrl, libraryId: m.id)
            } label: { poster(title: m.title, url: m.posterUrl) }
                .buttonStyle(.plain)
        case let .upcoming(u):
            NavigationLink {
                MediaDetailView(tmdbId: u.tmdbId ?? 0, mediaType: u.mediaType,
                                title: u.title, posterPath: u.posterUrl, libraryId: u.libraryId)
            } label: {
                poster(title: u.title, url: u.posterUrl,
                       date: u.displayDate, episode: u.episodeLabel)
            }
            .buttonStyle(.plain)
            .disabled(u.tmdbId == nil && u.libraryId == nil)
        }
    }

    private func poster(title: String, url: String?, date: String? = nil, episode: String? = nil) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Rectangle().fill(Theme.raised)
                .frame(width: 110, height: 165)
                .overlay {
                    AsyncImage(url: model.absoluteURL(url)) { $0.resizable().scaledToFill() }
                        placeholder: { Image(systemName: "photo").foregroundStyle(Theme.faint) }
                }
                .clipShape(RoundedRectangle(cornerRadius: 10))
                .overlay(RoundedRectangle(cornerRadius: 10).strokeBorder(.white.opacity(0.05), lineWidth: 1))
            Text(title).font(.caption).foregroundStyle(Theme.textStrong)
                .lineLimit(2).frame(width: 110, height: 34, alignment: .top)
            if date != nil || episode != nil {
                HStack(spacing: 6) {
                    if let date {
                        Text(date).font(.caption2).foregroundStyle(Theme.muted)
                    }
                    Spacer(minLength: 0)
                    if let episode {
                        Text(episode).font(.caption2.weight(.semibold)).foregroundStyle(Theme.apricot)
                    }
                }
                .lineLimit(1)
                .frame(width: 110)
            }
        }
    }

    // MARK: Widgets

    private var widgets: some View {
        VStack(spacing: 14) {
            if let np = nowPlaying, np.enabled {
                nowWatchingWidget(np)
            }
            downloadsWidget
            if !attention.isEmpty {
                attentionWidget
            }
            if let rss {
                rssWidget(rss)
            }
        }
        .padding(.horizontal, 16)
    }

    private func widgetCard(_ title: String, systemImage: String, @ViewBuilder _ content: () -> some View) -> some View {
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
                                Text(s.title ?? "Playing").font(.subheadline.weight(.medium)).foregroundStyle(Theme.text).lineLimit(1)
                                Text("\(s.user ?? "") · \(s.device ?? "")").font(.caption2).foregroundStyle(Theme.faint).lineLimit(1)
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
                Text(speed?.enabled == true ? "Download client offline." : "No download client configured.")
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
                    HStack(alignment: .top, spacing: 10) {
                        Circle().fill(Theme.terracotta).frame(width: 7, height: 7).padding(.top, 5)
                        VStack(alignment: .leading, spacing: 2) {
                            Text(item.mediaTitle ?? item.kind ?? "Item").font(.subheadline.weight(.medium)).foregroundStyle(Theme.text).lineLimit(1)
                            if let detail = item.detail {
                                Text(detail).font(.caption2).foregroundStyle(Theme.muted).lineLimit(2)
                            }
                        }
                        Spacer()
                    }
                }
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
        async let npR = client.nowPlaying()
        async let speedR = client.speed()
        async let attnR = client.libraryAttention()
        async let rssR = client.rssStatus()

        recent = await (try? recentR)?.items ?? []
        upcoming = await (try? upcomingR)?.items ?? []
        nowPlaying = try? await npR
        speed = try? await speedR
        attention = await (try? attnR)?.items ?? []
        rss = try? await rssR

        loading = false
    }
}

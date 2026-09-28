import SwiftUI
import UIKit
import WidgetKit

private enum WidgetPalette {
    static let surface = Color(red: 0x24 / 255, green: 0x1E / 255, blue: 0x1B / 255)
    static let well = Color(red: 0x14 / 255, green: 0x10 / 255, blue: 0x10 / 255)
    static let strong = Color(red: 0xF4 / 255, green: 0xEC / 255, blue: 0xE4 / 255)
    static let muted = Color(red: 0xAA / 255, green: 0x9A / 255, blue: 0x8C / 255)
    static let apricot = Color(red: 0xE8 / 255, green: 0xA0 / 255, blue: 0x6A / 255)
    static let terracotta = Color(red: 0xCF / 255, green: 0x6A / 255, blue: 0x4E / 255)
    static let seed = Color(red: 0x86 / 255, green: 0xB9 / 255, blue: 0x8A / 255)
}

private struct HomeEntry: TimelineEntry {
    let date: Date
    let snapshot: WidgetSnapshot
}

private struct HomeProvider: TimelineProvider {
    func placeholder(in _: Context) -> HomeEntry {
        HomeEntry(date: .now, snapshot: .empty)
    }

    func getSnapshot(in _: Context, completion: @escaping (HomeEntry) -> Void) {
        completion(HomeEntry(date: .now, snapshot: WidgetSnapshotStore.read()))
    }

    func getTimeline(in _: Context, completion: @escaping (Timeline<HomeEntry>) -> Void) {
        completion(Timeline(
            entries: [HomeEntry(date: .now, snapshot: WidgetSnapshotStore.read())],
            policy: .after(Date(timeIntervalSinceNow: 30 * 60))
        ))
    }
}

private struct WidgetHeading: View {
    let title: LocalizedStringKey

    var body: some View {
        HStack {
            Text(title)
                .font(.system(size: 11, weight: .semibold))
                .textCase(.uppercase)
                .tracking(1.1)
                .foregroundStyle(WidgetPalette.apricot)
            Spacer(minLength: 2)
            Image(systemName: "play.circle.fill")
                .font(.system(size: 17))
                .foregroundStyle(WidgetPalette.apricot)
                .accessibilityHidden(true)
        }
    }
}

private struct Artwork: View {
    let data: Data?

    var body: some View {
        Group {
            if let data, let image = UIImage(data: data) {
                Image(uiImage: image).resizable().scaledToFill()
            } else {
                LinearGradient(
                    colors: [WidgetPalette.terracotta, WidgetPalette.well],
                    startPoint: .topLeading, endPoint: .bottomTrailing
                )
                .overlay {
                    Image(systemName: "film")
                        .foregroundStyle(WidgetPalette.strong.opacity(0.55))
                }
            }
        }
        .aspectRatio(2 / 3, contentMode: .fill)
        .clipShape(RoundedRectangle(cornerRadius: 7))
        .overlay(alignment: .leading) { Rectangle().fill(.black.opacity(0.18)).frame(width: 4) }
    }
}

private struct ListeningWidgetView: View {
    let snapshot: WidgetSnapshot
    @Environment(\.widgetFamily) private var family

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            WidgetHeading(title: "Listening · 7 days")
            if let listening = snapshot.listening {
                Text(duration(listening.weekSeconds))
                    .font(.system(size: family == .systemSmall ? 32 : 38, weight: .semibold, design: .rounded))
                    .monospacedDigit()
                    .foregroundStyle(WidgetPalette.strong)
                    .minimumScaleFactor(0.7)
                    .lineLimit(1)
                    .padding(.top, family == .systemSmall ? 15 : 20)
                Text("This week")
                    .font(.caption2)
                    .foregroundStyle(WidgetPalette.muted)
                Spacer(minLength: 8)
                if family == .systemSmall {
                    HStack(spacing: 4) {
                        ForEach(Array(listening.days.suffix(7).enumerated()), id: \.offset) { _, seconds in
                            RoundedRectangle(cornerRadius: 4)
                                .fill(seconds > 0 ? WidgetPalette.apricot : WidgetPalette.well)
                                .frame(height: 23)
                        }
                    }
                } else {
                    let maxSeconds = max(listening.days.max() ?? 0, 1)
                    HStack(alignment: .bottom, spacing: 6) {
                        ForEach(Array(listening.days.suffix(7).enumerated()), id: \.offset) { _, seconds in
                            RoundedRectangle(cornerRadius: 4)
                                .fill(seconds > 0 ? WidgetPalette.apricot : WidgetPalette.well)
                                .frame(height: max(4, 44 * seconds / maxSeconds))
                                .frame(maxWidth: .infinity, alignment: .bottom)
                        }
                    }
                    .frame(height: 44, alignment: .bottom)
                    Text("Today: \(duration(listening.todaySeconds))")
                        .font(.caption2)
                        .foregroundStyle(WidgetPalette.muted)
                        .padding(.top, 6)
                }
            } else {
                empty("Open Rawkoon to load listening stats")
            }
        }
        .containerBackground(WidgetPalette.surface, for: .widget)
        .widgetURL(URL(string: "rawkoon://home"))
    }

    private func duration(_ seconds: Double) -> String {
        Duration.seconds(max(0, seconds)).formatted(.units(allowed: [.hours, .minutes], width: .narrow))
    }
}

private struct RecentWidgetView: View {
    let snapshot: WidgetSnapshot

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            WidgetHeading(title: "Recently added")
            if snapshot.recent.isEmpty {
                empty("Open Rawkoon to load new additions")
            } else {
                HStack(spacing: 10) {
                    ForEach(Array(snapshot.recent.prefix(3).enumerated()), id: \.offset) { _, media in
                        VStack(alignment: .leading, spacing: 4) {
                            Artwork(data: media.artwork)
                                .frame(maxWidth: .infinity)
                            Text(media.title)
                                .font(.caption2)
                                .foregroundStyle(WidgetPalette.strong)
                                .lineLimit(1)
                        }
                    }
                }
            }
        }
        .containerBackground(WidgetPalette.surface, for: .widget)
        .widgetURL(URL(string: "rawkoon://home"))
    }
}

private struct SuggestionWidgetView: View {
    let snapshot: WidgetSnapshot
    @Environment(\.widgetFamily) private var family

    private var todaysSuggestion: WidgetSuggestion? {
        guard let day = snapshot.suggestionDay,
              Calendar.current.isDate(day, inSameDayAs: .now)
        else { return nil }
        return snapshot.suggestion
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 11) {
            WidgetHeading(title: todaysSuggestion?.personalized == true ? "For you" : "Trending")
            if let suggestion = todaysSuggestion {
                if family == .systemSmall {
                    Artwork(data: suggestion.media.artwork).frame(width: 43, height: 64)
                    Text(suggestion.media.title)
                        .font(.system(.caption, design: .serif, weight: .semibold))
                        .foregroundStyle(WidgetPalette.strong)
                        .lineLimit(2)
                } else {
                    HStack(alignment: .top, spacing: 14) {
                        Artwork(data: suggestion.media.artwork).frame(width: 73, height: 109)
                        VStack(alignment: .leading, spacing: 7) {
                            Text(suggestion.media.title)
                                .font(.system(.headline, design: .serif, weight: .semibold))
                                .foregroundStyle(WidgetPalette.strong)
                                .lineLimit(3)
                            Text(suggestion.media.detail)
                                .font(.caption)
                                .foregroundStyle(WidgetPalette.muted)
                            Spacer(minLength: 0)
                            Text("Discover")
                                .font(.caption2.weight(.semibold))
                                .foregroundStyle(WidgetPalette.apricot)
                        }
                    }
                }
            } else {
                empty("Open Rawkoon to find a suggestion")
            }
        }
        .containerBackground(WidgetPalette.surface, for: .widget)
        .widgetURL(URL(string: "rawkoon://discover"))
    }
}

private func empty(_ message: LocalizedStringKey) -> some View {
    Spacer(minLength: 12)
        .overlay(alignment: .topLeading) {
            Text(message)
                .font(.caption)
                .foregroundStyle(WidgetPalette.muted)
                .fixedSize(horizontal: false, vertical: true)
        }
}

struct ListeningHomeWidget: Widget {
    let kind = "cloud.samlo.rawkoon.listening"
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: kind, provider: HomeProvider()) { entry in
            ListeningWidgetView(snapshot: entry.snapshot)
        }
        .configurationDisplayName("Listening this week")
        .description("Your audiobook listening across seven days.")
        .supportedFamilies([.systemSmall, .systemMedium])
    }
}

struct RecentHomeWidget: Widget {
    let kind = "cloud.samlo.rawkoon.recent"
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: kind, provider: HomeProvider()) { entry in
            RecentWidgetView(snapshot: entry.snapshot)
        }
        .configurationDisplayName("Recently added")
        .description("The latest additions to your library.")
        .supportedFamilies([.systemMedium])
    }
}

struct SuggestionHomeWidget: Widget {
    let kind = "cloud.samlo.rawkoon.suggestion"
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: kind, provider: HomeProvider()) { entry in
            SuggestionWidgetView(snapshot: entry.snapshot)
        }
        .configurationDisplayName("Suggestion of the day")
        .description("A title to discover in Rawkoon.")
        .supportedFamilies([.systemSmall, .systemMedium])
    }
}

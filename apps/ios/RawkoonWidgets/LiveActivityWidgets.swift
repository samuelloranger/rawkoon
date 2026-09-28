import SwiftUI
import WidgetKit
#if !targetEnvironment(macCatalyst)
    import ActivityKit

    private enum LivePalette {
        static let surface = Color(red: 0.19, green: 0.15, blue: 0.13)
        static let strong = Color(red: 0.96, green: 0.93, blue: 0.89)
        static let muted = Color(red: 0.67, green: 0.60, blue: 0.55)
        static let apricot = Color(red: 0.91, green: 0.63, blue: 0.42)
        static let terracotta = Color(red: 0.81, green: 0.42, blue: 0.31)
    }

    private struct LiveProgress: View {
        let value: Double

        var body: some View {
            GeometryReader { proxy in
                Capsule().fill(.white.opacity(0.1))
                    .overlay(alignment: .leading) {
                        Capsule()
                            .fill(LinearGradient(
                                colors: [LivePalette.terracotta, LivePalette.apricot],
                                startPoint: .leading, endPoint: .trailing
                            ))
                            .frame(width: proxy.size.width * min(1, max(0, value)))
                    }
            }
            .frame(height: 5)
        }
    }

    struct ReencodeLiveWidget: Widget {
        var body: some WidgetConfiguration {
            ActivityConfiguration(for: ReencodeActivityAttributes.self) { context in
                VStack(alignment: .leading, spacing: 7) {
                    HStack {
                        Text("RAWKOON · RE-ENCODE")
                            .font(.caption2.weight(.semibold))
                            .tracking(0.8)
                            .foregroundStyle(LivePalette.apricot)
                        Spacer()
                        Image(systemName: "gauge.with.dots.needle.67percent")
                            .foregroundStyle(LivePalette.apricot)
                    }
                    Text(context.state.step == "validate" ? "Checking quality" : context.attributes.title)
                        .font(.system(.headline, design: .serif, weight: .semibold))
                        .foregroundStyle(LivePalette.strong)
                        .lineLimit(1)
                    Text("\(context.attributes.codec.uppercased()) · \(context.state.step == "validate" ? "Validation" : "Converting")")
                        .font(.caption2)
                        .foregroundStyle(LivePalette.muted)
                    if context.state.step != "validate" {
                        LiveProgress(value: context.state.progress)
                        HStack {
                            Text("\(Int((context.state.progress * 100).rounded()))%")
                            Spacer()
                            if let eta = context.state.etaSeconds {
                                Text("~\(max(1, eta / 60)) min left")
                            }
                        }
                        .font(.caption2.monospacedDigit())
                        .foregroundStyle(LivePalette.muted)
                    } else {
                        Text("Conversion finished · result pending")
                            .font(.caption2)
                            .foregroundStyle(LivePalette.muted)
                    }
                }
                .padding(15)
                .activityBackgroundTint(LivePalette.surface)
                .activitySystemActionForegroundColor(LivePalette.apricot)
            } dynamicIsland: { context in
                DynamicIsland {
                    DynamicIslandExpandedRegion(.leading) {
                        Label("Re-encode", systemImage: "gauge.with.dots.needle.67percent")
                            .foregroundStyle(LivePalette.apricot)
                    }
                    DynamicIslandExpandedRegion(.trailing) {
                        Text(context.state.step == "validate" ? "Checking" : "\(Int((context.state.progress * 100).rounded()))%")
                            .foregroundStyle(LivePalette.strong)
                    }
                    DynamicIslandExpandedRegion(.bottom) {
                        VStack(alignment: .leading, spacing: 7) {
                            Text(context.attributes.title).lineLimit(1)
                            if context.state.step != "validate" {
                                LiveProgress(value: context.state.progress)
                            }
                        }
                        .font(.caption)
                    }
                } compactLeading: {
                    Image(systemName: "gauge.with.dots.needle.67percent")
                        .foregroundStyle(LivePalette.apricot)
                } compactTrailing: {
                    Text(context.state.step == "validate" ? "✓" : "\(Int((context.state.progress * 100).rounded()))%")
                        .font(.caption2.monospacedDigit())
                } minimal: {
                    Image(systemName: "gauge.with.dots.needle.67percent")
                        .foregroundStyle(LivePalette.apricot)
                }
                .keylineTint(LivePalette.apricot)
            }
        }
    }

    private struct SleepRemaining: View {
        let state: SleepActivityAttributes.ContentState

        var body: some View {
            if state.isPlaying {
                Text(timerInterval: state.measuredAt ... state.measuredAt.addingTimeInterval(max(0, state.remainingSeconds)),
                     countsDown: true, showsHours: false)
                    .monospacedDigit()
            } else {
                Text("\(max(0, Int(state.remainingSeconds / 60))) min")
                    .monospacedDigit()
            }
        }
    }

    struct SleepLiveWidget: Widget {
        var body: some WidgetConfiguration {
            ActivityConfiguration(for: SleepActivityAttributes.self) { context in
                VStack(alignment: .leading, spacing: 8) {
                    HStack {
                        Text("RAWKOON · SLEEP TIMER")
                            .font(.caption2.weight(.semibold))
                            .tracking(0.8)
                            .foregroundStyle(LivePalette.apricot)
                        Spacer()
                        Image(systemName: "moon.zzz")
                            .foregroundStyle(LivePalette.apricot)
                    }
                    Text(context.attributes.bookTitle)
                        .font(.system(.headline, design: .serif, weight: .semibold))
                        .foregroundStyle(LivePalette.strong)
                        .lineLimit(1)
                    if let chapter = context.state.chapterTitle {
                        Text(chapter).font(.caption2).foregroundStyle(LivePalette.muted).lineLimit(1)
                    }
                    HStack {
                        Text(context.state.isPlaying ? "Stops in" : "Paused ·")
                            .foregroundStyle(LivePalette.muted)
                        SleepRemaining(state: context.state)
                            .foregroundStyle(LivePalette.strong)
                    }
                    .font(.caption.monospacedDigit())
                }
                .padding(15)
                .activityBackgroundTint(LivePalette.surface)
                .activitySystemActionForegroundColor(LivePalette.apricot)
            } dynamicIsland: { context in
                DynamicIsland {
                    DynamicIslandExpandedRegion(.leading) {
                        Label("Sleep timer", systemImage: "moon.zzz")
                            .foregroundStyle(LivePalette.apricot)
                    }
                    DynamicIslandExpandedRegion(.trailing) {
                        SleepRemaining(state: context.state)
                    }
                    DynamicIslandExpandedRegion(.bottom) {
                        Text(context.attributes.bookTitle)
                            .font(.caption)
                            .lineLimit(1)
                    }
                } compactLeading: {
                    Image(systemName: "moon.zzz")
                        .foregroundStyle(LivePalette.apricot)
                } compactTrailing: {
                    SleepRemaining(state: context.state)
                        .font(.caption2)
                } minimal: {
                    Image(systemName: "moon.zzz")
                        .foregroundStyle(LivePalette.apricot)
                }
                .keylineTint(LivePalette.apricot)
            }
        }
    }
#endif

@main
struct RawkoonWidgetsBundle: WidgetBundle {
    var body: some Widget {
        ListeningHomeWidget()
        RecentHomeWidget()
        SuggestionHomeWidget()
        #if !targetEnvironment(macCatalyst)
            ReencodeLiveWidget()
            SleepLiveWidget()
        #endif
    }
}

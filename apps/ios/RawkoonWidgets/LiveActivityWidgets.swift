import RawkoonKit
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

    private extension ReencodeActivityAttributes.ContentState {
        var isRunning: Bool {
            status == "running"
        }

        var isEncoding: Bool {
            isRunning && step == "encode"
        }

        var label: LocalizedStringKey {
            switch status {
            case "done": "Finished"
            case "failed": "Failed"
            case "cancelled": "Cancelled"
            default:
                switch step {
                case "encode": "Converting"
                case "validate": "Checking quality"
                case "replace": "Replacing file"
                case "rescan": "Updating library"
                default: "Preparing"
                }
            }
        }

        var symbol: String {
            switch status {
            case "done": "checkmark.circle.fill"
            case "failed": "exclamationmark.triangle.fill"
            case "cancelled": "xmark.circle"
            default: "gauge.with.dots.needle.67percent"
            }
        }
    }

    private struct ReencodeStatus: View {
        let state: ReencodeActivityAttributes.ContentState

        var body: some View {
            if state.isRunning {
                Text(state.progress, format: .percent.precision(.fractionLength(0)))
                    .monospacedDigit()
            } else {
                Image(systemName: state.symbol)
                    .foregroundStyle(state.status == "failed" ? LivePalette.terracotta : LivePalette.apricot)
                    .accessibilityLabel(Text(state.label))
            }
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
                        Image(systemName: context.state.symbol)
                            .foregroundStyle(
                                context.state.status == "failed" ? LivePalette.terracotta : LivePalette.apricot
                            )
                            .accessibilityHidden(true)
                    }
                    Text(context.attributes.title)
                        .font(.system(.headline, design: .serif, weight: .semibold))
                        .foregroundStyle(LivePalette.strong)
                        .lineLimit(1)
                    HStack(spacing: 0) {
                        Text(verbatim: "\(context.attributes.codec.uppercased()) · ")
                        Text(context.state.label)
                    }
                    .font(.caption2)
                    .foregroundStyle(LivePalette.muted)
                    if context.state.isEncoding {
                        LiveProgress(value: context.state.progress)
                        HStack {
                            Text(context.state.progress, format: .percent.precision(.fractionLength(0)))
                            Spacer()
                            if let eta = Formatters.etaSeconds(context.state.etaSeconds) {
                                Text("~\(eta) left")
                            }
                        }
                        .font(.caption2.monospacedDigit())
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
                        ReencodeStatus(state: context.state)
                            .foregroundStyle(LivePalette.strong)
                    }
                    DynamicIslandExpandedRegion(.bottom) {
                        VStack(alignment: .leading, spacing: 7) {
                            Text(context.attributes.title).lineLimit(1)
                            if context.state.isEncoding {
                                LiveProgress(value: context.state.progress)
                            } else {
                                Text(context.state.label)
                                    .foregroundStyle(LivePalette.muted)
                            }
                        }
                        .font(.caption)
                    }
                } compactLeading: {
                    Image(systemName: "gauge.with.dots.needle.67percent")
                        .foregroundStyle(LivePalette.apricot)
                } compactTrailing: {
                    ReencodeStatus(state: context.state)
                        .font(.caption2)
                } minimal: {
                    Image(systemName: context.state.symbol)
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
                Text(
                    Duration.seconds(max(0, state.remainingSeconds)),
                    format: .units(allowed: [.hours, .minutes], width: .abbreviated, fractionalPart: .hide(rounded: .up))
                )
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
        WatchHomeWidget()
        #if !targetEnvironment(macCatalyst)
            ReencodeLiveWidget()
            SleepLiveWidget()
        #endif
    }
}

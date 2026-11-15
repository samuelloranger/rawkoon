import RawkoonKit
import SwiftUI

/// Splits a row's width between seasons by episode count; a child with no `stripWeight` keeps its ideal width.
private struct WeightedRow: Layout {
    var spacing: CGFloat = 6

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache _: inout ()) -> CGSize {
        let height = subviews.map { $0.sizeThatFits(.unspecified).height }.max() ?? 0
        return CGSize(width: proposal.width ?? 0, height: height)
    }

    func placeSubviews(in bounds: CGRect, proposal _: ProposedViewSize, subviews: Subviews, cache _: inout ()) {
        let fixed = subviews.map { $0[StripWeight.self] == nil ? $0.sizeThatFits(.unspecified).width : 0 }
        let weights = subviews.map { $0[StripWeight.self] ?? 0 }
        let gaps = spacing * CGFloat(max(subviews.count - 1, 0))
        let flexible = max(bounds.width - fixed.reduce(0, +) - gaps, 0)
        let total = max(weights.reduce(0, +), 1)
        var x = bounds.minX
        for index in subviews.indices {
            let width = weights[index] > 0 ? flexible * weights[index] / total : fixed[index]
            subviews[index].place(
                at: CGPoint(x: x, y: bounds.minY), anchor: .topLeading,
                proposal: ProposedViewSize(width: width, height: bounds.height)
            )
            x += width + spacing
        }
    }
}

private nonisolated struct StripWeight: LayoutValueKey {
    static let defaultValue: CGFloat? = nil
}

/// One bar per episode. Lit = will be grabbed, outlined = not aired yet, a dashed box = announced season,
/// the dashed line = today. In pick mode each season is a checkbox.
struct SeasonStrip: View {
    let seasons: [SeasonInfo]
    let choice: SeasonChoice
    /// Non-nil makes each season tappable (pick mode).
    var onToggle: ((Int) -> Void)?
    var today = SeasonPlan.today()

    private var grabbed: Set<Int> {
        SeasonPlan.monitored(seasons, choice: choice, today: today)
    }

    /// The first season that has not aired is where "today" sits.
    private var todayBefore: Int? {
        seasons.first { !SeasonPlan.isAired($0, today: today) }?.number
    }

    var body: some View {
        WeightedRow {
            ForEach(seasons) { season in
                if season.number == todayBefore, season.number != seasons.first?.number {
                    TodayLine().layoutValue(key: StripWeight.self, value: nil)
                }
                block(season)
                    .layoutValue(key: StripWeight.self, value: CGFloat(max(season.episodes, 3)))
            }
        }
        .frame(height: onToggle == nil ? 44 : 56)
        .accessibilityElement(children: onToggle == nil ? .ignore : .contain)
        .accessibilityLabel(onToggle == nil ? Text(verbatim: accessibilitySummary) : Text(verbatim: ""))
    }

    @ViewBuilder
    private func block(_ season: SeasonInfo) -> some View {
        let lit = grabbed.contains(season.number)
        let aired = SeasonPlan.isAired(season, today: today)
        let content = VStack(spacing: 4) {
            if SeasonPlan.isAnnounced(season) {
                RoundedRectangle(cornerRadius: 3)
                    .strokeBorder(Theme.border, style: StrokeStyle(lineWidth: 1, dash: [3, 2]))
                    .frame(height: 22)
            } else {
                HStack(spacing: 1) {
                    ForEach(0 ..< season.episodes, id: \.self) { _ in
                        RoundedRectangle(cornerRadius: 1)
                            .fill(aired ? (lit ? Theme.apricot : Theme.border.opacity(0.6)) : Color.clear)
                            .overlay(
                                RoundedRectangle(cornerRadius: 1)
                                    .strokeBorder(lit ? Theme.apricot : Theme.border, lineWidth: aired ? 0 : 1)
                            )
                    }
                }
                .frame(height: 22)
            }
            HStack(spacing: 2) {
                if onToggle != nil {
                    Image(systemName: lit ? "checkmark.circle.fill" : "circle")
                        .font(.system(size: 11))
                        .foregroundStyle(lit ? Theme.apricot : Theme.faint)
                }
                Text("\(season.number)")
                    .font(.system(size: 11, weight: .medium, design: .monospaced))
                    .foregroundStyle(lit ? Theme.textStrong : Theme.faint)
            }
            .frame(minHeight: 16)
        }
        .rawkoonMotion(RawkoonMotion.spring, value: lit)
        if let onToggle {
            Button { onToggle(season.number) } label: { content.contentShape(Rectangle()) }
                .buttonStyle(.plain)
                .accessibilityLabel(Text("Season \(season.number), \(season.episodes) episodes"))
                .accessibilityAddTraits(lit ? [.isSelected] : [])
        } else {
            content
        }
    }

    private var accessibilitySummary: String {
        let summary = SeasonPlan.summary(seasons, choice: choice, today: today)
        return SeasonSummaryText.sentence(summary)
    }
}

private struct TodayLine: View {
    var body: some View {
        Rectangle()
            .fill(Color.clear)
            .frame(width: 1, height: 22)
            .overlay(
                Rectangle().stroke(Theme.muted, style: StrokeStyle(lineWidth: 1, dash: [2, 2]))
                    .frame(width: 1)
            )
            .accessibilityHidden(true)
    }
}

/// The sentence under the strip, in words.
enum SeasonSummaryText {
    static func sentence(_ summary: SeasonPlan.Summary) -> String {
        if summary.futureOnly {
            return String(localized: "Gets new episodes only, as they air.")
        }
        if summary.seasonList.isEmpty {
            return summary.monitorNew
                ? String(localized: "Gets new seasons as they air.")
                : String(localized: "Nothing selected.")
        }
        let base = String(localized: "Gets \(summary.episodes) episodes from seasons \(summary.seasonList)")
        return summary.monitorNew
            ? base + String(localized: ", plus new seasons as they air.")
            : base + "."
    }
}

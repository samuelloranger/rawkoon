import RawkoonKit
import SwiftUI

/// The season ribbon from the approved design: a thin bar per episode, "S1" over the year. Parchment = will be
/// grabbed, dim = not, outlined = not aired; a dashed box is an announced season and the dashed line is today
/// (drawn only when episode air dates are known). In pick mode each season is a checkbox.
struct SeasonStrip: View {
    let seasons: [SeasonInfo]
    let choice: SeasonChoice
    /// Non-nil makes each season tappable (pick mode).
    var onToggle: ((Int) -> Void)?
    var today = SeasonPlan.today()

    private var latest: Int? {
        SeasonPlan.latestSeason(seasons, today: today)
    }

    var body: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(alignment: .bottom, spacing: 4) {
                ForEach(seasons) { season in
                    seasonView(season)
                }
            }
            .padding(.top, 22)
            .padding(.horizontal, 4)
        }
        .scrollBounceBehavior(.basedOnSize)
        .accessibilityElement(children: onToggle == nil ? .ignore : .contain)
        .accessibilityLabel(onToggle == nil ? Text(verbatim: summaryText) : Text(verbatim: ""))
    }

    private var summaryText: String {
        SeasonSummaryText.sentence(SeasonPlan.summary(seasons, choice: choice, today: today))
    }

    @ViewBuilder
    private func seasonView(_ season: SeasonInfo) -> some View {
        let announced = SeasonPlan.isAnnounced(season)
        let lit = announced
            ? (choice.mode == .future || choice.monitorNew)
            : SeasonPlan.litEpisodes(season, choice: choice, latest: latest, today: today).contains(true)
        let content = VStack(spacing: 8) {
            ticks(season, announced: announced, announcedLit: lit)
            VStack(spacing: 2) {
                HStack(spacing: 5) {
                    if onToggle != nil, !announced {
                        checkbox(lit)
                    }
                    Text(verbatim: "S\(season.number)")
                        .font(.display(15))
                        .foregroundStyle(lit ? Theme.textStrong : Theme.muted)
                }
                Text(announced ? String(localized: "Soon") : String(season.airDate?.prefix(4) ?? ""))
                    .font(.system(size: 11.5))
                    .foregroundStyle(Theme.muted)
                    .frame(minHeight: 14)
            }
        }
        .frame(minWidth: 40)
        .padding(.horizontal, 2)
        .padding(.top, 4)
        .padding(.bottom, 2)
        .rawkoonMotion(RawkoonMotion.spring, value: lit)
        if let onToggle, !announced {
            Button { onToggle(season.number) } label: { content.contentShape(Rectangle()) }
                .buttonStyle(.plain)
                .accessibilityLabel(Text("Season \(season.number), \(season.episodes) episodes"))
                .accessibilityAddTraits(lit ? [.isSelected] : [])
        } else {
            content
        }
    }

    private func checkbox(_ on: Bool) -> some View {
        RoundedRectangle(cornerRadius: 4)
            .strokeBorder(on ? Theme.apricot : Theme.borderStrong, lineWidth: 1.5)
            .background(RoundedRectangle(cornerRadius: 4).fill(on ? Theme.apricot : Color.clear))
            .frame(width: 15, height: 15)
            .overlay {
                if on {
                    Image(systemName: "checkmark").font(.system(size: 9, weight: .heavy)).foregroundStyle(Theme.onAccent)
                }
            }
    }

    @ViewBuilder
    private func ticks(_ season: SeasonInfo, announced: Bool, announcedLit: Bool) -> some View {
        if announced {
            RoundedRectangle(cornerRadius: 5)
                .strokeBorder(
                    announcedLit ? Theme.terracotta : Theme.borderStrong,
                    style: StrokeStyle(lineWidth: 1.5, dash: announcedLit ? [] : [3, 2])
                )
                .background(RoundedRectangle(cornerRadius: 5).fill(announcedLit ? Theme.terracotta.opacity(0.35) : Color.clear))
                .frame(width: 30, height: announcedLit ? 26 : 20)
                .frame(width: 34, height: 38, alignment: .bottom)
        } else {
            let lit = SeasonPlan.litEpisodes(season, choice: choice, latest: latest, today: today)
            let aired = SeasonPlan.airedEpisodes(season, today: today)
            HStack(alignment: .bottom, spacing: 3) {
                ForEach(0 ..< season.episodes, id: \.self) { index in
                    tick(future: index >= aired, on: lit[index])
                }
            }
            .frame(height: 38, alignment: .bottom)
            .overlay(alignment: .bottomLeading) {
                // Mid-air only: the line sits between the last aired bar and the first one still to come.
                if season.aired != nil, aired > 0, aired < season.episodes {
                    TodayLine().offset(x: CGFloat(aired) * 7 - 2.25)
                }
            }
        }
    }

    private func tick(future: Bool, on: Bool) -> some View {
        let height: CGFloat = future ? (on ? 24 : 16) : (on ? 30 : 22)
        return RoundedRectangle(cornerRadius: 2)
            .fill(on ? (future ? Theme.terracotta : Theme.apricot) : (future ? Color.clear : Color(hex: 0x3D3A34)))
            .overlay {
                if future, !on {
                    RoundedRectangle(cornerRadius: 2).strokeBorder(Theme.border, lineWidth: 1)
                }
            }
            .frame(width: 4, height: height)
    }
}

/// The dashed "Today" marker with its label above.
private struct TodayLine: View {
    var body: some View {
        Path { path in
            path.move(to: CGPoint(x: 0.75, y: 0))
            path.addLine(to: CGPoint(x: 0.75, y: 46))
        }
        .stroke(Theme.seed, style: StrokeStyle(lineWidth: 1.5, dash: [3, 2]))
        .frame(width: 2, height: 46)
        .overlay(alignment: .top) {
            Text("Today")
                .font(.system(size: 10.5))
                .foregroundStyle(Theme.seed)
                .fixedSize()
                .offset(y: -14)
        }
        .offset(y: 4)
        .accessibilityHidden(true)
    }
}

/// The sentence under the strip, in words.
enum SeasonSummaryText {
    static func sentence(_ summary: SeasonPlan.Summary) -> String {
        if summary.futureOnly, summary.episodes == 0 {
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

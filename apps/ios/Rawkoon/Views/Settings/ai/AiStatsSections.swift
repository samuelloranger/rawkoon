import Charts
import RawkoonKit
import SwiftUI

/// Usage stats as Form sections: today's spend, metric tiles, daily charts,
/// the by-feature / by-trigger / by-model lists and AI-vs-classic grab outcomes.
struct AiStatsSections: View {
    let stats: AiStatsResponse

    private var totals: AiUsageMetrics {
        stats.totals
    }

    var body: some View {
        Section {
            AiTodayCard(spend: stats.todaySpend, budget: stats.dailyBudgetUsd, pricesConfigured: stats.pricesConfigured)
                .listRowInsets(EdgeInsets())
                .listRowBackground(Color.clear)
        }
        if totals.calls == 0 {
            Section {
                Text("No AI calls in this period yet. Calls show up here as releases get picked.")
                    .font(.subheadline)
                    .foregroundStyle(Theme.muted)
                    .frame(maxWidth: .infinity, alignment: .center)
                    .multilineTextAlignment(.center)
                    .padding(.vertical, 8)
            }
            .listRowBackground(Theme.raised)
        } else {
            Section {
                tiles
                    .id("ai-stats")
                    .listRowInsets(EdgeInsets())
                    .listRowBackground(Color.clear)
            }
            Section {
                AiDailyChart(
                    title: "Calls per day", daily: stats.daily, tint: Theme.apricot,
                    value: { Double($0.calls) }, valueLabel: { "\(Int($0))" }
                )
                .id("ai-charts")
                if stats.pricesConfigured {
                    AiDailyChart(
                        title: "Estimated cost per day", daily: stats.daily, tint: Theme.terracotta,
                        value: { $0.estimatedCost ?? 0 }, valueLabel: { AiUsage.cost($0) }
                    )
                }
            }
            .listRowBackground(Theme.raised)
            AiMetricsSection(header: "By feature", rows: stats.byFeature.map { feature in
                (id: feature.id, name: Self.featureName(feature.feature), metrics: feature.metrics)
            })
            AiMetricsSection(header: "By trigger", rows: stats.byTrigger.map { trigger in
                (id: trigger.id, name: Text(AiTrigger.title(trigger.trigger)), metrics: trigger.metrics)
            })
            AiMetricsSection(header: "By model", rows: stats.byModel.map { model in
                (id: model.id, name: Text(verbatim: model.model), metrics: model.metrics)
            })
        }
        Section {
            grabTiles
                .id("ai-grabs")
                .listRowInsets(EdgeInsets())
                .listRowBackground(Color.clear)
        } header: {
            Text("Grab outcomes: AI picks vs classic scoring")
        }
    }

    private static func featureName(_ raw: String) -> Text {
        if let feature = AiFeature(rawValue: raw) {
            return Text(feature.title)
        }
        return Text(verbatim: raw)
    }

    private var tiles: some View {
        let changed = AiUsage.changedShare(agreementRate: totals.agreementRate)
        return LazyVGrid(columns: AiTile.columns, spacing: 10) {
            AiTile(
                label: "Calls", value: "\(totals.calls)",
                hint: "\(totals.invalidPick) invalid pick, \(totals.rateLimited) rate limited, \(totals.error) failed"
            )
            AiTile(label: "Success rate", value: AiUsage.percent(totals.successRate))
            AiTile(
                label: "Tokens in / out",
                value: "\(AiUsage.tokens(totals.inputTokens)) / \(AiUsage.tokens(totals.outputTokens))"
            )
            if stats.pricesConfigured {
                AiTile(label: "Estimated cost", value: AiUsage.cost(totals.estimatedCost))
            } else {
                AiTile(label: "Estimated cost", value: AiUsage.dash, hint: "Set prices to estimate cost")
            }
            AiTile(
                label: "AI changed the pick",
                value: changed.map(AiUsage.percent) ?? AiUsage.dash,
                hint: changed == nil
                    ? "No comparison yet"
                    : "vs classic scoring, over \(totals.agreementChecked) calls"
            )
            AiTile(
                label: "Skipped by budget", value: "\(totals.budgetSkipped)",
                hint: "Calls not made because the budget was spent"
            )
            AiTile(label: "Median latency", value: AiUsage.milliseconds(totals.p50DurationMs))
            AiTile(label: "p95 latency", value: AiUsage.milliseconds(totals.p95DurationMs))
        }
        .padding(.vertical, 2)
    }

    private var grabTiles: some View {
        LazyVGrid(columns: AiTile.columns, spacing: 10) {
            grabTile("AI-picked grabs", stats.grabs.ai)
            grabTile("Classic grabs", stats.grabs.classic)
        }
        .padding(.vertical, 2)
    }

    private func grabTile(_ label: LocalizedStringKey, _ outcome: AiGrabOutcome) -> some View {
        let rate = AiUsage.failureRate(completed: outcome.completed, failed: outcome.failed)
        return AiTile(
            label: label,
            value: rate.map(AiUsage.percent) ?? AiUsage.dash,
            valueSuffix: "failed",
            hint: "\(outcome.total) grabs: \(outcome.completed) completed, \(outcome.failed) failed, \(outcome.active) in progress"
        )
    }
}

/// A rounded stat card: small caption label, a strong value and a quiet hint.
struct AiTile: View {
    static let columns = [GridItem(.flexible(), spacing: 10), GridItem(.flexible(), spacing: 10)]

    let label: LocalizedStringKey
    let value: String
    var valueSuffix: LocalizedStringKey?
    var hint: LocalizedStringKey?

    var body: some View {
        VStack(alignment: .leading, spacing: 3) {
            Text(label)
                .font(.caption.weight(.semibold))
                .foregroundStyle(Theme.muted)
                .lineLimit(2)
            HStack(alignment: .firstTextBaseline, spacing: 4) {
                Text(verbatim: value)
                    .font(.title3.weight(.semibold))
                    .foregroundStyle(Theme.textStrong)
                    .lineLimit(1)
                    .minimumScaleFactor(0.7)
                if let valueSuffix {
                    Text(valueSuffix).font(.caption).foregroundStyle(Theme.muted)
                }
            }
            if let hint {
                Text(hint)
                    .font(.caption2)
                    .foregroundStyle(Theme.faint)
                    .fixedSize(horizontal: false, vertical: true)
            }
            Spacer(minLength: 0)
        }
        .frame(maxWidth: .infinity, minHeight: 64, alignment: .topLeading)
        .padding(12)
        .background(Theme.raised, in: RoundedRectangle(cornerRadius: 14))
        .overlay(RoundedRectangle(cornerRadius: 14).strokeBorder(Theme.border, lineWidth: 1))
    }
}

/// Today's spend against the daily budget, with a progress bar and the
/// "budget reached" state.
struct AiTodayCard: View {
    let spend: Double?
    let budget: Double?
    let pricesConfigured: Bool

    private var reached: Bool {
        AiUsage.budgetReached(spend: spend, budget: budget, pricesConfigured: pricesConfigured)
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text("Today").font(.caption.weight(.semibold)).foregroundStyle(Theme.muted)
            HStack(alignment: .firstTextBaseline, spacing: 8) {
                Text(verbatim: pricesConfigured ? AiUsage.cost(spend) : AiUsage.dash)
                    .font(.title2.weight(.semibold))
                    .foregroundStyle(Theme.textStrong)
                if let budget {
                    Text("of \(AiUsage.cost(budget)) daily budget")
                        .font(.footnote)
                        .foregroundStyle(Theme.muted)
                }
            }
            if let budget, pricesConfigured {
                ProgressView(value: AiUsage.budgetRatio(spend: spend, budget: budget))
                    .tint(reached ? Theme.terracotta : Theme.apricot)
                    .accessibilityLabel("Today")
            } else {
                Text(pricesConfigured ? "No daily budget set" : "Set prices to estimate cost")
                    .font(.caption)
                    .foregroundStyle(Theme.faint)
            }
            if reached {
                Text("Budget reached \u{2014} using classic picks")
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(Theme.apricot)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(14)
        .background(Theme.raised, in: RoundedRectangle(cornerRadius: 14))
        .overlay(RoundedRectangle(cornerRadius: 14).strokeBorder(Theme.border, lineWidth: 1))
    }
}

/// One bar-per-day chart, scaled to the real maximum so a quiet week is not stretched.
struct AiDailyChart: View {
    let title: LocalizedStringKey
    let daily: [AiDailyStats]
    let tint: Color
    let value: (AiDailyStats) -> Double
    let valueLabel: (Double) -> String

    private static let dayParser: DateFormatter = {
        let formatter = DateFormatter()
        formatter.calendar = Calendar(identifier: .gregorian)
        formatter.locale = Locale(identifier: "en_US_POSIX")
        // The API's days are calendar days; anchor them in the local zone so the chart bins them on the same day.
        formatter.timeZone = .current
        formatter.dateFormat = "yyyy-MM-dd"
        return formatter
    }()

    private var points: [(day: Date, value: Double)] {
        daily.compactMap { entry in
            Self.dayParser.date(from: entry.date).map { ($0, value(entry)) }
        }
    }

    var body: some View {
        let points = points
        let top = AiUsage.chartMax(points.map(\.value))
        VStack(alignment: .leading, spacing: 6) {
            HStack {
                Text(title).font(.caption.weight(.semibold)).foregroundStyle(Theme.muted)
                Spacer()
                Text("max \(valueLabel(top))").font(.caption2).foregroundStyle(Theme.faint)
            }
            Chart {
                ForEach(points, id: \.day) { point in
                    BarMark(x: .value("Day", point.day, unit: .day), y: .value("Value", point.value))
                        .foregroundStyle(tint)
                }
            }
            .chartYScale(domain: 0 ... top)
            .chartYAxis {
                AxisMarks(position: .leading, values: [0, top]) { value in
                    AxisGridLine().foregroundStyle(Theme.border)
                    AxisValueLabel {
                        if let number = value.as(Double.self) {
                            Text(verbatim: valueLabel(number))
                        }
                    }
                    .foregroundStyle(Theme.faint)
                }
            }
            .chartXAxis {
                AxisMarks(values: .automatic(desiredCount: 4)) { _ in
                    AxisValueLabel(format: .dateTime.month(.abbreviated).day()).foregroundStyle(Theme.faint)
                }
            }
            .frame(height: 110)
        }
        .padding(.vertical, 4)
        .accessibilityElement(children: .combine)
    }
}

/// Compact list: name plus calls, success rate and cost on one quiet line.
struct AiMetricsSection: View {
    let header: LocalizedStringKey
    let rows: [(id: String, name: Text, metrics: AiUsageMetrics)]

    var body: some View {
        Section {
            ForEach(rows, id: \.id) { row in
                VStack(alignment: .leading, spacing: 3) {
                    row.name
                        .font(.subheadline.weight(.semibold))
                        .foregroundStyle(Theme.textStrong)
                    Text("\(row.metrics.calls) calls \u{00B7} \(AiUsage.percent(row.metrics.successRate)) success \u{00B7} \(AiUsage.cost(row.metrics.estimatedCost))")
                        .font(.caption)
                        .foregroundStyle(Theme.muted)
                }
            }
        } header: {
            Text(header)
        }
        .listRowBackground(Theme.raised)
    }
}

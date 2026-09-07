import RawkoonKit
import SwiftUI

struct ListeningStatsView: View {
    let stats: ListeningStats

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 26) {
                ListeningStatsFigures(stats: stats)

                weekChart

                seriesSection
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 12)
            .padding(.bottom, 96)
        }
        .background(Theme.base)
        .navigationTitle("Listening")
        .navigationBarTitleDisplayMode(.inline)
    }

    private var weekChart: some View {
        let maxSeconds = weekBarMaxSeconds(stats.week)
        let allZero = stats.week.allSatisfy { $0.seconds == 0 }
        return VStack(alignment: .leading, spacing: 12) {
            Text("This week")
                .font(.display(16))
                .foregroundStyle(Theme.textStrong)
            if allZero {
                Text("No listening yet this week.")
                    .font(.subheadline)
                    .foregroundStyle(Theme.muted)
            } else {
                HStack(alignment: .bottom, spacing: 8) {
                    ForEach(stats.week) { entry in
                        weekBar(entry, maxSeconds: maxSeconds)
                    }
                }
                .frame(height: 128, alignment: .bottom)
            }
        }
    }

    private func weekBar(_ entry: ListeningWeekDay, maxSeconds: Double) -> some View {
        let hoursLabel = Formatters.listeningHours(entry.seconds)
        let weekday = weekdayLabel(entry.day)
        let barHeight = entry.seconds == 0 ? 0 : entry.seconds / maxSeconds
        return VStack(spacing: 8) {
            GeometryReader { geo in
                VStack {
                    Spacer(minLength: 0)
                    RoundedRectangle(cornerRadius: 4, style: .continuous)
                        .fill(Theme.seed.opacity(0.8))
                        .frame(height: max(0, geo.size.height * barHeight))
                }
            }
            Text(weekday)
                .font(.system(size: 10))
                .foregroundStyle(Theme.faint)
                .lineLimit(1)
                .minimumScaleFactor(0.8)
        }
        .frame(maxWidth: .infinity)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("\(weekday) \(hoursLabel)")
    }

    private var seriesSection: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Series")
                .font(.display(16))
                .foregroundStyle(Theme.textStrong)
            if stats.series.isEmpty {
                Text("No series in the library yet.")
                    .font(.subheadline)
                    .foregroundStyle(Theme.muted)
            } else {
                VStack(spacing: 0) {
                    ForEach(stats.series) { entry in
                        seriesRow(entry)
                        if entry.id != stats.series.last?.id {
                            Divider().overlay(Theme.border)
                        }
                    }
                }
                .padding(.horizontal, 16)
                .padding(.vertical, 4)
                .background(Theme.raised, in: RoundedRectangle(cornerRadius: 16))
                .overlay(RoundedRectangle(cornerRadius: 16).strokeBorder(Theme.border, lineWidth: 1))
            }
        }
    }

    private func seriesRow(_ entry: ListeningSeriesStat) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack(alignment: .firstTextBaseline) {
                Text(entry.name)
                    .font(.subheadline.weight(.medium))
                    .foregroundStyle(Theme.text)
                    .lineLimit(1)
                Spacer(minLength: 8)
                Text("\(entry.percent)%")
                    .font(.system(.subheadline, design: .monospaced))
                    .foregroundStyle(Theme.muted)
            }
            Text(String(localized: "\(entry.booksFinished) of \(entry.booksTotal)"))
                .font(.caption2)
                .foregroundStyle(Theme.faint)
            if let currentTitle = entry.currentTitle {
                Text(currentTitle)
                    .font(.subheadline)
                    .foregroundStyle(Theme.muted)
                    .lineLimit(1)
            }
        }
        .padding(.vertical, 12)
    }
}

struct ListeningStatsFigures: View {
    let stats: ListeningStats

    var body: some View {
        HStack(alignment: .top, spacing: 16) {
            figure(
                value: "\(stats.streakDays)",
                label: String(localized: "\(stats.streakDays) day streak"),
                monospaced: false
            )
            figure(
                value: Formatters.listeningHours(stats.weekSecs),
                label: String(localized: "This week"),
                monospaced: true
            )
        }
    }

    private func figure(value: String, label: String, monospaced: Bool) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(value)
                .font(monospaced ? .system(.title2, design: .monospaced).weight(.semibold) : .display(24))
                .foregroundStyle(Theme.textStrong)
            Text(label)
                .font(.caption)
                .foregroundStyle(Theme.faint)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

private func weekBarMaxSeconds(_ week: [ListeningWeekDay]) -> Double {
    max(week.map(\.seconds).max() ?? 0, 1)
}

private func weekdayLabel(_ ymd: String) -> String {
    let parts = ymd.split(separator: "-").compactMap { Int($0) }
    guard parts.count == 3 else { return ymd }
    var calendar = Calendar(identifier: .gregorian)
    calendar.timeZone = TimeZone(secondsFromGMT: 0) ?? .gmt
    var components = DateComponents()
    components.year = parts[0]
    components.month = parts[1]
    components.day = parts[2]
    guard let date = calendar.date(from: components) else { return ymd }
    let formatter = DateFormatter()
    formatter.calendar = calendar
    formatter.timeZone = calendar.timeZone
    formatter.locale = Locale.current
    formatter.dateFormat = "EEE"
    return formatter.string(from: date)
}

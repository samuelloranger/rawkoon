import RawkoonKit
import SwiftUI

/// Movies & Shows header: this month's growth on one line, expanding into the full card.
/// Loads its own data; shows nothing until there is something to say.
struct LibraryGrowthStrip: View {
    @Environment(AppModel.self) private var model

    var body: some View {
        // A container, not a bare `if`: an empty conditional never runs the task that fills it.
        VStack(spacing: 0) {
            if let growth = model.libraryGrowth {
                if !growth.isEmpty || model.isAdmin {
                    LibraryGrowthStripBody(
                        growth: growth, isAdmin: model.isAdmin, showBooks: model.session.booksEnabled
                    )
                }
            } else if !model.libraryGrowthFailed {
                // Holds the strip's height so the search field doesn't jump when the first load lands.
                RoundedRectangle(cornerRadius: 12)
                    .strokeBorder(Theme.border.opacity(0.5), lineWidth: 1)
                    .frame(height: LibraryGrowthStripBody.rowHeight)
                    .accessibilityHidden(true)
            }
        }
        .task { await model.refreshLibraryGrowth() }
    }
}

private struct LibraryGrowthStripBody: View {
    @Environment(AppModel.self) private var model
    static let rowHeight: CGFloat = 38
    let growth: LibraryGrowth
    let isAdmin: Bool
    let showBooks: Bool
    @State private var libraryStats: LibraryStats?
    @State private var expanded: Bool = {
        #if DEBUG
            ProcessInfo.processInfo.environment["RAWKOON_GROWTH_OPEN"] != nil
        #else
            false
        #endif
    }()

    private var headline: String {
        isAdmin
            ? LibraryGrowthCard.bytes(growth.month.bytes ?? 0)
            : String(localized: "\(growth.month.titles) titles")
    }

    private var peak: Int {
        max(growth.weeks.map { $0.metric(admin: isAdmin) }.max() ?? 0, 1)
    }

    var body: some View {
        VStack(spacing: 8) {
            Button {
                withRawkoonMotion(RawkoonMotion.spring) { expanded.toggle() }
            } label: {
                HStack(spacing: 10) {
                    Image(systemName: "chart.bar").font(.caption).foregroundStyle(Theme.apricot)
                    Text(headline)
                        .font(.subheadline.weight(.semibold)).foregroundStyle(Theme.textStrong)
                        .rawkoonNumeric(Double(growth.month.metric(admin: isAdmin)))
                    Text("this month").font(.caption).foregroundStyle(Theme.muted)
                    Spacer(minLength: 8)
                    sparkline
                    Image(systemName: "chevron.down")
                        .font(.system(size: 10, weight: .bold)).foregroundStyle(Theme.faint)
                        .rotationEffect(.degrees(expanded ? 180 : 0))
                }
                .padding(.horizontal, 12)
                .frame(height: Self.rowHeight)
                .background(Theme.raised, in: RoundedRectangle(cornerRadius: 12))
                .overlay(RoundedRectangle(cornerRadius: 12).strokeBorder(Theme.border, lineWidth: 1))
                .contentShape(Rectangle())
            }
            .buttonStyle(.rawkoonPressable(scale: 0.99))
            .accessibilityLabel(Text("Library growth, \(headline) this month"))
            .accessibilityValue(Text(expanded ? "Expanded" : "Collapsed"))

            if expanded {
                LibraryGrowthCard(growth: growth, isAdmin: isAdmin, showBooks: showBooks)
                    .transition(.rawkoonSwap)
                if isAdmin, let libraryStats {
                    LibraryStatsCard(stats: libraryStats)
                        .transition(.rawkoonSwap)
                }
            }
        }
        .task(id: expanded) {
            guard expanded, isAdmin, let client = model.api() else { return }
            if libraryStats == nil {
                libraryStats = client.cachedLibraryStats()
            }
            if let fresh = try? await client.libraryStats() {
                libraryStats = fresh
            }
        }
    }

    private var sparkline: some View {
        HStack(alignment: .bottom, spacing: 2.5) {
            ForEach(Array(growth.weeks.enumerated()), id: \.offset) { index, week in
                let fraction = CGFloat(week.metric(admin: isAdmin)) / CGFloat(peak)
                let isCurrent = index == growth.weeks.count - 1
                RoundedRectangle(cornerRadius: 1.5)
                    .fill(Theme.apricot.opacity(isCurrent ? 0.45 : 0.85))
                    .frame(width: 3.5, height: max(18 * fraction, 2))
            }
        }
        .frame(height: 18, alignment: .bottom)
        .accessibilityHidden(true)
    }
}

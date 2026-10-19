import RawkoonKit
import SwiftUI

/// The upcoming calendar: day sections and release rows.
extension ActivityView {
    // MARK: Calendar

    var calendarContent: some View {
        // A container, not a bare conditional, so the lane slide and the state swaps never share one transition.
        ZStack(alignment: .top) {
            if loadingCalendar, upcomingItems.isEmpty {
                ProgressView().tint(Theme.apricot)
                    .frame(maxWidth: .infinity, minHeight: 420)
                    .transition(.rawkoonSwap)
            } else if let calendarError, upcomingItems.isEmpty {
                errorView(calendarError)
                    .transition(.rawkoonSwap)
            } else if upcomingItems.isEmpty {
                ContentUnavailableView(
                    "Nothing upcoming",
                    systemImage: "calendar",
                    description: Text("No known releases on the horizon.")
                )
                .rawkoonLivingSymbol(.empty)
                .frame(maxWidth: .infinity, minHeight: 420)
                .transition(.rawkoonSwap)
            } else {
                LazyVStack(spacing: 8, pinnedViews: .sectionHeaders) {
                    ForEach(UpcomingCalendar.sections(upcomingItems, isoDay: \.releaseDate)) { section in
                        Section {
                            ForEach(section.items) { item in
                                calendarRow(item)
                                    .rawkoonEntrance(id: item.id)
                            }
                        } header: {
                            calendarDayHeader(section.isoDay)
                        }
                    }
                }
                .padding(.horizontal, 16)
                .padding(.bottom, 16)
                .rawkoonEntranceScope()
                .transition(.rawkoonSwap)
            }
        }
        .rawkoonMotion(
            calendarInitialLoadResolved ? RawkoonMotion.spring : nil,
            value: Self.laneState(
                loading: loadingCalendar, failed: calendarError != nil, isEmpty: upcomingItems.isEmpty
            )
        )
        .onChange(of: Self.laneState(
            loading: loadingCalendar, failed: calendarError != nil, isEmpty: upcomingItems.isEmpty
        )) { _, current in
            if current != .loading {
                calendarInitialLoadResolved = true
            }
        }
    }

    private func calendarRow(_ item: UpcomingItem) -> some View {
        // Per row, since a show lists one row per upcoming episode day.
        let zoomID: RawkoonZoom.ID = "upcoming:\(item.id)"
        return NavigationLink {
            MediaDetailView(tmdbId: item.tmdbId ?? 0, mediaType: item.mediaType,
                            title: item.title, posterPath: item.posterUrl, libraryId: item.libraryId)
                .rawkoonZoomDestination(zoomID)
        } label: {
            calendarRowLabel(item)
                .rawkoonZoomSource(zoomID)
        }
        .buttonStyle(.rawkoonPressable)
        .disabled(item.tmdbId == nil && item.libraryId == nil)
    }

    private func calendarDayHeader(_ isoDay: String?) -> some View {
        let day = UpcomingCalendar.day(isoDay)
        return HStack(alignment: .firstTextBaseline, spacing: 8) {
            switch day?.relative {
            case .today: Text("Today")
            case .tomorrow: Text("Tomorrow")
            case .other: Text(verbatim: day.map { UpcomingCalendar.weekday($0.date) } ?? "")
            case nil: Text("Date to be announced")
            }
            if let day {
                Text(verbatim: UpcomingCalendar.monthDay(day.date))
                    .font(.subheadline)
                    .foregroundStyle(Theme.faint)
            }
            Spacer(minLength: 0)
        }
        .font(.headline)
        .foregroundStyle(Theme.textStrong)
        .padding(.top, 16)
        .padding(.bottom, 4)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Theme.base)
        .accessibilityElement(children: .combine)
        .accessibilityAddTraits(.isHeader)
    }

    private func calendarRowLabel(_ item: UpcomingItem) -> some View {
        HStack(alignment: .top, spacing: 12) {
            MediaThumb(url: model.absoluteURL(item.posterUrl), width: 56)

            VStack(alignment: .leading, spacing: 6) {
                Text(item.title)
                    .font(.display(15))
                    .foregroundStyle(Theme.textStrong)
                    .lineLimit(2)
                    .multilineTextAlignment(.leading)
                calendarFacts(item)
                if let overview = item.overview, !overview.isEmpty {
                    Text(overview)
                        .font(.caption)
                        .foregroundStyle(Theme.muted)
                        .lineLimit(2)
                        .multilineTextAlignment(.leading)
                }
                if let providers = item.providers, !providers.isEmpty {
                    calendarProviders(providers)
                }
            }
            Spacer(minLength: 0)
        }
        .padding(12)
        .activityCard(cornerRadius: 12)
    }

    /// One quiet line: kind, episodes, score, and whether the title is already in the library.
    private func calendarFacts(_ item: UpcomingItem) -> some View {
        HStack(spacing: 6) {
            if item.mediaType == "tv" {
                Text("Show")
            } else {
                Text("Movie")
            }
            if let episode = item.episodeLabel {
                dot
                Text(verbatim: episode).monospacedDigit()
            } else if let count = item.episodeCount, count > 1 {
                dot
                Text("\(count) episodes")
            }
            if let vote = item.voteAverage, vote > 0 {
                dot
                Text((vote / 10).formatted(.percent.precision(.fractionLength(0)))).monospacedDigit()
            }
            if item.libraryId != nil {
                dot
                Text("In library").foregroundStyle(Theme.seed)
            }
        }
        .font(.caption)
        .foregroundStyle(Theme.faint)
        .lineLimit(1)
    }

    private var dot: some View {
        Text(verbatim: "·").accessibilityHidden(true)
    }

    private func calendarProviders(_ providers: [UpcomingProvider]) -> some View {
        HStack(spacing: 4) {
            ForEach(providers.prefix(5)) { provider in
                CachedAsyncImage(
                    url: URL(string: provider.logoUrl), targetSize: CGSize(width: 20, height: 20)
                ) { image in
                    image.resizable().scaledToFit()
                } placeholder: {
                    Theme.well
                }
                .frame(width: 20, height: 20)
                .clipShape(RoundedRectangle(cornerRadius: 4))
                .accessibilityLabel(Text(verbatim: provider.name))
            }
        }
    }

    func loadCalendar() async {
        loadingCalendar = true
        calendarError = nil
        defer { loadingCalendar = false }

        guard let client = model.api() else {
            calendarError = String(localized: "Not signed in.")
            return
        }

        do {
            let response = try await client.upcoming()
            upcomingItems = response.items
        } catch let error as APIError {
            calendarError = message(for: error)
        } catch {
            calendarError = String(localized: "Can't reach the server. Try again in a moment.")
        }
    }
}

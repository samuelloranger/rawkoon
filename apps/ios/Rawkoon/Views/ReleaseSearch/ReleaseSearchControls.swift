import RawkoonKit
import SwiftUI

struct ReleaseSearchControls: View {
    @Environment(AppModel.self) private var model
    @Bindable var session: ReleaseSearchSession
    @Bindable var filters: ReleaseSearchFilters

    var body: some View {
        VStack(spacing: 10) {
            HStack(spacing: 8) {
                searchField("Search releases", text: $session.searchQuery, onSubmit: {
                    Task { await session.search(model: model) }
                })

                if session.titleOptions.count > 1 {
                    titleLanguageMenu
                }

                Button {
                    Task { await session.search(model: model) }
                } label: {
                    if session.isLoading {
                        ProgressView()
                            .tint(Theme.onAccent)
                            .frame(width: 18, height: 18)
                    } else {
                        Image(systemName: "arrow.clockwise")
                            .font(.system(size: 13, weight: .semibold))
                    }
                }
                .accessibilityLabel("Search")
                .buttonStyle(.borderedProminent)
                .tint(Theme.terracotta)
                .disabled(session.isLoading)
                .requiresConnection(model.isOffline)
            }

            HStack(spacing: 8) {
                searchField("Filter loaded releases", text: $filters.filterQuery)
                filterMenu(
                    title: filters.sortBy.title,
                    systemImage: filters.sortAscending ? "arrow.up" : "arrow.down"
                ) {
                    ForEach(sortOptions) { option in
                        Button(option.title) { filters.sortBy = option }
                    }
                    Divider()
                    Button(LocalizedStringKey(filters.sortAscending ? "Descending" : "Ascending")) {
                        filters.sortAscending.toggle()
                    }
                }
            }

            HStack(spacing: 12) {
                Toggle("Hide rejected", isOn: $filters.hideRejected)
                if session.mediaType == "tv" {
                    Toggle("Packs only", isOn: $filters.showPacksOnly)
                }
                Spacer()
            }
            .font(.footnote)
            .tint(Theme.terracotta)

            filterRow

            if session.mediaType == "tv", !session.availableSeasons.isEmpty {
                seasonRow
            }
        }
        .padding(.horizontal, 16)
        .padding(.bottom, 10)
    }

    @ViewBuilder
    private var filterRow: some View {
        if !trackerOptions.isEmpty || !languageOptions.isEmpty {
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 8) {
                    if !trackerOptions.isEmpty {
                        filterChipMenu(title: "Include trackers", activeCount: filters.includedTrackers.count) {
                            ForEach(trackerOptions) { option in
                                Toggle(option.label, isOn: includedTrackerBinding(option.key))
                            }
                        }
                        filterChipMenu(title: "Exclude trackers", activeCount: filters.excludedTrackers.count) {
                            ForEach(trackerOptions) { option in
                                Toggle(option.label, isOn: excludedTrackerBinding(option.key))
                            }
                        }
                    }
                    if !languageOptions.isEmpty {
                        filterChipMenu(title: "Languages", activeCount: filters.includedLanguages.count) {
                            ForEach(languageOptions) { option in
                                Toggle(option.label, isOn: includedLanguageBinding(option.key))
                            }
                        }
                    }
                    if filters.hasActiveFilters {
                        Button {
                            filters.includedTrackers.removeAll()
                            filters.excludedTrackers.removeAll()
                            filters.includedLanguages.removeAll()
                        } label: {
                            Text("Clear")
                                .font(.subheadline.weight(.medium))
                                .foregroundStyle(Theme.muted)
                                .padding(.horizontal, 12)
                                .padding(.vertical, 10)
                                .background(Theme.raised, in: Capsule())
                                .overlay(Capsule().strokeBorder(Theme.border, lineWidth: 1))
                        }
                        .buttonStyle(.plain)
                        .fixedSize()
                        .transition(.rawkoonSwap)
                    }
                }
                .rawkoonMotion(RawkoonMotion.snappy, value: filters.hasActiveFilters)
            }
        }
    }

    private func filterChipMenu(
        title: LocalizedStringKey,
        activeCount: Int,
        @ViewBuilder content: () -> some View
    ) -> some View {
        Menu {
            content()
        } label: {
            HStack(spacing: 5) {
                Text(title).font(.subheadline.weight(.medium))
                if activeCount > 0 {
                    Text("\(activeCount)")
                        .font(.system(.caption2, design: .monospaced).weight(.semibold))
                        .rawkoonNumeric(Double(activeCount))
                        .foregroundStyle(Theme.onAccent)
                        .padding(.horizontal, 6)
                        .padding(.vertical, 1)
                        .background(Theme.terracotta, in: Capsule())
                        .transition(.rawkoonSwap)
                }
                Image(systemName: "chevron.down").font(.system(size: 9, weight: .bold))
            }
            .foregroundStyle(activeCount > 0 ? Theme.textStrong : Theme.muted)
            .padding(.horizontal, 12)
            .padding(.vertical, 10)
            .background(activeCount > 0 ? Theme.apricot.opacity(0.12) : Theme.raised, in: Capsule())
            .overlay(
                Capsule().strokeBorder(activeCount > 0 ? Theme.apricotSoft : Theme.borderStrong, lineWidth: 1)
            )
            .rawkoonMotion(RawkoonMotion.snappy, value: activeCount)
        }
        .fixedSize()
    }

    private func includedTrackerBinding(_ key: String) -> Binding<Bool> {
        Binding(
            get: {
                filters.includedTrackers.contains(key)
            },
            set: { isOn in
                if isOn {
                    filters.includedTrackers.insert(key)
                    filters.excludedTrackers.remove(key)
                } else {
                    filters.includedTrackers.remove(key)
                }
            }
        )
    }

    private func excludedTrackerBinding(_ key: String) -> Binding<Bool> {
        Binding(
            get: {
                filters.excludedTrackers.contains(key)
            },
            set: { isOn in
                if isOn {
                    filters.excludedTrackers.insert(key)
                    filters.includedTrackers.remove(key)
                } else {
                    filters.excludedTrackers.remove(key)
                }
            }
        )
    }

    private func includedLanguageBinding(_ key: String) -> Binding<Bool> {
        Binding(
            get: {
                filters.includedLanguages.contains(key)
            },
            set: { isOn in
                if isOn {
                    filters.includedLanguages.insert(key)
                } else {
                    filters.includedLanguages.remove(key)
                }
            }
        )
    }

    private var seasonRow: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 8) {
                seasonButton(title: "All", selected: session.selectedSeason == nil && !session.completeSeries) {
                    session.selectedSeason = nil
                    session.completeSeries = false
                }
                ForEach(session.availableSeasons, id: \.self) { season in
                    seasonButton(
                        title: "S\(String(format: "%02d", season))",
                        selected: session.selectedSeason == season
                    ) {
                        session.completeSeries = false
                        session.selectedSeason = (session.selectedSeason == season) ? nil : season
                    }
                }
                seasonButton(title: "Complete", selected: session.completeSeries, accent: Theme.apricotSoft) {
                    session.completeSeries.toggle()
                }
            }
        }
    }

    private func seasonButton(
        title: String,
        selected: Bool,
        accent: Color = Theme.terracotta,
        action: @escaping () -> Void
    ) -> some View {
        Button(title) {
            action()
        }
        .buttonStyle(.plain)
        .padding(.horizontal, 10)
        .padding(.vertical, 6)
        .background(selected ? accent.opacity(0.25) : Theme.raised, in: Capsule())
        .overlay(Capsule().strokeBorder(selected ? accent : Theme.border, lineWidth: 1))
        .foregroundStyle(selected ? Theme.textStrong : Theme.muted)
        .font(.system(.caption, design: .monospaced))
        .rawkoonMotion(RawkoonMotion.snappy, value: selected)
    }

    private var trackerOptions: [InteractiveSearchLogic.FilterOption] {
        filters.trackerOptions(for: session.releases)
    }

    private var languageOptions: [InteractiveSearchLogic.FilterOption] {
        filters.languageOptions(for: session.releases)
    }

    private var sortOptions: [ReleaseSearchSort] {
        filters.sortOptions(for: session.releases)
    }

    private var titleLanguageMenu: some View {
        let current = session.titleOptions.first { $0.query == session.searchQuery }
        let code = (current?.languageCode ?? "en").uppercased()
        return Menu {
            ForEach(session.titleOptions) { option in
                Button {
                    session.searchQuery = option.query
                    Task { await session.search(model: model) }
                } label: {
                    if option.isOriginal {
                        Label("\(option.languageCode.uppercased()) · \(option.query) (original)", systemImage: "globe")
                    } else {
                        Text("\(option.languageCode.uppercased()) · \(option.query)")
                    }
                }
            }
        } label: {
            HStack(spacing: 5) {
                Image(systemName: "globe").font(.caption2)
                Text(code).font(.subheadline.weight(.medium))
                Image(systemName: "chevron.down").font(.system(size: 9, weight: .bold))
            }
            .foregroundStyle(Theme.textStrong)
            .padding(.horizontal, 12).padding(.vertical, 10)
            .background(Theme.raised, in: Capsule())
            .overlay(Capsule().strokeBorder(Theme.borderStrong, lineWidth: 1))
        }
    }

    private func filterMenu(
        title: LocalizedStringKey,
        systemImage: String,
        @ViewBuilder content: () -> some View
    ) -> some View {
        Menu {
            content()
        } label: {
            HStack(spacing: 5) {
                Image(systemName: systemImage).font(.caption2)
                Text(title).font(.subheadline.weight(.medium))
                Image(systemName: "chevron.down").font(.system(size: 9, weight: .bold))
            }
            .foregroundStyle(Theme.textStrong)
            .padding(.horizontal, 12).padding(.vertical, 10)
            .background(Theme.raised, in: Capsule())
            .overlay(Capsule().strokeBorder(Theme.borderStrong, lineWidth: 1))
        }
    }

    private func searchField(_ placeholder: String, text: Binding<String>, onSubmit: (() -> Void)? = nil) -> some View {
        HStack(spacing: 8) {
            Image(systemName: "magnifyingglass")
                .font(.caption)
                .foregroundStyle(Theme.muted)
            TextField(placeholder, text: text)
                .foregroundStyle(Theme.textStrong)
                .autocorrectionDisabled()
                .textInputAutocapitalization(.never)
                .onSubmit {
                    onSubmit?()
                }
            if !text.wrappedValue.isEmpty {
                Button {
                    text.wrappedValue = ""
                } label: {
                    Image(systemName: "xmark.circle.fill")
                        .foregroundStyle(Theme.faint)
                        // A 44pt hit area without growing the field.
                        .padding(12)
                        .contentShape(Rectangle())
                        .padding(-12)
                }
                .buttonStyle(.plain)
                .accessibilityLabel("Clear")
            }
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 10)
        .background(Theme.inset, in: RoundedRectangle(cornerRadius: 12))
        .overlay(RoundedRectangle(cornerRadius: 12).strokeBorder(Theme.border, lineWidth: 1))
    }
}

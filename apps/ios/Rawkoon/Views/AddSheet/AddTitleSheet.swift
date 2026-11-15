import RawkoonKit
import SwiftUI

/// The sheet behind every interactive add and request: quality, seasons, search-now for a title,
/// format and profile for a book. It only chooses; the caller performs the add with the answer.
struct AddTitleSheet: View {
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss

    let request: AddSheetRequest

    @State private var profileId: Int?
    @State private var draft: SeasonDraft
    @State private var searchNow: Bool
    @State private var format: BookFormat
    @State private var expanded = false
    @State private var detent: PresentationDetent

    init(request: AddSheetRequest) {
        self.request = request
        _profileId = State(initialValue: request.defaults.profileId)
        _draft = State(initialValue: SeasonDraft(
            mode: request.defaults.seasonMode, picked: request.defaults.picked, monitorNew: request.defaults.monitorNew
        ))
        _searchNow = State(initialValue: request.defaults.searchOnAdd)
        // Both only when the default book profile serves both formats.
        let defaultKind = request.profiles.first { $0.id == request.defaults.profileId }?.kind
        _format = State(initialValue: defaultKind == "both" ? .both : .ebook)
        _detent = State(initialValue: request.compact ? .height(Self.trayHeight) : Self.startDetent)
    }

    private static let trayHeight: CGFloat = 260

    /// The screenshot harness opens at the large detent so the whole form shows.
    private static var startDetent: PresentationDetent {
        #if DEBUG
            if ProcessInfo.processInfo.environment["RAWKOON_ADD_LARGE"] == "1" {
                return .large
            }
        #endif
        return .medium
    }

    private var kind: AddDialogPolicy.Subject {
        request.subject.kind
    }

    private var isRequest: Bool {
        !request.isAdmin
    }

    private var showsCompactTray: Bool {
        request.compact && !expanded
    }

    private var bookProfiles: [AddProfileOption] {
        request.profiles.filter { AddDialogPolicy.bookProfileMatches(profileKind: $0.kind, format: format) }
    }

    private var canConfirm: Bool {
        guard !model.isOffline else { return false }
        return kind != .show || request.seasons.isEmpty || draft.isValid
    }

    var body: some View {
        Group {
            if showsCompactTray {
                compactTray
            } else {
                NavigationStack { form }
            }
        }
        .presentationDetents(showsCompactTray ? [.height(Self.trayHeight)] : [.medium, .large], selection: $detent)
        .presentationDragIndicator(.visible)
        .onAppear {
            // The default book profile may not serve the opening format.
            if kind == .book, !bookProfiles.contains(where: { $0.id == profileId }) {
                profileId = bookProfiles.first?.id
            }
        }
        .presentationBackground(Theme.base)
    }

    // MARK: Full sheet

    private var form: some View {
        Form {
            Section { hero }
                .listRowBackground(Color.clear)
                .listRowInsets(EdgeInsets(top: 4, leading: 0, bottom: 4, trailing: 0))
            if kind == .book {
                bookSections
            } else {
                if request.isAdmin {
                    qualitySection
                }
                if kind == .show {
                    seasonSections
                }
                if request.isAdmin {
                    Section {
                        Toggle("Search now", isOn: $searchNow).tint(Theme.apricot)
                    } footer: {
                        if kind == .show {
                            Text("Change this later from the show's page.")
                        }
                    }
                    .listRowBackground(Theme.raised)
                }
            }
        }
        .scrollContentBackground(.hidden)
        .background(Theme.base)
        .navigationTitle(navTitle)
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .cancellationAction) {
                Button("Cancel") { cancel() }
            }
            if request.isAdmin {
                ToolbarItem(placement: .confirmationAction) {
                    Button("Add") { confirm() }
                        .fontWeight(.semibold)
                        .disabled(!canConfirm)
                }
            }
        }
        .safeAreaInset(edge: .bottom) {
            if isRequest {
                requestButton
            }
        }
    }

    private var navTitle: LocalizedStringKey {
        switch (kind, isRequest) {
        case (.show, false): "Add show"
        case (.show, true): "Request show"
        case (.movie, _): "Add movie"
        case (.book, _): "Add book"
        }
    }

    private var hero: some View {
        HStack(spacing: 12) {
            CachedAsyncImage(
                url: request.subject.imageUrl.flatMap(URL.init(string:)),
                targetSize: CGSize(width: 56, height: 84)
            ) { image in
                image.resizable().scaledToFill()
            } placeholder: {
                Theme.raised
            }
            .frame(width: 56, height: 84)
            .clipShape(RoundedRectangle(cornerRadius: 8))
            VStack(alignment: .leading, spacing: 4) {
                Text(request.subject.title)
                    .font(.display(20))
                    .foregroundStyle(Theme.textStrong)
                    .lineLimit(2)
                Text(metaLine)
                    .font(.footnote)
                    .foregroundStyle(Theme.muted)
            }
            Spacer(minLength: 0)
        }
        .accessibilityElement(children: .combine)
    }

    private var metaLine: String {
        var parts: [String] = []
        if let byline = request.subject.byline {
            parts.append(byline)
        }
        if let year = request.subject.year {
            parts.append(String(year))
        }
        if kind == .show, !request.seasons.isEmpty {
            parts.append(String(localized: "\(SeasonPlan.released(request.seasons).count) seasons"))
            if let announced = SeasonPlan.announced(request.seasons).last {
                parts.append(String(localized: "Season \(announced.number) announced"))
            }
        }
        return parts.joined(separator: " \u{00B7} ")
    }

    private var qualitySection: some View {
        Section {
            Picker("Quality", selection: $profileId) {
                ForEach(request.profiles) { profile in
                    Text(profile.name).tag(Optional(profile.id))
                }
            }
            .tint(Theme.muted)
        }
        .listRowBackground(Theme.raised)
    }

    @ViewBuilder
    private var seasonSections: some View {
        Section("Seasons") {
            SeasonPicker(seasons: request.seasons, mode: $draft.mode, picked: $draft.picked, monitorNew: draft.monitorNew)
        }
        .listRowBackground(Theme.raised)
        Section {
            NewSeasonsToggle(mode: draft.mode, isOn: $draft.monitorNew)
        }
        .listRowBackground(Theme.raised)
    }

    @ViewBuilder
    private var bookSections: some View {
        Section("Format") {
            Picker("Format", selection: $format) {
                Text("Ebook").tag(BookFormat.ebook)
                Text("Audiobook").tag(BookFormat.audiobook)
                Text("Both").tag(BookFormat.both)
            }
            .pickerStyle(.segmented)
            .labelsHidden()
            .onChange(of: format) { _, _ in
                if !bookProfiles.contains(where: { $0.id == profileId }) {
                    profileId = bookProfiles.first?.id
                }
            }
        }
        .listRowBackground(Theme.raised)
        Section {
            Picker("Quality", selection: $profileId) {
                Text("Default").tag(Int?.none)
                ForEach(bookProfiles) { profile in
                    Text(profile.name).tag(Optional(profile.id))
                }
            }
            .tint(Theme.muted)
        }
        .listRowBackground(Theme.raised)
    }

    private var requestButton: some View {
        Button { confirm() } label: {
            Text(requestTitle)
                .fontWeight(.semibold)
                .frame(maxWidth: .infinity, minHeight: 44)
        }
        .buttonStyle(.borderedProminent)
        .tint(Theme.apricot)
        .foregroundStyle(Theme.onAccent)
        .disabled(!canConfirm)
        .padding(.horizontal, 16)
        .padding(.vertical, 8)
    }

    private var requestTitle: LocalizedStringKey {
        switch RequestLabel.resolve(draft.choice) {
        case .everything: "Request"
        case .newEpisodes: "Request new episodes"
        case .latestSeason: "Request latest season"
        case let .season(number): "Request season \(number)"
        case let .seasons(count): "Request \(count) seasons"
        }
    }

    // MARK: Compact tray

    private var compactTray: some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack {
                Text("Add \(request.subject.title)")
                    .font(.display(18))
                    .foregroundStyle(Theme.textStrong)
                    .lineLimit(1)
                Spacer()
                if kind == .show, !request.seasons.isEmpty {
                    Text("\(SeasonPlan.released(request.seasons).count) seasons")
                        .font(.footnote)
                        .foregroundStyle(Theme.muted)
                }
            }
            HStack(spacing: 8) {
                if request.isAdmin {
                    chip(profileName)
                }
                if kind == .show {
                    chip(modeLabel)
                }
            }
            HStack(spacing: 8) {
                Button { cancel() } label: {
                    Text("Skip").frame(maxWidth: .infinity, minHeight: 44)
                }
                .buttonStyle(.bordered)
                .tint(Theme.muted)
                Button { confirm() } label: {
                    Text(isRequest ? "Request" : "Add").fontWeight(.semibold).frame(maxWidth: .infinity, minHeight: 44)
                }
                .buttonStyle(.borderedProminent)
                .tint(Theme.apricot)
                .foregroundStyle(Theme.onAccent)
                .disabled(!canConfirm)
            }
        }
        .padding(20)
        .frame(maxHeight: .infinity, alignment: .top)
    }

    private func chip(_ label: String) -> some View {
        Button {
            expanded = true
            detent = .medium
        } label: {
            HStack(spacing: 6) {
                Text(label).font(.subheadline.weight(.medium)).lineLimit(1)
                Image(systemName: "chevron.down").font(.system(size: 9, weight: .bold))
            }
            .foregroundStyle(Theme.textStrong)
            .padding(.horizontal, 12)
            .frame(minHeight: 36)
            .background(Capsule().fill(Theme.raised))
        }
        .buttonStyle(.plain)
        .accessibilityHint(Text("Opens all the options."))
    }

    private var profileName: String {
        request.profiles.first { $0.id == profileId }?.name ?? String(localized: "Default")
    }

    private var modeLabel: String {
        switch draft.mode {
        case .all: draft.monitorNew ? String(localized: "All seasons + new") : String(localized: "All seasons")
        case .future: String(localized: "New episodes")
        case .latest: String(localized: "Latest season")
        case .pick: String(localized: "\(draft.picked.count) seasons")
        }
    }

    // MARK: Answer

    private func confirm() {
        var choice = AddChoice()
        switch kind {
        case .book:
            choice.bookKinds = format.kinds
            choice.bookProfileId = profileId
        case .movie, .show:
            if request.isAdmin {
                choice.qualityProfileId = profileId
                choice.searchOnAdd = searchNow
            }
            if kind == .show, !request.seasons.isEmpty {
                choice.season = draft.choice
            }
        }
        request.finish(choice)
        dismiss()
    }

    private func cancel() {
        request.finish(nil)
        dismiss()
    }
}

/// Presents the add sheet from the view it is attached to; an app root and a sheet content each host one,
/// and only one is `enabled` at a time, because a view already presenting a sheet cannot present another.
private struct AddSheetHost: ViewModifier {
    @Environment(AppModel.self) private var model
    let enabled: Bool

    func body(content: Content) -> some View {
        content.sheet(item: Binding(
            get: { enabled ? model.addRequest : nil },
            set: { next in
                // A swipe-down dismissal arrives here with nil; the first answer already sent wins.
                if next == nil {
                    model.addRequest?.finish(nil)
                }
            }
        )) { request in
            AddTitleSheet(request: request).environment(model)
        }
    }
}

extension View {
    func addSheetHost(enabled: Bool = true) -> some View {
        modifier(AddSheetHost(enabled: enabled))
    }
}

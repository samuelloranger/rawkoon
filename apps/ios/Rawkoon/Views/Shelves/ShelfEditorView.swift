import RawkoonKit
import SwiftUI

/// One shelf's settings and its titles. Administrators change everything here;
/// a save writes the settings and then the display order.
struct ShelfEditorView: View {
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss

    let detail: ShelfDetail
    var onSaved: (ShelfDetail) -> Void

    @State private var name: String
    @State private var description: String
    @State private var orderMode: ShelfOrderMode
    @State private var homeRow: Bool
    @State private var from: MonthDay?
    @State private var until: MonthDay?
    @State private var coverStyle: String
    @State private var coverEntryId: Int?
    @State private var entries: [ShelfEntry]
    @State private var saving = false
    @State private var addTitlesOpen = false
    /// Adds and removes hit the server at once; this marks that the page behind needs a refetch.
    @State private var wroteTitles = false
    @State private var error: String?

    init(detail: ShelfDetail, onSaved: @escaping (ShelfDetail) -> Void) {
        self.detail = detail
        self.onSaved = onSaved
        _name = State(initialValue: detail.name)
        _description = State(initialValue: detail.description ?? "")
        _orderMode = State(initialValue: detail.orderMode)
        _homeRow = State(initialValue: detail.homeRow)
        _from = State(initialValue: MonthDay(detail.visibleFrom))
        _until = State(initialValue: MonthDay(detail.visibleTo))
        _coverStyle = State(initialValue: detail.cover.style)
        _coverEntryId = State(initialValue: detail.entries.first {
            $0.tmdbId == detail.coverTmdbId && $0.type == (detail.coverType ?? "movie")
        }?.id)
        _entries = State(initialValue: detail.entries)
    }

    private var coverEntry: ShelfEntry? {
        entries.first { $0.id == coverEntryId }
    }

    private var savedCoverEntryId: Int? {
        detail.entries.first {
            $0.tmdbId == detail.coverTmdbId && $0.type == (detail.coverType ?? "movie")
        }?.id
    }

    private var dirty: Bool {
        let changed = [
            name != detail.name,
            description != (detail.description ?? ""),
            orderMode != detail.orderMode,
            homeRow != detail.homeRow,
            from != MonthDay(detail.visibleFrom),
            until != MonthDay(detail.visibleTo),
            coverStyle != detail.cover.style,
            coverEntryId != savedCoverEntryId,
            entries.map(\.id) != detail.entries.map(\.id),
            entries.map(\.groupLabel) != detail.entries.map(\.groupLabel),
        ]
        return changed.contains(true)
    }

    var body: some View {
        NavigationStack {
            Form {
                detailsSection
                orderSection
                windowSection
                coverSection
                titlesSection
            }
            .scrollContentBackground(.hidden)
            .background(Theme.base)
            .navigationTitle("Edit shelf")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                        .disabled(saving)
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button {
                        Task { await save() }
                    } label: {
                        if saving {
                            ProgressView()
                        } else {
                            Text("Save")
                        }
                    }
                    .disabled(saving || !dirty || name.trimmingCharacters(in: .whitespaces).isEmpty)
                    .requiresConnection(model.isOffline)
                }
            }
            .onDisappear { reportTitleWrites() }
            .sheet(isPresented: $addTitlesOpen) {
                AddTitlesSheet(shelfId: detail.id, onShelf: entries) { added in
                    if !entries.contains(where: { $0.id == added.id }) {
                        entries.append(added)
                    }
                    wroteTitles = true
                }
                .environment(model)
            }
            .alert(
                "Couldn't save the shelf",
                isPresented: Binding(get: { error != nil }, set: {
                    if !$0 {
                        error = nil
                    }
                })
            ) {
                Button("OK", role: .cancel) {}
            } message: {
                Text(error ?? "")
            }
        }
    }

    private var detailsSection: some View {
        Section("Shelf") {
            TextField("Name", text: $name)
            TextField("Description", text: $description, axis: .vertical)
                .lineLimit(3 ... 6)
        }
    }

    private var orderSection: some View {
        Section {
            Picker("Order", selection: $orderMode) {
                Text("Manual").tag(ShelfOrderMode.manual)
                Text("Release year").tag(ShelfOrderMode.release)
                Text("Rating").tag(ShelfOrderMode.rating)
                Text("Recently added").tag(ShelfOrderMode.added)
            }
            Toggle("Show as a row on the TV's Home", isOn: $homeRow)
        } footer: {
            Text("At most two shelves appear there.")
        }
    }

    private var windowSection: some View {
        Section {
            MonthDayRow(title: "From", value: $from)
            MonthDayRow(title: "To", value: $until)
            Button("Christmas (Nov 1 – Jan 15)") {
                from = MonthDay(month: 11, day: 1)
                until = MonthDay(month: 1, day: 15)
            }
        } header: {
            Text("Yearly window")
        } footer: {
            Text("Leave both empty to show the shelf all year.")
        }
    }

    private var coverSection: some View {
        Section("Cover") {
            Picker("Cover", selection: $coverStyle) {
                Text("Poster mosaic").tag("mosaic")
                Text("A title's backdrop").tag("backdrop")
                if detail.cover.style == "upload" {
                    Text("Uploaded image").tag("upload")
                }
            }
            if coverStyle == "backdrop" {
                Picker("Title", selection: $coverEntryId) {
                    Text("No title").tag(Int?.none)
                    ForEach(entries) { entry in
                        Text(verbatim: entry.title).tag(Int?.some(entry.id))
                    }
                }
            }
        }
    }

    private var titlesSection: some View {
        Section {
            ForEach($entries) { $entry in
                ShelfEditorRow(entry: $entry) {
                    if let index = entries.firstIndex(where: { $0.id == entry.id }) {
                        entries.remove(at: index)
                        Task { await remove(entry, at: index) }
                    }
                }
            }
            .onMove { source, destination in
                let moved = ShelfMove.move(entries, from: source, to: destination)
                entries = moved
            }
            .onDelete { offsets in
                let removed = offsets.sorted().map { (index: $0, entry: entries[$0]) }
                entries.remove(atOffsets: offsets)
                Task { for item in removed {
                    await remove(item.entry, at: item.index)
                } }
            }
            Button {
                addTitlesOpen = true
            } label: {
                Label("Add titles", systemImage: "plus")
            }
            .requiresConnection(model.isOffline)
        } header: {
            HStack {
                Text("Titles")
                Spacer()
                EditButton()
            }
        } footer: {
            Text("Drag to reorder; a group name starts a header above that title.")
        }
    }

    private func save() async {
        guard let client = model.api() else { return }
        saving = true
        defer { saving = false }
        do {
            let body = UpdateShelfBody(
                name: name.trimmingCharacters(in: .whitespaces),
                description: description.trimmingCharacters(in: .whitespaces).isEmpty ? nil : description,
                orderMode: orderMode,
                homeRow: homeRow,
                visibleFrom: from?.raw,
                visibleTo: until?.raw,
                coverStyle: coverStyle,
                coverTmdbId: coverStyle == "backdrop" ? coverEntry?.tmdbId : nil,
                coverType: coverStyle == "backdrop" ? coverEntry?.type : nil,
                // A new title's backdrop must not lose to a specific image picked on the web
                clearCoverUrl: coverStyle == "backdrop" && coverEntryId != savedCoverEntryId
            )
            var updated = try await client.updateShelf(id: detail.id, body: body)
            let orderChanged = entries.map(\.id) != detail.entries.map(\.id) ||
                entries.map(\.groupLabel) != detail.entries.map(\.groupLabel)
            if orderChanged {
                try await client.moveShelfEntries(shelfId: detail.id, entries: entries)
                updated = try await client.shelf(id: detail.id)
            }
            onSaved(updated)
            wroteTitles = false
            model.toast(String(localized: "Shelf saved."), style: .success)
            dismiss()
        } catch let apiError as APIError {
            error = apiError.userMessage(unauthorized: String(localized: "Sign in required."))
        } catch {
            self.error = String(localized: "Can't reach the server. Try again in a moment.")
        }
    }

    /// Hands the page behind the server's titles after Cancel or a swipe-down, since removes and adds already happened.
    private func reportTitleWrites() {
        guard wroteTitles, let client = model.api() else { return }
        wroteTitles = false
        let id = detail.id
        let report = onSaved
        Task {
            if let fresh = try? await client.shelf(id: id) {
                report(fresh)
            }
        }
    }

    private func remove(_ entry: ShelfEntry, at index: Int) async {
        guard let client = model.api() else { return }
        do {
            try await client.removeShelfEntry(shelfId: detail.id, entryId: entry.id)
            wroteTitles = true
        } catch {
            // Put the row back where it was, since the server still has it
            entries.insert(entry, at: min(index, entries.count))
            model.toast(String(localized: "Couldn't remove the title."), style: .error)
        }
    }
}

/// One title in the editor: its poster, name and year, and its group header.
private struct ShelfEditorRow: View {
    @Environment(AppModel.self) private var model
    @Binding var entry: ShelfEntry
    let onRemove: () -> Void

    var body: some View {
        HStack(spacing: 10) {
            CachedAsyncImage(url: model.absoluteURL(entry.posterUrl), targetSize: CGSize(width: 60, height: 90)) { image in
                image.resizable().scaledToFill()
            } placeholder: {
                Theme.inset
            }
            .frame(width: 30, height: 45)
            .clipShape(RoundedRectangle(cornerRadius: 4))
            VStack(alignment: .leading, spacing: 2) {
                Text(verbatim: entry.title)
                    .font(.subheadline)
                    .lineLimit(1)
                Text(verbatim: [entry.season.map { String(localized: "Season \($0)") }, entry.year.map { String($0) }]
                    .compactMap(\.self).joined(separator: " · "))
                    .font(.caption2)
                    .foregroundStyle(Theme.muted)
            }
            Spacer(minLength: 6)
            TextField(
                "Group",
                text: Binding(
                    get: { entry.groupLabel ?? "" },
                    set: { entry.groupLabel = $0.isEmpty ? nil : $0 }
                )
            )
            .textFieldStyle(.roundedBorder)
            .frame(maxWidth: 120)
            .font(.caption)
        }
        .swipeActions {
            Button("Remove", role: .destructive, action: onRemove)
        }
    }
}

/// A month and a day as two menus; "Any" clears the bound, and picking a month
/// or a day sets it.
struct MonthDayRow: View {
    let title: LocalizedStringKey
    @Binding var value: MonthDay?

    var body: some View {
        HStack {
            Text(title)
            Spacer()
            if let bound = Binding($value) {
                Picker(title, selection: Binding(
                    get: { bound.wrappedValue.month },
                    set: { month in
                        bound.wrappedValue = MonthDay(
                            month: month,
                            day: min(bound.wrappedValue.day, Self.daysIn(month))
                        ) ?? bound.wrappedValue
                    }
                )) {
                    ForEach(1 ... 12, id: \.self) { month in
                        Text(verbatim: Calendar.current.shortMonthSymbols[month - 1]).tag(month)
                    }
                }
                .labelsHidden()
                Picker(title, selection: Binding(
                    get: { bound.wrappedValue.day },
                    set: { day in
                        bound.wrappedValue = MonthDay(month: bound.wrappedValue.month, day: day) ?? bound.wrappedValue
                    }
                )) {
                    ForEach(1 ... Self.daysIn(bound.wrappedValue.month), id: \.self) { day in
                        Text(verbatim: String(day)).tag(day)
                    }
                }
                .labelsHidden()
                Button {
                    value = nil
                } label: {
                    Image(systemName: "xmark.circle.fill")
                }
                .buttonStyle(.plain)
                .foregroundStyle(Theme.muted)
                .accessibilityLabel("Any day")
            } else {
                Button("Any") {
                    value = MonthDay(month: 1, day: 1)
                }
                .buttonStyle(.plain)
                .foregroundStyle(Theme.apricot)
            }
        }
    }

    /// The days a month reaches in a leap year, as the server validates them.
    private static func daysIn(_ month: Int) -> Int {
        let days = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
        return days[max(1, min(12, month)) - 1]
    }
}

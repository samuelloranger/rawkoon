import SwiftUI
import UIKit

/// Admin editor for per-media display overrides (title, sort title, year,
/// overview, poster/backdrop URL). Fields prefill from the *override* value only,
/// so an untouched empty field is omitted from the PATCH (leaving the TMDB
/// default), while clearing a previously-overridden field sends an explicit null.
struct LibraryOverridesEditorView: View {
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss

    let item: LibraryMedia
    let onSaved: (LibraryMedia) -> Void

    @State private var titleText: String
    @State private var sortTitleText: String
    @State private var yearText: String
    @State private var overviewText: String
    @State private var posterUrlText: String
    @State private var backdropUrlText: String
    @State private var saving = false
    @State private var errorMessage: String?

    init(item: LibraryMedia, onSaved: @escaping (LibraryMedia) -> Void) {
        self.item = item
        self.onSaved = onSaved
        let ov = item.overrides
        _titleText = State(initialValue: ov?.title ?? "")
        _sortTitleText = State(initialValue: ov?.sortTitle ?? "")
        _yearText = State(initialValue: ov?.year.map(String.init) ?? "")
        _overviewText = State(initialValue: ov?.overview ?? "")
        _posterUrlText = State(initialValue: ov?.posterUrl ?? "")
        _backdropUrlText = State(initialValue: ov?.backdropUrl ?? "")
    }

    var body: some View {
        Form {
            Section {
                overrideField("Title", text: $titleText, placeholder: item.title)
                overrideField("Sort title", text: $sortTitleText, placeholder: "")
                overrideField(
                    "Year", text: $yearText,
                    placeholder: item.year.map(String.init) ?? "", keyboard: .numberPad
                )
            } header: {
                Text("Details")
            } footer: {
                Text("Leave a field empty to fall back to the default from TMDB.")
            }
            .listRowBackground(Theme.raised)

            Section("Overview") {
                TextField("Overview", text: $overviewText, axis: .vertical)
                    .lineLimit(3 ... 8)
                    .foregroundStyle(Theme.text)
            }
            .listRowBackground(Theme.raised)

            Section("Image URLs") {
                overrideField("Poster URL", text: $posterUrlText, placeholder: item.posterUrl ?? "")
                overrideField("Backdrop URL", text: $backdropUrlText, placeholder: item.backdropUrl ?? "")
            }
            .listRowBackground(Theme.raised)

            if let errorMessage {
                Text(errorMessage)
                    .font(.caption)
                    .foregroundStyle(Theme.terracotta)
                    .listRowBackground(Theme.raised)
            }
        }
        .scrollContentBackground(.hidden)
        .background(Theme.base)
        .tint(Theme.apricot)
        .navigationTitle("Edit info")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .cancellationAction) {
                Button("Cancel") { dismiss() }
            }
            ToolbarItem(placement: .confirmationAction) {
                if saving {
                    ProgressView().tint(Theme.muted)
                } else {
                    Button("Save") { Task { await save() } }
                }
            }
        }
    }

    private func overrideField(
        _ label: LocalizedStringKey,
        text: Binding<String>,
        placeholder: String,
        keyboard: UIKeyboardType = .default
    ) -> some View {
        LabeledContent(label) {
            TextField(placeholder, text: text)
                .multilineTextAlignment(.trailing)
                .keyboardType(keyboard)
                .foregroundStyle(Theme.text)
        }
    }

    private func save() async {
        guard let client = model.api() else { return }
        saving = true
        defer { saving = false }

        var body = UpdateLibraryOverridesBody()
        body.title = fieldValue(titleText, had: item.overrides?.title != nil)
        body.sortTitle = fieldValue(sortTitleText, had: item.overrides?.sortTitle != nil)
        body.overview = fieldValue(overviewText, had: item.overrides?.overview != nil)
        body.posterUrl = fieldValue(posterUrlText, had: item.overrides?.posterUrl != nil)
        body.backdropUrl = fieldValue(backdropUrlText, had: item.overrides?.backdropUrl != nil)

        let trimmedYear = yearText.trimmingCharacters(in: .whitespaces)
        if trimmedYear.isEmpty {
            body.year = item.overrides?.year != nil ? .clear : nil
        } else if let year = Int(trimmedYear) {
            body.year = .set(year)
        } else {
            errorMessage = String(localized: "Year must be a number.")
            return
        }

        do {
            let updated = try await client.updateLibraryOverrides(id: item.id, body: body)
            onSaved(updated)
            dismiss()
        } catch {
            errorMessage = String(localized: "Could not save changes.")
        }
    }

    /// `.set` for a non-empty value; `.clear` (null) when a previously-set
    /// override is emptied; omitted (nil) when there was nothing to change.
    private func fieldValue(_ text: String, had: Bool) -> OverrideValue<String>? {
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        if trimmed.isEmpty {
            return had ? .clear : nil
        }
        return .set(trimmed)
    }
}

/// Admin poster/backdrop picker. Loads TMDB + fanart candidates and writes the
/// chosen URL into `overrides.poster_url` / `overrides.backdrop_url`; "Use
/// default" clears the override.
struct LibraryArtworkPickerView: View {
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss

    let item: LibraryMedia
    let onSaved: (LibraryMedia) -> Void

    @State private var kind = "poster"
    @State private var candidates: [ArtworkCandidate] = []
    @State private var loading = false
    @State private var saving = false
    @State private var errorMessage: String?

    private let columns = [GridItem(.adaptive(minimum: 100, maximum: 140), spacing: 12)]

    private var currentUrl: String? {
        kind == "poster"
            ? (item.overrides?.posterUrl ?? item.posterUrl)
            : (item.overrides?.backdropUrl ?? item.backdropUrl)
    }

    var body: some View {
        ScrollView {
            Picker("Artwork kind", selection: $kind) {
                Text("Poster").tag("poster")
                Text("Backdrop").tag("backdrop")
            }
            .pickerStyle(.segmented)
            .padding(16)

            if loading {
                ProgressView().tint(Theme.muted).padding(.top, 40)
            } else if let errorMessage {
                ContentUnavailableView(
                    "Couldn't load artwork",
                    systemImage: "photo",
                    description: Text(errorMessage)
                )
                .padding(.top, 24)
            } else if candidates.isEmpty {
                ContentUnavailableView("No artwork found", systemImage: "photo")
                    .padding(.top, 24)
            } else {
                LazyVGrid(columns: columns, spacing: 12) {
                    ForEach(candidates) { candidate in
                        artworkTile(candidate)
                    }
                }
                .padding(.horizontal, 16)
                .padding(.bottom, 24)
            }
        }
        .scrollContentBackground(.hidden)
        .background(Theme.base)
        .tint(Theme.apricot)
        .navigationTitle("Change artwork")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .cancellationAction) {
                Button("Cancel") { dismiss() }
            }
            ToolbarItem(placement: .confirmationAction) {
                if currentUrl != nil {
                    Button("Use default") { Task { await apply(url: nil) } }
                        .disabled(saving)
                }
            }
        }
        .task(id: kind) { await load() }
    }

    private func artworkTile(_ candidate: ArtworkCandidate) -> some View {
        let isCurrent = candidate.url == currentUrl
        let aspect: CGFloat = kind == "poster" ? (2.0 / 3.0) : (16.0 / 9.0)
        return Button {
            Task { await apply(url: candidate.url) }
        } label: {
            CachedAsyncImage(
                url: URL(string: candidate.thumbUrl),
                targetSize: CGSize(width: 140, height: 210)
            ) { image in
                image.resizable().scaledToFill()
            } placeholder: {
                Rectangle().fill(Theme.base)
            }
            .aspectRatio(aspect, contentMode: .fit)
            .frame(maxWidth: .infinity)
            .clipShape(RoundedRectangle(cornerRadius: 10))
            .overlay(
                RoundedRectangle(cornerRadius: 10)
                    .strokeBorder(isCurrent ? Theme.apricot : Theme.border, lineWidth: isCurrent ? 2 : 1)
            )
        }
        .buttonStyle(.plain)
        .disabled(saving)
    }

    private func load() async {
        guard let client = model.api() else { return }
        loading = true
        errorMessage = nil
        defer { loading = false }
        do {
            candidates = try await client.libraryArtworkCandidates(id: item.id, kind: kind)
        } catch {
            candidates = []
            errorMessage = String(localized: "Try again later.")
        }
    }

    private func apply(url: String?) async {
        guard let client = model.api() else { return }
        saving = true
        defer { saving = false }
        var body = UpdateLibraryOverridesBody()
        let value: OverrideValue<String> = url.map { .set($0) } ?? .clear
        if kind == "poster" {
            body.posterUrl = value
        } else {
            body.backdropUrl = value
        }
        do {
            let updated = try await client.updateLibraryOverrides(id: item.id, body: body)
            onSaved(updated)
            dismiss()
        } catch {
            errorMessage = String(localized: "Could not update artwork.")
        }
    }
}

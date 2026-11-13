import SwiftUI

/// One reason, name or value, as a small pill; `onRemove` adds an x.
struct RuleChip: View {
    let text: String
    var highlighted = false
    var onRemove: (() -> Void)?

    var body: some View {
        HStack(spacing: 4) {
            Text(verbatim: text).lineLimit(1)
            if let onRemove {
                Button(action: onRemove) {
                    Image(systemName: "xmark.circle.fill")
                }
                .buttonStyle(.plain)
                .accessibilityLabel("Remove")
            }
        }
        .font(.caption2)
        .padding(.horizontal, 8)
        .padding(.vertical, 3)
        .foregroundStyle(highlighted ? Theme.onAccent : Theme.text)
        .background(highlighted ? Theme.apricot : Theme.inset, in: Capsule())
    }
}

struct GenrePickerRow: View {
    let title: LocalizedStringKey
    let genres: [Genre]
    @Binding var selection: [Int]

    /// Saved ids stay visible (and removable) while the genre list is unavailable.
    private var options: [Genre] {
        genres + selection.filter { id in !genres.contains { $0.id == id } }.map { Genre(id: $0, name: "#\($0)") }
    }

    var body: some View {
        NavigationLink {
            List(options) { genre in
                Button {
                    if let index = selection.firstIndex(of: genre.id) {
                        selection.remove(at: index)
                    } else {
                        selection.append(genre.id)
                        selection.sort()
                    }
                } label: {
                    HStack {
                        Text(verbatim: genre.name).foregroundStyle(Theme.text)
                        Spacer()
                        if selection.contains(genre.id) {
                            Image(systemName: "checkmark").foregroundStyle(Theme.apricot)
                        }
                    }
                }
            }
            .navigationTitle(title)
            .navigationBarTitleDisplayMode(.inline)
        } label: {
            HStack {
                Text(title)
                Spacer()
                Text(verbatim: selection.isEmpty ? String(localized: "Any") : String(selection.count))
                    .foregroundStyle(Theme.muted)
            }
        }
    }
}

/// A search field that adds TMDB keywords or companies as removable chips.
struct LookupChipsField: View {
    @Environment(AppModel.self) private var model

    let title: LocalizedStringKey
    let kind: String
    let prefix: String
    @Binding var ids: [Int]
    @Binding var names: [String: String]

    @State private var query = ""
    @State private var results: [ShelfLookupItem] = []

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(title).font(.subheadline)
            if !ids.isEmpty {
                FlowLayout {
                    ForEach(ids, id: \.self) { id in
                        RuleChip(text: names["\(prefix):\(id)"] ?? "#\(id)") {
                            ids.removeAll { $0 == id }
                        }
                    }
                }
            }
            TextField("Search", text: $query)
                .textFieldStyle(.roundedBorder)
                .autocorrectionDisabled()
                .textInputAutocapitalization(.never)
            ForEach(results.filter { !ids.contains($0.id) }.prefix(6)) { item in
                Button {
                    names["\(prefix):\(item.id)"] = item.name
                    ids.append(item.id)
                    query = ""
                } label: {
                    Label(item.name, systemImage: "plus.circle").font(.footnote)
                }
                .buttonStyle(.plain)
                .foregroundStyle(Theme.apricot)
            }
        }
        .task(id: query) {
            let text = query.trimmingCharacters(in: .whitespaces)
            guard text.count >= 2, let client = model.api() else {
                results = []
                return
            }
            do { try await Task.sleep(for: .milliseconds(300)) } catch { return }
            results = await (try? client.lookupShelfRule(kind: kind, query: text)) ?? []
        }
    }
}

/// Free-text values (numeric ids, certifications) entered with return and shown as chips.
struct TokenField: View {
    let title: LocalizedStringKey
    let prompt: LocalizedStringKey
    @Binding var text: String
    let values: [String]
    let onAdd: (String) -> Void
    let onRemove: (String) -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(title).font(.subheadline)
            if !values.isEmpty {
                FlowLayout {
                    ForEach(values, id: \.self) { value in
                        RuleChip(text: value) { onRemove(value) }
                    }
                }
            }
            TextField(prompt, text: $text)
                .textFieldStyle(.roundedBorder)
                .submitLabel(.done)
                .onSubmit(commit)
        }
    }

    private func commit() {
        let value = text.trimmingCharacters(in: .whitespaces)
        text = ""
        if !value.isEmpty {
            onAdd(value)
        }
    }
}

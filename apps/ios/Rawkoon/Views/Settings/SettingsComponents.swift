import SwiftUI

// Reusable settings form primitives (spec §4.7). Every editable settings screen
// composes these; no bespoke per-screen field styling. House style: Theme tokens,
// Form/Section-friendly rows with .listRowBackground(Theme.raised).

struct LabeledTextFieldRow: View {
    let title: String
    @Binding var text: String
    var placeholder: String = ""
    var keyboard: UIKeyboardType = .default
    var autocaps: Bool = false
    var mono: Bool = false

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(title).font(.footnote).foregroundStyle(Theme.muted)
            TextField(placeholder, text: $text)
                .keyboardType(keyboard)
                .textInputAutocapitalization(autocaps ? .sentences : .never)
                .autocorrectionDisabled(!autocaps)
                .font(mono ? .system(.body, design: .monospaced) : .body)
                .foregroundStyle(Theme.text)
        }
        .listRowBackground(Theme.raised)
    }
}

/// Write-only secret. Never renders the stored value; starts empty; a blank value
/// means "keep the existing secret" and must be omitted from the request body.
struct SecretFieldRow: View {
    let title: String
    @Binding var input: String
    var isStored: Bool = false

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(title).font(.footnote).foregroundStyle(Theme.muted)
            SecureField(
                isStored ? "\u{2022}\u{2022}\u{2022}\u{2022}\u{2022}\u{2022} (stored \u{2014} leave blank to keep)" : "Required",
                text: $input
            )
            .textInputAutocapitalization(.never)
            .autocorrectionDisabled(true)
            .foregroundStyle(Theme.text)
        }
        .listRowBackground(Theme.raised)
    }
}

struct ToggleRow: View {
    let title: String
    @Binding var isOn: Bool
    var subtitle: String?

    init(_ title: String, isOn: Binding<Bool>, subtitle: String? = nil) {
        self.title = title
        _isOn = isOn
        self.subtitle = subtitle
    }

    var body: some View {
        Toggle(isOn: $isOn) {
            VStack(alignment: .leading, spacing: 2) {
                Text(title).foregroundStyle(Theme.text)
                if let subtitle {
                    Text(subtitle).font(.footnote).foregroundStyle(Theme.muted)
                }
            }
        }
        .tint(Theme.apricot)
        .listRowBackground(Theme.raised)
    }
}

struct PickerRow<T: Hashable>: View {
    let title: String
    @Binding var selection: T
    let options: [(value: T, label: String)]

    var body: some View {
        Picker(title, selection: $selection) {
            ForEach(options, id: \.value) { option in
                Text(option.label).tag(option.value)
            }
        }
        .tint(Theme.apricot)
        .listRowBackground(Theme.raised)
    }
}

struct SegmentedRow<T: Hashable>: View {
    let title: String
    @Binding var selection: T
    let options: [(value: T, label: String)]

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(title).font(.footnote).foregroundStyle(Theme.muted)
            Picker(title, selection: $selection) {
                ForEach(options, id: \.value) { option in
                    Text(option.label).tag(option.value)
                }
            }
            .pickerStyle(.segmented)
        }
        .listRowBackground(Theme.raised)
    }
}

struct NumberFieldRow: View {
    let title: String
    @Binding var value: Int?
    var range: ClosedRange<Int>?
    var suffix: String?
    @State private var text = ""

    init(_ title: String, value: Binding<Int?>, range: ClosedRange<Int>? = nil, suffix: String? = nil) {
        self.title = title
        _value = value
        self.range = range
        self.suffix = suffix
    }

    var body: some View {
        HStack {
            Text(title).foregroundStyle(Theme.text)
            Spacer()
            TextField("\u{2014}", text: $text)
                .keyboardType(.numberPad)
                .multilineTextAlignment(.trailing)
                .frame(maxWidth: 96)
                .foregroundStyle(Theme.text)
                .onChange(of: text) { _, newValue in
                    if newValue.isEmpty { value = nil; return }
                    if var parsed = Int(newValue.filter(\.isNumber)) {
                        if let range { parsed = min(max(parsed, range.lowerBound), range.upperBound) }
                        value = parsed
                    }
                }
            if let suffix { Text(suffix).foregroundStyle(Theme.muted) }
        }
        .listRowBackground(Theme.raised)
        .onAppear { text = value.map(String.init) ?? "" }
    }
}

/// Pushes a checklist of options; enforces `minSelection` by disabling the last
/// remaining checkmark.
struct MultiSelectRow<T: Hashable>: View {
    let title: String
    @Binding var selected: Set<T>
    let options: [(value: T, label: String)]
    var minSelection: Int = 0

    var body: some View {
        NavigationLink {
            List {
                ForEach(options, id: \.value) { option in
                    Button {
                        toggle(option.value)
                    } label: {
                        HStack {
                            Text(option.label).foregroundStyle(Theme.text)
                            Spacer()
                            if selected.contains(option.value) {
                                Image(systemName: "checkmark").foregroundStyle(Theme.apricot)
                            }
                        }
                    }
                    .listRowBackground(Theme.raised)
                }
            }
            .scrollContentBackground(.hidden)
            .background(Theme.base)
            .navigationTitle(title)
            .navigationBarTitleDisplayMode(.inline)
        } label: {
            HStack {
                Text(title).foregroundStyle(Theme.text)
                Spacer()
                Text("\(selected.count)").foregroundStyle(Theme.muted)
            }
        }
        .listRowBackground(Theme.raised)
    }

    private func toggle(_ value: T) {
        if selected.contains(value) {
            if selected.count > minSelection { selected.remove(value) }
        } else {
            selected.insert(value)
        }
    }
}

enum TestOutcome: Equatable {
    case success(String?)
    case failure(String)
}

struct TestConnectionButton: View {
    var title: String = "Test connection"
    let action: () async -> TestOutcome
    @State private var state: TestState = .idle

    enum TestState: Equatable { case idle, running, ok(String?), failed(String) }

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Button {
                Task {
                    state = .running
                    switch await action() {
                    case .success(let message): state = .ok(message)
                    case .failure(let message): state = .failed(message)
                    }
                }
            } label: {
                HStack {
                    if state == .running { ProgressView().tint(Theme.apricot) }
                    Text(title)
                }
            }
            .tint(Theme.apricot)
            .disabled(state == .running)

            switch state {
            case .ok(let message):
                Text(message ?? "Connected").font(.footnote).foregroundStyle(Theme.apricot)
            case .failed(let message):
                Text(message).font(.footnote).foregroundStyle(Theme.terracotta)
            default:
                EmptyView()
            }
        }
        .listRowBackground(Theme.raised)
    }
}

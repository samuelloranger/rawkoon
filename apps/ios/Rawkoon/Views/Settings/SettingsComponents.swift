import SwiftUI

// Reusable settings form primitives (spec §4.7). Every editable settings screen
// composes these; no bespoke per-screen field styling. House style: Theme tokens,
// Form/Section-friendly rows with .listRowBackground(Theme.raised).
//
// User-facing text takes LocalizedStringKey so string literals extract into the
// String Catalog. Companion String / StringProtocol overloads display runtime
// values verbatim (server data, interpolations) and are preferred over
// LocalizedStringKey's String initializer, which would treat data as catalog keys.

struct LabeledTextFieldRow: View {
    private let title: Text
    @Binding var text: String
    private let placeholder: Placeholder
    var keyboard: UIKeyboardType = .default
    var autocaps: Bool = false
    var mono: Bool = false

    private enum Placeholder {
        case localized(LocalizedStringKey)
        case verbatim(String)
    }

    init(
        title: LocalizedStringKey,
        text: Binding<String>,
        placeholder: LocalizedStringKey = "",
        keyboard: UIKeyboardType = .default,
        autocaps: Bool = false,
        mono: Bool = false
    ) {
        self.title = Text(title)
        _text = text
        self.placeholder = .localized(placeholder)
        self.keyboard = keyboard
        self.autocaps = autocaps
        self.mono = mono
    }

    /// Localized title with a runtime placeholder (interpolation, ternary, data).
    init(
        title: LocalizedStringKey,
        text: Binding<String>,
        placeholder: String,
        keyboard: UIKeyboardType = .default,
        autocaps: Bool = false,
        mono: Bool = false
    ) {
        self.title = Text(title)
        _text = text
        self.placeholder = .verbatim(placeholder)
        self.keyboard = keyboard
        self.autocaps = autocaps
        self.mono = mono
    }

    init<S: StringProtocol>(
        title: S,
        text: Binding<String>,
        placeholder: S? = nil,
        keyboard: UIKeyboardType = .default,
        autocaps: Bool = false,
        mono: Bool = false
    ) {
        self.title = Text(title)
        _text = text
        self.placeholder = .verbatim(placeholder.map { String($0) } ?? "")
        self.keyboard = keyboard
        self.autocaps = autocaps
        self.mono = mono
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            title.font(.footnote).foregroundStyle(Theme.muted)
            placeholderField
                .keyboardType(keyboard)
                .textInputAutocapitalization(autocaps ? .sentences : .never)
                .autocorrectionDisabled(!autocaps)
                .font(mono ? .system(.body, design: .monospaced) : .body)
                .foregroundStyle(Theme.text)
        }
        .listRowBackground(Theme.raised)
    }

    @ViewBuilder
    private var placeholderField: some View {
        switch placeholder {
        case let .localized(key):
            TextField(key, text: $text)
        case let .verbatim(string):
            TextField(string, text: $text)
        }
    }
}

/// Write-only secret. Never renders the stored value; starts empty; a blank value
/// means "keep the existing secret" and must be omitted from the request body.
struct SecretFieldRow: View {
    private let title: Text
    @Binding var input: String
    var isStored: Bool = false

    init(title: LocalizedStringKey, input: Binding<String>, isStored: Bool = false) {
        self.title = Text(title)
        _input = input
        self.isStored = isStored
    }

    init<S: StringProtocol>(title: S, input: Binding<String>, isStored: Bool = false) {
        self.title = Text(title)
        _input = input
        self.isStored = isStored
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            title.font(.footnote).foregroundStyle(Theme.muted)
            storedOrRequiredField
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled(true)
                .foregroundStyle(Theme.text)
        }
        .listRowBackground(Theme.raised)
    }

    @ViewBuilder
    private var storedOrRequiredField: some View {
        if isStored {
            SecureField(
                "\u{2022}\u{2022}\u{2022}\u{2022}\u{2022}\u{2022} (stored \u{2014} leave blank to keep)",
                text: $input
            )
        } else {
            SecureField("Required", text: $input)
        }
    }
}

struct ToggleRow: View {
    private let title: Text
    @Binding var isOn: Bool
    private let subtitle: Text?

    init(_ title: LocalizedStringKey, isOn: Binding<Bool>, subtitle: LocalizedStringKey? = nil) {
        self.title = Text(title)
        _isOn = isOn
        self.subtitle = subtitle.map { Text($0) }
    }

    init<S: StringProtocol>(_ title: S, isOn: Binding<Bool>, subtitle: S? = nil) {
        self.title = Text(title)
        _isOn = isOn
        self.subtitle = subtitle.map { Text($0) }
    }

    var body: some View {
        Toggle(isOn: $isOn) {
            VStack(alignment: .leading, spacing: 2) {
                title.foregroundStyle(Theme.text)
                if let subtitle {
                    subtitle.font(.footnote).foregroundStyle(Theme.muted)
                }
            }
        }
        .tint(Theme.apricot)
        .listRowBackground(Theme.raised)
    }
}

struct PickerRow<T: Hashable>: View {
    private let title: Text
    @Binding var selection: T
    private let options: [(value: T, label: Text)]

    init(
        title: LocalizedStringKey,
        selection: Binding<T>,
        options: [(value: T, label: LocalizedStringKey)]
    ) {
        self.title = Text(title)
        _selection = selection
        self.options = options.map { ($0.value, Text($0.label)) }
    }

    init(
        title: LocalizedStringKey,
        selection: Binding<T>,
        options: [(value: T, label: String)]
    ) {
        self.title = Text(title)
        _selection = selection
        self.options = options.map { ($0.value, Text(verbatim: $0.label)) }
    }

    var body: some View {
        Picker(selection: $selection) {
            ForEach(options, id: \.value) { option in
                option.label.tag(option.value)
            }
        } label: {
            title
        }
        .tint(Theme.apricot)
        .listRowBackground(Theme.raised)
    }
}

struct SegmentedRow<T: Hashable>: View {
    private let title: Text
    @Binding var selection: T
    private let options: [(value: T, label: Text)]

    init(
        title: LocalizedStringKey,
        selection: Binding<T>,
        options: [(value: T, label: LocalizedStringKey)]
    ) {
        self.title = Text(title)
        _selection = selection
        self.options = options.map { ($0.value, Text($0.label)) }
    }

    init(
        title: LocalizedStringKey,
        selection: Binding<T>,
        options: [(value: T, label: String)]
    ) {
        self.title = Text(title)
        _selection = selection
        self.options = options.map { ($0.value, Text(verbatim: $0.label)) }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            title.font(.footnote).foregroundStyle(Theme.muted)
            Picker(selection: $selection) {
                ForEach(options, id: \.value) { option in
                    option.label.tag(option.value)
                }
            } label: {
                title
            }
            .pickerStyle(.segmented)
        }
        .listRowBackground(Theme.raised)
    }
}

struct NumberFieldRow: View {
    private let title: Text
    @Binding var value: Int?
    var range: ClosedRange<Int>?
    private let suffix: Text?
    @State private var text = ""

    init(
        _ title: LocalizedStringKey,
        value: Binding<Int?>,
        range: ClosedRange<Int>? = nil,
        suffix: LocalizedStringKey? = nil
    ) {
        self.title = Text(title)
        _value = value
        self.range = range
        self.suffix = suffix.map { Text($0) }
    }

    init<S: StringProtocol>(
        _ title: S,
        value: Binding<Int?>,
        range: ClosedRange<Int>? = nil,
        suffix: S? = nil
    ) {
        self.title = Text(title)
        _value = value
        self.range = range
        self.suffix = suffix.map { Text($0) }
    }

    var body: some View {
        HStack {
            title.foregroundStyle(Theme.text)
            Spacer()
            TextField("\u{2014}", text: $text)
                .keyboardType(.numberPad)
                .multilineTextAlignment(.trailing)
                .frame(maxWidth: 96)
                .foregroundStyle(Theme.text)
                .onChange(of: text) { _, newValue in
                    if newValue.isEmpty {
                        value = nil; return
                    }
                    if var parsed = Int(newValue.filter(\.isNumber)) {
                        if let range {
                            parsed = min(max(parsed, range.lowerBound), range.upperBound)
                        }
                        value = parsed
                    }
                }
            if let suffix {
                suffix.foregroundStyle(Theme.muted)
            }
        }
        .listRowBackground(Theme.raised)
        .onAppear { text = value.map(String.init) ?? "" }
    }
}

/// Pushes a checklist of options; enforces `minSelection` by disabling the last
/// remaining checkmark.
struct MultiSelectRow<T: Hashable>: View {
    private let titleKey: LocalizedStringKey
    @Binding var selected: Set<T>
    private let options: [(value: T, label: Text)]
    var minSelection: Int = 0

    init(
        title: LocalizedStringKey,
        selected: Binding<Set<T>>,
        options: [(value: T, label: LocalizedStringKey)],
        minSelection: Int = 0
    ) {
        self.titleKey = title
        _selected = selected
        self.options = options.map { ($0.value, Text($0.label)) }
        self.minSelection = minSelection
    }

    init(
        title: LocalizedStringKey,
        selected: Binding<Set<T>>,
        options: [(value: T, label: String)],
        minSelection: Int = 0
    ) {
        self.titleKey = title
        _selected = selected
        self.options = options.map { ($0.value, Text(verbatim: $0.label)) }
        self.minSelection = minSelection
    }

    var body: some View {
        NavigationLink {
            List {
                ForEach(options, id: \.value) { option in
                    Button {
                        toggle(option.value)
                    } label: {
                        HStack {
                            option.label.foregroundStyle(Theme.text)
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
            .navigationTitle(titleKey)
            .navigationBarTitleDisplayMode(.inline)
        } label: {
            HStack {
                Text(titleKey).foregroundStyle(Theme.text)
                Spacer()
                Text("\(selected.count)").foregroundStyle(Theme.muted)
            }
        }
        .listRowBackground(Theme.raised)
    }

    private func toggle(_ value: T) {
        if selected.contains(value) {
            if selected.count > minSelection {
                selected.remove(value)
            }
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
    private let title: Text
    let action: () async -> TestOutcome
    @State private var state: TestState = .idle

    enum TestState: Equatable { case idle, running, ok(String?), failed(String) }

    init(title: LocalizedStringKey = "Test connection", action: @escaping () async -> TestOutcome) {
        self.title = Text(title)
        self.action = action
    }

    init<S: StringProtocol>(title: S, action: @escaping () async -> TestOutcome) {
        self.title = Text(title)
        self.action = action
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Button {
                Task {
                    state = .running
                    switch await action() {
                    case let .success(message): state = .ok(message)
                    case let .failure(message): state = .failed(message)
                    }
                }
            } label: {
                HStack {
                    if state == .running {
                        ProgressView().tint(Theme.apricot)
                    }
                    title
                }
            }
            .tint(Theme.apricot)
            .disabled(state == .running)

            switch state {
            case let .ok(message):
                if let message {
                    Text(message).font(.footnote).foregroundStyle(Theme.apricot)
                } else {
                    Text("Connected").font(.footnote).foregroundStyle(Theme.apricot)
                }
            case let .failed(message):
                Text(message).font(.footnote).foregroundStyle(Theme.terracotta)
            default:
                EmptyView()
            }
        }
        .listRowBackground(Theme.raised)
    }
}

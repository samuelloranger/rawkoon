import RawkoonKit
import SwiftUI

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

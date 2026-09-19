import RawkoonKit
import SwiftUI

struct ScoreBreakdownPanel: View {
    let breakdown: ScoreBreakdown
    @State private var isExpanded = false

    var body: some View {
        DisclosureGroup(isExpanded: $isExpanded) {
            VStack(alignment: .leading, spacing: 6) {
                if let total = breakdown.total {
                    row(label: "Total", value: total, emphasized: true)
                }
                ForEach(breakdown.components) { component in
                    row(label: ReleaseScoringLabels.componentLabel(component.code), value: component.value)
                }
                if !breakdown.matchedFormats.isEmpty {
                    FlowLayout(spacing: 6) {
                        ForEach(breakdown.matchedFormats, id: \.self) { format in
                            BadgeChip(text: format, fg: Theme.apricotSoft, bg: Theme.apricot.opacity(0.12))
                        }
                    }
                }
            }
            .padding(.top, 6)
        } label: {
            Text("Score breakdown")
                .font(.system(.caption2, design: .monospaced))
                .foregroundStyle(Theme.muted)
        }
        .tint(Theme.muted)
    }

    private func row(label: String, value: Int, emphasized: Bool = false) -> some View {
        HStack(spacing: 8) {
            Text(label)
                .font(.system(.caption2, design: .monospaced))
                .foregroundStyle(emphasized ? Theme.textStrong : Theme.muted)
            Spacer(minLength: 8)
            Text(signed(value))
                .font(.system(.caption2, design: .monospaced).weight(emphasized ? .semibold : .regular))
                .foregroundStyle(value >= 0 ? Theme.seed : Theme.terracotta)
        }
    }

    private func signed(_ value: Int) -> String {
        value > 0 ? "+\(value)" : "\(value)"
    }
}

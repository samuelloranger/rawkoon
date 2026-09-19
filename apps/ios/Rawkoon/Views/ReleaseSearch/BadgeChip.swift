import SwiftUI

struct BadgeChip: View {
    let text: String
    var fg: Color = Theme.muted
    var bg: Color = Theme.well

    var body: some View {
        Text(text)
            .font(.system(.caption2, design: .monospaced))
            .foregroundStyle(fg)
            .padding(.horizontal, 8)
            .padding(.vertical, 3)
            .background(bg, in: Capsule())
            .lineLimit(1)
            .fixedSize()
    }
}

import RawkoonKit
import SwiftUI

/// The floating iPhone tab bar: icon-only slots, a grey pill behind the active
/// tab, the bell's unread badge and the avatar. Collapsed, only the active tab
/// remains and a tap expands it.
struct RawkoonTabBar: View {
    let tabs: [RootTab]
    @Binding var selection: RootTab
    let isCollapsed: Bool
    let unreadLabel: String?
    let initials: String?
    let onExpand: () -> Void

    @Namespace private var pill

    var body: some View {
        HStack(spacing: 0) {
            if isCollapsed {
                slot(selection)
            } else {
                ForEach(tabs, id: \.self) { tab in
                    slot(tab)
                }
            }
        }
        .padding(5)
        .background(Capsule().fill(Theme.tabBar))
        .overlay(Capsule().strokeBorder(Color.white.opacity(0.07), lineWidth: 1))
        .shadow(color: .black.opacity(0.45), radius: 16, y: 8)
        .accessibilityElement(children: .contain)
        .accessibilityLabel(Text("Tab bar"))
    }

    private func slot(_ tab: RootTab) -> some View {
        let active = tab == selection
        return Button {
            if isCollapsed {
                onExpand()
            } else if !active {
                withAnimation(.spring(duration: 0.3)) { selection = tab }
            }
        } label: {
            ZStack {
                if active {
                    Capsule()
                        .fill(Theme.tabPill)
                        .matchedGeometryEffect(id: "pill", in: pill)
                }
                icon(tab, active: active)
            }
            .frame(height: 44)
            .frame(maxWidth: isCollapsed ? 44 : .infinity)
            .frame(width: isCollapsed ? 44 : nil)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(Text(tab.title))
        .accessibilityValue(tab == .notifications ? unreadValue : Text(verbatim: ""))
        .accessibilityAddTraits(active ? .isSelected : [])
    }

    private var unreadValue: Text {
        guard let unreadLabel else { return Text(verbatim: "") }
        return Text("\(unreadLabel) unread")
    }

    @ViewBuilder
    private func icon(_ tab: RootTab, active: Bool) -> some View {
        if tab == .settings {
            avatar
        } else {
            Image(systemName: active ? tab.selectedSymbol : tab.symbol)
                .font(.system(size: 20, weight: .medium))
                .foregroundStyle(Theme.textStrong)
                .overlay(alignment: .topTrailing) {
                    if tab == .notifications, let unreadLabel {
                        Text(verbatim: unreadLabel)
                            .font(.system(size: 10, weight: .bold))
                            .foregroundStyle(.white)
                            .padding(.horizontal, 4)
                            .frame(minWidth: 16, minHeight: 16)
                            .background(Capsule().fill(Theme.badge))
                            .overlay(Capsule().strokeBorder(Theme.tabBar, lineWidth: 2))
                            .offset(x: 9, y: -7)
                    }
                }
        }
    }

    private var avatar: some View {
        ZStack {
            Circle().fill(LinearGradient(colors: [Theme.apricot, Theme.terracotta],
                                         startPoint: .topLeading, endPoint: .bottomTrailing))
            if let initials {
                Text(verbatim: initials)
                    .font(.system(size: 11, weight: .heavy))
                    .foregroundStyle(Theme.onAccent)
            } else {
                Image(systemName: "person.fill")
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundStyle(Theme.onAccent)
            }
        }
        .frame(width: 30, height: 30)
        .overlay(alignment: .bottomTrailing) {
            Image(systemName: "line.3.horizontal")
                .font(.system(size: 7, weight: .black))
                .foregroundStyle(.white)
                .frame(width: 15, height: 15)
                .background(Circle().fill(Color(hex: 0x5A504A)))
                .overlay(Circle().strokeBorder(Theme.tabBar, lineWidth: 2))
                .offset(x: 5, y: 4)
        }
    }
}

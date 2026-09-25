/// Maps the app's unread-notification count to the number set on the app icon.
/// Pure so it is unit-tested on Linux; the UNUserNotificationCenter call stays
/// in the app target.
public enum NotificationBadge {
    public static func value(forUnread unread: Int, cap: Int = 99) -> Int {
        max(0, min(unread, cap))
    }

    /// Text for the tab-bar bell badge; nil hides the badge.
    public static func label(forUnread unread: Int) -> String? {
        guard unread > 0 else { return nil }
        return unread > 9 ? "9+" : String(unread)
    }
}

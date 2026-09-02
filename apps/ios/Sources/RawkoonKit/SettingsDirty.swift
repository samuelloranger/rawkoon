/// Pure dirty-tracking for settings forms. A secret field is dirty only when the
/// user typed something — an empty secret never marks the form dirty (spec §4.4/§4.6).
public enum SettingsDirty {
    public static func isDirty<T: Equatable>(loaded: T, draft: T, secretEntered: Bool) -> Bool {
        draft != loaded || secretEntered
    }
}

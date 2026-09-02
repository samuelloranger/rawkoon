/// Pure validation helpers shared by settings forms (spec §4.6/§4.7).
public enum SettingsValidation {
    public static func clamp(_ v: Int, to range: ClosedRange<Int>) -> Int {
        min(max(v, range.lowerBound), range.upperBound)
    }

    public static func hasMinSelection(_ set: Set<some Any>, min: Int) -> Bool {
        set.count >= min
    }

    public static func nonBlank(_ s: String) -> Bool {
        !s.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }
}

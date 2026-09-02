/// Custom-format condition type → allowed operators, mirroring
/// apps/api/src/services/customFormatValidation.ts (spec §5 Phase 4). Built now so
/// the condition-builder component shell compiles against a real API; the full
/// editor lands in Phase 4.
public enum ConditionRules {
    private static let table: [String: [String]] = [
        "title_regex": ["matches"],
        "release_group": ["matches"],
        "source": ["equals"],
        "codec": ["equals"],
        "indexer": ["equals"],
        "language": ["equals"],
        "resolution": ["gte", "lte", "lt", "gt", "equals", "between"],
        "seeders": ["gte", "lte", "lt", "gt", "equals", "between"],
        "size_range": ["gte", "lte", "lt", "gt", "equals", "between"],
        "hdr_flag": ["is_true"],
        "proper_repack": ["is_true"],
        "freeleech": ["is_true"],
    ]

    public static func operators(for type: String) -> [String] {
        table[type] ?? []
    }

    public static func needsValue(_ op: String) -> Bool {
        op != "is_true"
    }
}

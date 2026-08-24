import type { BookMetadataSource } from "@rawkoon/shared/types";
import type { MergedBookFields, ProviderFields } from "./types";

/**
 * Pure. No I/O, no Prisma, no fetch.
 *
 * Auto-merge concentrates its whole correctness risk here, which is exactly
 * why this is a pure function over fixtures rather than logic tangled into the
 * fetchers.
 */

/**
 * Every field the merge resolves. An override key outside this list is ignored,
 * which is also what keeps a crafted `__proto__` key in the stored JSON from
 * reaching Object.prototype.
 *
 * `__asin` is deliberately absent: it is internal plumbing carrying the id a
 * source resolved, not a field to merge or record provenance for.
 */
export const MERGEABLE_FIELDS = [
  "title",
  "subtitle",
  "authors",
  "narrators",
  "genres",
  "publisher",
  "pageCount",
  "publishedDate",
  "publishedYear",
  "isbn13",
  "coverUrl",
  "overview",
  "seriesName",
  "seriesPosition",
  "language",
  "rating",
  "ratingCount",
  "authorBio",
  "authorImageUrl",
] as const satisfies ReadonlyArray<keyof ProviderFields>;

type MergeableField = (typeof MERGEABLE_FIELDS)[number];

/**
 * Whether a source said anything about this field.
 *
 * An absent key defers to the next source. An explicit null is an assertion of
 * emptiness and wins. An empty array counts as "nothing to say": every
 * provider builds its arrays by filtering, so `[]` is indistinguishable from
 * "this payload had no such list" and must not blank a lower source's value.
 */
const speaks = (fields: ProviderFields, field: MergeableField): boolean => {
  if (!(field in fields)) return false;
  const value = fields[field];
  if (value === undefined) return false;
  if (Array.isArray(value) && value.length === 0) return false;
  return true;
};

export function mergeBookMetadata(
  candidates: Array<{ source: BookMetadataSource; fields: ProviderFields }>,
  order: BookMetadataSource[],
  overrides: Record<string, unknown> | null,
): {
  merged: MergedBookFields;
  provenance: Record<string, BookMetadataSource>;
} {
  const merged: MergedBookFields = {};
  const provenance: Record<string, BookMetadataSource> = {};

  const bySource = new Map<BookMetadataSource, ProviderFields>();
  for (const c of candidates) {
    // Last contribution per source wins; a source should only appear once.
    bySource.set(c.source, c.fields);
  }

  for (const field of MERGEABLE_FIELDS) {
    // A source absent from `order` is disabled — the order doubles as the
    // enable list, so it is not consulted at all.
    for (const source of order) {
      const fields = bySource.get(source);
      if (!fields || !speaks(fields, field)) continue;
      (merged as Record<string, unknown>)[field] = fields[field];
      provenance[field] = source;
      break;
    }
  }

  if (overrides) {
    for (const field of MERGEABLE_FIELDS) {
      // Own-property check only, and driven by the known-field list rather than
      // by the object's own keys.
      if (!Object.hasOwn(overrides, field)) continue;
      (merged as Record<string, unknown>)[field] = overrides[field];
      // An overridden field has no source: the operator is the source.
      delete provenance[field];
    }
  }

  return { merged, provenance };
}

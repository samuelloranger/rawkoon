#!/usr/bin/env node
// One-shot migration codemod for the v3 "Cozy Dusk" dark-only design system.
//
// The app is now DARK-ONLY (`.dark` is forced permanently) and the @theme color
// scales were remapped so neutral-* = warm brown and primary-* = warm apricot.
// As a result:
//   - every `dark:` variant prefix is redundant noise (the dark value always wins)
//   - `zinc-*` (cold gray) is off-palette and must become warm `neutral-*`
//
// This script rewrites Tailwind class strings to have ZERO `dark:` prefixes and
// ZERO `zinc-` classes while preserving the current (dark) rendered appearance.
//
// Algorithm per class STRING:
//   1. tokenize on whitespace
//   2. for each token, drop any variant segment exactly equal to "dark"
//      (split on ":", remove "dark" segments, rejoin)
//   3. replace `zinc-` with `neutral-` in any token (incl. opacity modifiers)
//   4. rejoin tokens with single spaces, then pass the whole string through
//      twMerge. Because `dark:` overrides are conventionally written AFTER their
//      light base (`bg-white dark:bg-neutral-800`), stripping yields
//      `bg-white bg-neutral-800` and twMerge keeps the LAST conflicting class
//      (the dark value). Order is preserved — we never reorder before twMerge.
//
// String extraction uses the TypeScript compiler API: we visit StringLiteral,
// NoSubstitutionTemplateLiteral, and the head/middle/tail text spans of
// TemplateExpression. Only strings/chunks containing `dark:` or `zinc` are
// touched; everything else is left byte-for-byte identical. ${...} template
// interpolations are never modified.
//
// Usage:
//   node scripts/flatten-dark.mjs --dry  src/**/*.tsx
//   node scripts/flatten-dark.mjs        src/**/*.tsx

import { readFileSync, writeFileSync } from "node:fs";
import { argv } from "node:process";
import ts from "typescript";
import { extendTailwindMerge } from "tailwind-merge";

// Tailwind v3's legacy `*-opacity-*` utilities (bg-opacity-75, text-opacity-50,
// border-opacity, ring-opacity, divide-opacity) are removed in Tailwind v4, so
// the default tailwind-merge v3 config folds e.g. `bg-opacity-90` into the
// `bg-color` group and would DROP a sibling `bg-black`. That changes appearance.
// We give each legacy opacity utility its own class group so it conflicts only
// with itself, leaving the real color utility (`bg-black`) intact while still
// collapsing duplicate dark/light opacity values.
const legacyOpacity = (prefix) => [{ [`${prefix}-opacity`]: [() => true] }];
const twMerge = extendTailwindMerge({
  extend: {
    classGroups: {
      "bg-opacity": legacyOpacity("bg"),
      "text-opacity": legacyOpacity("text"),
      "border-opacity": legacyOpacity("border"),
      "ring-opacity": legacyOpacity("ring"),
      "divide-opacity": legacyOpacity("divide"),
    },
  },
});

const args = argv.slice(2);
const dry = args.includes("--dry");
const files = args.filter((a) => a !== "--dry");

/**
 * Transform a single Tailwind class string.
 * Returns the (possibly identical) transformed string.
 */
function transformClassString(value) {
  if (!/dark:|zinc/.test(value)) return value;

  // Preserve leading/trailing whitespace exactly by splitting on whitespace runs
  // but operating only on the non-whitespace tokens. We rebuild with single
  // spaces only for the meaningful part, then re-run twMerge which collapses
  // whitespace anyway. To be safe about strings that are pure class lists, we
  // keep it simple: tokenize, transform, twMerge.
  const tokens = value.split(/\s+/).filter(Boolean);
  const out = [];
  for (let token of tokens) {
    // Step 2: drop "dark" variant segments.
    if (token.includes(":")) {
      const segs = token.split(":");
      const kept = segs.filter((s) => s !== "dark");
      // If everything was dropped (shouldn't happen — there's always a utility
      // after the last colon), keep original to be safe.
      token = kept.length ? kept.join(":") : token;
    }
    // Step 3: zinc- -> neutral- (covers shade + opacity modifiers).
    token = token.replace(/zinc-/g, "neutral-");
    out.push(token);
  }
  // Step 4: twMerge resolves conflicts, keeping later (dark) classes.
  const merged = twMerge(out.join(" "));

  // Safety net: any token present after dark-strip/zinc-map that twMerge dropped
  // should be a *color/variant duplicate* (the dead light base). If a dropped
  // token has NO surviving counterpart sharing its variant chain + utility
  // prefix, flag it — that would be an unintended loss (e.g. a layout utility).
  const mergedSet = new Set(merged.split(/\s+/).filter(Boolean));
  for (const tok of out) {
    if (mergedSet.has(tok)) continue;
    // derive variant chain + leading utility segment to find a counterpart
    const parts = tok.split(":");
    const variants = parts.slice(0, -1).join(":");
    const util = parts[parts.length - 1];
    // base prefix up to last dash-group (e.g. bg-, text-, border-)
    const dash = util.indexOf("-");
    const base = dash > 0 ? util.slice(0, dash) : util;
    const hasCounterpart = [...mergedSet].some((m) => {
      const mp = m.split(":");
      const mv = mp.slice(0, -1).join(":");
      const mu = mp[mp.length - 1];
      const md = mu.indexOf("-");
      const mbase = md > 0 ? mu.slice(0, md) : mu;
      return mv === variants && mbase === base;
    });
    if (!hasCounterpart) {
      DROPPED.push({ token: tok, from: value, merged });
    }
  }

  // Preserve surrounding whitespace from the original (leading/trailing),
  // since some className strings intentionally pad (e.g. " foo ").
  const lead = value.match(/^\s*/)[0];
  const trail = value.match(/\s*$/)[0];
  return lead + merged + trail;
}

// Tokens twMerge removed without a same-base counterpart surviving — potential
// unintended losses. Reported at the end of the run for manual review.
const DROPPED = [];

function transformFile(filePath) {
  const original = readFileSync(filePath, "utf8");
  const sf = ts.createSourceFile(
    filePath,
    original,
    ts.ScriptTarget.Latest,
    /*setParentNodes*/ true,
    filePath.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );

  // Collect edits as {start, end, newText} on the raw source text, operating on
  // the *inner* text of the literal so we never disturb quote/backtick chars or
  // escape sequences we didn't author.
  const edits = [];

  /** push an edit for a literal whose inner text spans [innerStart, innerEnd). */
  function consider(node, innerStart, innerEnd) {
    const inner = original.slice(innerStart, innerEnd);
    if (!/dark:|zinc/.test(inner)) return;
    const next = transformClassString(inner);
    if (next !== inner) {
      edits.push({ start: innerStart, end: innerEnd, newText: next });
    }
  }

  function visit(node) {
    if (ts.isStringLiteral(node)) {
      // node.getStart()+1 .. node.getEnd()-1 is the content between quotes.
      const s = node.getStart(sf) + 1;
      const e = node.getEnd() - 1;
      consider(node, s, e);
    } else if (ts.isNoSubstitutionTemplateLiteral(node)) {
      // `...` with no interpolation. Content between the backticks.
      const s = node.getStart(sf) + 1;
      const e = node.getEnd() - 1;
      consider(node, s, e);
    } else if (ts.isTemplateExpression(node)) {
      // head + each span's literal (middle/tail). These have `...${ and }...${
      // delimiters. The TEXT is node.text; raw delimiters vary. Use rawText
      // boundaries derived from positions.
      // Head: between opening backtick and `${`
      const head = node.head;
      // head text raw spans from getStart()+1 (after backtick) to getEnd()-2 (before "${")
      consider(head, head.getStart(sf) + 1, head.getEnd() - 2);
      for (const span of node.templateSpans) {
        const lit = span.literal;
        // middle: between "}" and "${"  -> getStart()+1 .. getEnd()-2
        // tail:   between "}" and "`"   -> getStart()+1 .. getEnd()-1
        const isTail = lit.kind === ts.SyntaxKind.TemplateTail;
        const s = lit.getStart(sf) + 1;
        const e = lit.getEnd() - (isTail ? 1 : 2);
        consider(lit, s, e);
      }
      // Do NOT descend into the head/literals again, but DO descend into the
      // interpolated expressions (they may contain nested template literals /
      // string literals with classes, e.g. cn(`...`, cond ? "dark:.." : "")).
      for (const span of node.templateSpans) {
        ts.forEachChild(span.expression, visit);
      }
      return; // already handled children we care about
    }
    ts.forEachChild(node, visit);
  }

  visit(sf);

  if (edits.length === 0) return { changed: false, edits: [] };

  // Apply edits back-to-front so offsets stay valid.
  edits.sort((a, b) => b.start - a.start);
  let result = original;
  for (const ed of edits) {
    result = result.slice(0, ed.start) + ed.newText + result.slice(ed.end);
  }

  if (dry) {
    // print before/after for each changed string
    // (recompute in source order for readability)
    const ordered = [...edits].sort((a, b) => a.start - b.start);
    for (const ed of ordered) {
      const before = original.slice(ed.start, ed.end);
      const line = original.slice(0, ed.start).split("\n").length;
      console.log(`\n${filePath}:${line}`);
      console.log(`  - ${JSON.stringify(before)}`);
      console.log(`  + ${JSON.stringify(ed.newText)}`);
    }
  } else {
    writeFileSync(filePath, result, "utf8");
  }

  return { changed: true, edits };
}

let changedFiles = 0;
let changedStrings = 0;
for (const f of files) {
  try {
    const { changed, edits } = transformFile(f);
    if (changed) {
      changedFiles++;
      changedStrings += edits.length;
      if (!dry) console.log(`rewrote ${f} (${edits.length} strings)`);
    }
  } catch (err) {
    console.error(`ERROR processing ${f}: ${err.message}`);
    process.exitCode = 1;
  }
}

console.log(
  `\n${dry ? "[DRY] " : ""}${changedFiles} files, ${changedStrings} strings changed`,
);

if (DROPPED.length) {
  console.log(
    `\n⚠️  ${DROPPED.length} token(s) dropped by twMerge with NO same-base counterpart (review for unintended loss):`,
  );
  for (const d of DROPPED) {
    console.log(`  dropped "${d.token}"`);
    console.log(`    from:   ${JSON.stringify(d.from)}`);
    console.log(`    merged: ${JSON.stringify(d.merged)}`);
  }
} else {
  console.log("✓ no unexplained token drops");
}

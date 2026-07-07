// WHAT:  CI check that every source file starts with the required
//        WHAT/WHY header comment.
// WHY:   Comments only stay useful if they're enforced — this makes a
//        missing header a failing build instead of a forgotten habit.
//        See docs/COMMENTING_STANDARDS.md for the header format.
// LINKS: Run by .github/workflows/ci.yml. Zero dependencies (Node built-ins).

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, extname } from "node:path";

// Folders to scan for source files that must carry headers.
const SCAN_ROOTS = ["src", "app", "supabase/functions", "scripts"];

// Anything matching these is skipped (generated, vendored, or config noise).
const SKIP_DIRS = new Set(["node_modules", ".expo", "dist", "build", ".git"]);
const SKIP_FILE_SUFFIXES = [".d.ts", ".config.ts", ".config.js"];
const EXTENSIONS = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".sql"]);

// A file passes if "WHAT:" appears within its first N lines.
const HEADER_SEARCH_LINES = 20;

/** Recursively collect files under a directory, honouring the skip lists. */
function collectFiles(dir, found = []) {
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return found; // Root doesn't exist yet (e.g. pre-scaffold) — fine.
  }
  for (const entry of entries) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (!SKIP_DIRS.has(entry)) collectFiles(full, found);
      continue;
    }
    if (!EXTENSIONS.has(extname(entry))) continue;
    if (SKIP_FILE_SUFFIXES.some((s) => entry.endsWith(s))) continue;
    found.push(full);
  }
  return found;
}

/** True if the file's opening lines contain the WHAT: header marker. */
function hasHeader(file) {
  const head = readFileSync(file, "utf8")
    .split("\n")
    .slice(0, HEADER_SEARCH_LINES)
    .join("\n");
  return head.includes("WHAT:");
}

const offenders = SCAN_ROOTS.flatMap((root) => collectFiles(root)).filter(
  (file) => !hasHeader(file),
);

if (offenders.length > 0) {
  console.error(
    `\n✗ ${offenders.length} file(s) missing the WHAT/WHY header ` +
      `(see docs/COMMENTING_STANDARDS.md):\n`,
  );
  for (const file of offenders) console.error(`  - ${file}`);
  console.error("");
  process.exit(1);
}

console.log("✓ All source files have WHAT/WHY headers.");

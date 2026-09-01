// WHAT:  Read-only pre-flight that compares three views of the RPC surface:
//        what src/ CALLS, what supabase/migrations/ DECLARES, and what the
//        deployed PostgREST actually EXPOSES (name AND parameter names).
//        Run: `npm run preflight`. Nothing is written and, by default, no
//        database function is ever invoked — the deployed view comes from
//        PostgREST's OpenAPI document, which is pure introspection.
// WHY:   All 2689 Jest tests mock the network, so the client<->Supabase
//        contract has never been checked against a real database, and
//        `npm run test:db` needs Docker. This project has already drifted
//        once: the fee schema was hand-applied to production with no
//        migration file, so "the repo says so" is not evidence about what is
//        deployed. A missing function or a renamed parameter is invisible
//        until a user hits that screen; this makes it a 20-second check.
//        SAFETY: anon key only (never service_role), GET-only in the default
//        mode, and --probe is opt-in and documented below before it is used.
// LINKS: src/shared/api/supabase.ts (the client and the two env vars this
//        reads); scripts/test-db.sh (the Docker-gated SQL suites this does
//        NOT replace); docs/TESTING.md; docs/OPERATIONS.md.
//
// NOTE:  Behind a TLS-intercepting network Node needs the system trust store,
//        so the npm script passes --use-system-ca directly to node. Invoking
//        `node scripts/preflight.mjs` without it fails on certificate errors.

import { readdirSync, readFileSync, statSync, existsSync } from "node:fs";
import { join, extname } from "node:path";
import { Buffer } from "node:buffer";

const ROOT = new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
const PROBE = process.argv.includes("--probe");
const VERBOSE = process.argv.includes("--verbose");
// --offline is what CI runs. Check 1 is a pure repo consistency check and needs
// no database, so it belongs in the pipeline — but a CI job must never be able
// to reach the production project, and "there is no .env on the runner" is a
// weak guarantee (one day someone adds the secret for an unrelated reason).
// The flag makes the intent explicit rather than incidental.
const OFFLINE = process.argv.includes("--offline");

// ---------------------------------------------------------------------------
// Environment
// ---------------------------------------------------------------------------

/** Minimal .env reader — no dependency, and we only need two keys. */
function readEnvFile(path) {
  if (!existsSync(path)) return {};
  const out = {};
  for (const raw of readFileSync(path, "utf8").split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq === -1) continue;
    out[line.slice(0, eq).trim()] = line
      .slice(eq + 1)
      .trim()
      .replace(/^["']|["']$/g, "");
  }
  return out;
}

const fileEnv = readEnvFile(join(ROOT, ".env"));
const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL ?? fileEnv.EXPO_PUBLIC_SUPABASE_URL;
const ANON_KEY =
  process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? fileEnv.EXPO_PUBLIC_SUPABASE_ANON_KEY;

// A service_role key here would bypass RLS on every call below. The anon key
// is what the shipped APK carries, and it is the only correct key for a
// pre-flight: we want to see exactly what a real client sees.
if (ANON_KEY && /service_role/.test(Buffer.from(ANON_KEY.split(".")[1] ?? "", "base64").toString())) {
  console.error("REFUSING TO RUN: that is a service_role key. Use the anon/public key.");
  process.exit(2);
}

// ---------------------------------------------------------------------------
// View 1 — what src/ CALLS
// ---------------------------------------------------------------------------

const SKIP_DIRS = new Set(["node_modules", ".expo", "dist", "build", ".git"]);

function collect(dir, exts, found = []) {
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return found;
  }
  for (const entry of entries) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (!SKIP_DIRS.has(entry)) collect(full, exts, found);
      continue;
    }
    if (!exts.has(extname(entry))) continue;
    if (/\.test\.[tj]sx?$/.test(entry)) continue; // Tests mock; they prove nothing here.
    found.push(full);
  }
  return found;
}

// Direct `supabase.rpc('name'` plus the three feature helpers that wrap it
// (garageApi.callGarageRpc, editSectionApi.callSectionRpc,
// collectionsApi.callCollectionRpc) — each takes the function name as its
// first argument, so one pattern covers all four shapes.
const CALL_RE = /(?:supabase\.rpc|call(?:Garage|Section|Collection)Rpc)\(\s*'([a-z0-9_]+)'/g;

function scanClientCalls() {
  const calls = new Map(); // name -> Set(file)
  for (const file of collect(join(ROOT, "src"), new Set([".ts", ".tsx"]))) {
    const text = readFileSync(file, "utf8");
    for (const m of text.matchAll(CALL_RE)) {
      const rel = file.slice(ROOT.length).replace(/\\/g, "/").replace(/^\/?/, "");
      if (!calls.has(m[1])) calls.set(m[1], new Set());
      calls.get(m[1]).add(rel);
    }
  }
  return calls;
}

// ---------------------------------------------------------------------------
// View 2 — what supabase/migrations/ DECLARES
// ---------------------------------------------------------------------------

// Argument lists in this repo carry prose comments, and that prose contains
// COMMAS and PARENTHESES — "…despite reading better beside…" would otherwise
// parse as a parameter named `despite`, and the probe would then ask PostgREST
// for a signature that never existed and report healthy functions as missing.
// Strip comments first, respecting string literals so a default like 'a--b'
// survives.
function stripSqlComments(sig) {
  let out = "";
  let quote = null;
  for (let i = 0; i < sig.length; i++) {
    const ch = sig[i];
    const next = sig[i + 1];
    if (quote) {
      out += ch;
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === "'" || ch === '"') {
      quote = ch;
      out += ch;
      continue;
    }
    if (ch === "-" && next === "-") {
      while (i < sig.length && sig[i] !== "\n") i++;
      out += "\n";
      continue;
    }
    if (ch === "/" && next === "*") {
      i += 2;
      while (i < sig.length && !(sig[i] === "*" && sig[i + 1] === "/")) i++;
      i++;
      out += " ";
      continue;
    }
    out += ch;
  }
  return out;
}

/** Split a SQL argument list on top-level commas (parens/quotes aware). */
function splitArgs(sig) {
  const parts = [];
  let depth = 0;
  let quote = null;
  let current = "";
  for (const ch of sig) {
    if (quote) {
      current += ch;
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === "'" || ch === '"') {
      quote = ch;
      current += ch;
      continue;
    }
    if (ch === "(") depth++;
    if (ch === ")") depth--;
    if (ch === "," && depth === 0) {
      parts.push(current);
      current = "";
      continue;
    }
    current += ch;
  }
  if (current.trim()) parts.push(current);
  return parts;
}

/** Parameter NAMES from a Postgres argument list, in declaration order. */
function paramNames(sig) {
  return splitArgs(stripSqlComments(sig))
    .map((part) => {
      const tokens = part.trim().split(/\s+/);
      // Strip an explicit mode; OUT params are not part of the call contract.
      let i = 0;
      if (/^(in|inout)$/i.test(tokens[0] ?? "")) i = 1;
      if (/^(out|variadic)$/i.test(tokens[0] ?? "")) return null;
      return tokens[i] ?? null;
    })
    .filter((n) => n && /^[a-z_][a-z0-9_]*$/i.test(n));
}

// `create [or replace] function public.name( ... ) returns`. A later migration
// replacing an earlier one wins, so files are read in filename order and the
// last definition for a name is the effective one.
const FN_RE =
  /create\s+(?:or\s+replace\s+)?function\s+(?:public\.)?([a-z0-9_]+)\s*\(([\s\S]*?)\)\s*returns\b/gi;

function scanMigrations() {
  const dir = join(ROOT, "supabase", "migrations");
  const declared = new Map(); // name -> { params, file }
  if (!existsSync(dir)) return declared;
  for (const file of readdirSync(dir).filter((f) => f.endsWith(".sql")).sort()) {
    // ⚠️ COMMENTS STRIPPED BEFORE MATCHING, not just inside the captured arg
    // list. The first version stripped them only in paramNames, which fixed
    // commas in prose but left the scan itself reading comment text — so a
    // migration whose HEADER discusses `create or replace function
    // send_message(...)` was parsed as a redeclaration of it. Being the newest
    // file, that phantom won, its "arguments" were a paragraph of English, and
    // the probe reported a perfectly healthy send_message as MISSING.
    //
    // A false MISSING is the worst output this tool has: it sends someone
    // hunting a bug in production code that is fine.
    const text = stripSqlComments(readFileSync(join(dir, file), "utf8"));
    for (const m of text.matchAll(FN_RE)) {
      declared.set(m[1], { params: paramNames(m[2]), file });
    }
  }
  return declared;
}

// ---------------------------------------------------------------------------
// View 3 — what the deployed PostgREST EXPOSES (introspection, no calls)
// ---------------------------------------------------------------------------

async function fetchExposed() {
  const res = await fetch(`${SUPABASE_URL.replace(/\/$/, "")}/rest/v1/`, {
    method: "GET",
    headers: { apikey: ANON_KEY, Authorization: `Bearer ${ANON_KEY}`, Accept: "application/json" },
  });
  if (!res.ok) {
    // Supabase gates this endpoint to service_role — an anon key gets 401 with
    // "Only the `service_role` API key can be used for this endpoint". That is
    // expected, not a misconfiguration, and it is why --probe exists: on a
    // hosted project the anon-reachable way to ask "does this function exist
    // with these parameter names?" is to call it and read the error code.
    // We do NOT fall back to service_role: that key bypasses RLS and is an
    // Edge Function secret, not something a local script should hold.
    return { ok: false, status: res.status, detail: (await res.text()).slice(0, 300) };
  }
  const spec = await res.json();
  const exposed = new Map(); // name -> params[]
  for (const [path, ops] of Object.entries(spec.paths ?? {})) {
    if (!path.startsWith("/rpc/")) continue;
    const name = path.slice("/rpc/".length);
    // PostgREST describes RPC arguments as a body-schema parameter.
    const params = new Set();
    for (const op of Object.values(ops ?? {})) {
      for (const p of op?.parameters ?? []) {
        const props = p?.schema?.properties;
        if (props) Object.keys(props).forEach((k) => params.add(k));
        else if (p?.name && p.name !== "args" && p.in === "query") params.add(p.name);
      }
    }
    exposed.set(name, [...params]);
  }
  return { ok: true, exposed, definitions: Object.keys(spec.definitions ?? {}) };
}

// ---------------------------------------------------------------------------
// Optional probe (--probe): classify one function by calling it with NULLs
// ---------------------------------------------------------------------------
//
// Only reached when introspection could not resolve a name. Unauthenticated,
// so auth.uid() is NULL inside every function — the ownership/participant
// checks that gate every write path reject before anything is written. Still
// opt-in, because it is the one part of this script that executes SQL.

const PROBE_CODES = {
  PGRST202: "NOT FOUND (no function with that name + those argument names)",
  PGRST203: "AMBIGUOUS (multiple overloads match)",
  "42883": "NOT FOUND (undefined function)",
  "42501": "EXISTS, anon denied — healthy",
  "22P02": "EXISTS (argument type rejected)",
  "23502": "EXISTS (not-null violation)",
  "23503": "EXISTS (foreign key violation)",
  P0001: "EXISTS (raised an application error)",
};

async function probe(name, params) {
  const body = Object.fromEntries(params.map((p) => [p, null]));
  try {
    const res = await fetch(`${SUPABASE_URL.replace(/\/$/, "")}/rest/v1/rpc/${name}`, {
      method: "POST",
      headers: {
        apikey: ANON_KEY,
        Authorization: `Bearer ${ANON_KEY}`,
        "Content-Type": "application/json",
        // Ask PostgREST not to return a representation we do not need.
        Prefer: "return=minimal",
      },
      body: JSON.stringify(body),
    });
    if (res.ok) return "EXECUTED (anon reached it with null args — check this one)";
    const payload = await res.json().catch(() => ({}));
    const code = payload.code ?? String(res.status);
    return PROBE_CODES[code] ?? `EXISTS? code=${code} ${String(payload.message ?? "").slice(0, 80)}`;
  } catch (err) {
    return `NETWORK ERROR (${err.message})`;
  }
}

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------

const PASS = "  ok  ";
const WARN = " warn ";
const FAIL = " FAIL ";

let failures = 0;
let warnings = 0;

function line(tag, msg) {
  if (tag === FAIL) failures++;
  if (tag === WARN) warnings++;
  console.log(`[${tag}] ${msg}`);
}

function heading(text) {
  console.log(`\n${text}\n${"-".repeat(text.length)}`);
}

const sameSet = (a, b) => a.length === b.length && [...a].sort().join() === [...b].sort().join();

async function main() {
  const called = scanClientCalls();
  const declared = scanMigrations();

  console.log("Trackitdown pre-flight — read-only");
  console.log(`  client calls   : ${called.size} distinct RPCs across src/`);
  console.log(`  migrations     : ${declared.size} functions declared`);
  console.log(
    `  mode           : ${
      OFFLINE
        ? "offline (repo only, no network)"
        : PROBE
          ? "introspection + probe"
          : "introspection only (no function is invoked)"
    }`,
  );

  // -- Check 1: every RPC the client calls is declared somewhere in the repo.
  heading("1. Client calls vs migrations (offline)");
  const undeclared = [...called.keys()].filter((n) => !declared.has(n)).sort();
  if (undeclared.length === 0) {
    line(PASS, `all ${called.size} client RPCs are declared in supabase/migrations/`);
  } else {
    for (const name of undeclared) {
      line(FAIL, `${name} — called by ${[...called.get(name)][0]} but no migration declares it`);
    }
  }

  // -- Check 2: what the deployed database actually exposes.
  heading("2. Migrations vs deployed database (introspection)");
  if (OFFLINE) {
    console.log("  skipped — --offline. No network call was made.");
    return finish();
  }
  if (!SUPABASE_URL || !ANON_KEY) {
    line(WARN, "EXPO_PUBLIC_SUPABASE_URL / _ANON_KEY not set — skipped the network checks");
    return finish();
  }

  // Names introspection could not confirm — everything, when it is refused.
  let unresolved = [...called.keys()].sort();

  const remote = await fetchExposed();
  if (!remote.ok) {
    line(
      WARN,
      `PostgREST introspection unavailable (HTTP ${remote.status}) — expected on ` +
        `a hosted Supabase project, which restricts /rest/v1/ to service_role. ` +
        `Nothing was verified against the deployed database. Re-run with --probe ` +
        `to classify by calling each RPC instead.`,
    );
    if (VERBOSE) console.log(`         ${remote.detail}`);
  } else {
    line(PASS, `deployed schema exposes ${remote.exposed.size} RPCs`);

    const missing = [];
    const drifted = [];
    for (const name of [...called.keys()].sort()) {
      if (!remote.exposed.has(name)) {
        missing.push(name);
        continue;
      }
      const declaredParams = declared.get(name)?.params ?? [];
      const remoteParams = remote.exposed.get(name);
      if (declaredParams.length && remoteParams.length && !sameSet(declaredParams, remoteParams)) {
        drifted.push({ name, declaredParams, remoteParams });
      }
    }

    for (const name of missing) {
      line(
        FAIL,
        `${name} — called by the client, declared in ${declared.get(name)?.file ?? "?"}, ` +
          `but NOT exposed by the deployed database`,
      );
    }
    for (const d of drifted) {
      line(
        FAIL,
        `${d.name} — parameter drift. repo: (${d.declaredParams.join(", ")}) ` +
          `deployed: (${d.remoteParams.join(", ")})`,
      );
    }
    if (!missing.length && !drifted.length) {
      line(PASS, `all ${called.size} client RPCs are deployed with matching parameter names`);
    }

    // Informational: deployed functions nothing calls. Not a failure — cron
    // and Edge Functions legitimately call some of these.
    const orphans = [...remote.exposed.keys()].filter((n) => !called.has(n)).sort();
    if (orphans.length && VERBOSE) {
      console.log(`\n  exposed but never called from src/ (${orphans.length}):`);
      for (const n of orphans) console.log(`    ${n}`);
    } else if (orphans.length) {
      console.log(`\n  (${orphans.length} exposed RPCs are never called from src/ — --verbose to list)`);
    }

    unresolved = missing;
  }

  // Probing is the FALLBACK for what introspection could not answer — so it has
  // to run both when introspection resolved everything but a few names, and
  // when introspection was refused outright (the hosted-Supabase case, where
  // nothing is resolved and the whole client surface is unresolved).
  if (PROBE && unresolved.length) {
    heading(`3. Probing ${unresolved.length} RPC(s) by calling them`);
    console.log(
      "   Unauthenticated, every argument null. A function anon may not execute\n" +
        "   answers 42501 before its body runs; the rest reject the null arguments.\n",
    );
    const results = new Map();
    for (const name of unresolved) {
      const params = declared.get(name)?.params ?? [];
      const verdict = await probe(name, params);
      results.set(name, verdict);
      const tag = /^NOT FOUND|^AMBIGUOUS|^NETWORK/.test(verdict)
        ? FAIL
        : /^EXECUTED/.test(verdict)
          ? WARN
          : PASS;
      line(tag, `${name.padEnd(34)} ${verdict}`);
    }
    const bad = [...results.values()].filter((v) => /^NOT FOUND|^AMBIGUOUS/.test(v)).length;
    console.log(
      `\n   ${results.size - bad}/${results.size} resolved against the deployed database.`,
    );
  }

  finish();
}

function finish() {
  heading("Summary");
  console.log(`  ${failures} failure(s), ${warnings} warning(s)`);
  console.log(
    "\n  This does NOT cover: the SQL verification suites (need Docker,\n" +
      "  `npm run test:db`), Stripe webhook wiring — account.updated must be\n" +
      "  confirmed in the Stripe dashboard by eye, it is not reachable from\n" +
      "  an anon client — or anything requiring a signed-in session.",
  );
  // exitCode, not exit(): exit() with the fetch keep-alive socket still open
  // trips a libuv assertion on Windows. Let the loop drain naturally.
  process.exitCode = failures > 0 ? 1 : 0;
}

main().catch((err) => {
  console.error(`\npre-flight crashed: ${err.stack ?? err.message}`);
  console.error("\nIf this is a TLS error, re-run with NODE_OPTIONS=--use-system-ca");
  process.exit(2);
});

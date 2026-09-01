// WHAT:  Generates standalone /terms, /privacy and /safety HTML pages from
//        src/features/legal/lib/legalContent.ts — the SAME text the app shows —
//        ready to drop into the trackitdown.co.uk site.
//        Run: `npm run legal:export -- --operator "..." --contact "..."`
// WHY:   Both stores require a PUBLICLY REACHABLE privacy-policy URL; an in-app
//        screen does not satisfy it, which is why LEGAL_PUBLIC_URLS has sat
//        null and blocked submission. The documents themselves have existed in
//        full since August — this is a publishing job, not a drafting one.
//
//        ⚠️ GENERATED, NOT COPIED, AND THAT IS THE POINT. A hand-pasted copy on
//        the marketing site is a second source of truth for a document a user
//        legally agreed to, and this project's own review found eighteen places
//        where exactly that kind of duplicate had drifted. Re-run this after any
//        edit to legalContent.ts and the published page moves with the app.
//
//        ⚠️ REFUSES TO RUN WITHOUT --operator AND --contact, deliberately. A
//        published privacy policy has to name the DATA CONTROLLER and give a
//        contact route that works for a reader who has never installed the app.
//        The in-app text says "reach us from the Contact support link in your
//        profile", which is meaningless on the web — and today that link is
//        hidden anyway, because SUPPORT_EMAIL is still a placeholder. Making
//        these required arguments turns a footnote somebody would skip into a
//        thing that stops. See the KNOWN GAPS printed at the end of a run.
// LINKS: src/features/legal/lib/legalContent.ts (the source of truth);
//        src/shared/lib/legal.ts (LEGAL_PUBLIC_URLS — set it AFTER the pages
//          are live, never before: a store reviewer clicking a 404 is a
//          rejection, and worse than the honest null);
//        src/features/legal/README.md; docs/ROADMAP.md (Legal).

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT = new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');

/**
 * Reads a flag's value, JOINING every token up to the next `--flag`.
 *
 * ⚠️ NOT `argv[i + 1]`. `npm run legal:export -- --operator "A N Other Ltd"`
 * loses the quotes on the way through npm on Windows, so the entity name
 * arrives as three separate argv entries and a naive read silently generates a
 * policy naming "A". Silently, because "A" is a perfectly valid string.
 */
function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  if (i === -1) return null;
  const parts = [];
  for (let j = i + 1; j < process.argv.length && !process.argv[j].startsWith('--'); j++) {
    parts.push(process.argv[j]);
  }
  return parts.length ? parts.join(' ') : null;
}

const OPERATOR = arg('operator');
const CONTACT = arg('contact');
const OUT_DIR = arg('out') ?? join(ROOT, 'dist-legal');

if (!OPERATOR || !CONTACT) {
  console.error(`
Refusing to generate an incomplete privacy policy.

  --operator  the REGISTERED ENTITY that controls the data, not the brand.
              legalContent.ts hardcodes 'Trackitdown' with a comment saying
              "Replace with the registered entity before launch". A policy
              naming a brand does not identify a controller.

  --contact   an address a reader with no app can actually use. The in-app
              text points at a profile link, which does not exist on the web.

Example:
  npm run legal:export -- --operator "A N Other trading as Trackitdown" \\
                          --contact "support@trackitdown.co.uk"
`);
  process.exit(2);
}

// pathToFileURL, not the bare path: Node's ESM loader rejects a Windows
// absolute path as an unsupported 'c:' URL scheme.
const { LEGAL_DOCUMENTS } = await import(
  pathToFileURL(join(ROOT, 'src', 'features', 'legal', 'lib', 'legalContent.ts')).href
);

const escape = (s) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** A body line starting with "• " is a bullet — the same rule the app applies. */
function renderBody(lines) {
  const out = [];
  let bullets = [];
  const flush = () => {
    if (bullets.length) {
      out.push(`<ul>${bullets.map((b) => `<li>${escape(b)}</li>`).join('')}</ul>`);
      bullets = [];
    }
  };
  for (const line of lines) {
    if (line.startsWith('• ')) bullets.push(line.slice(2));
    else {
      flush();
      out.push(`<p>${escape(line)}</p>`);
    }
  }
  flush();
  return out.join('\n      ');
}

/**
 * The operator name is substituted at render time rather than edited into the
 * source: the app shows 'Trackitdown' to somebody who is already inside it and
 * knows who that is, while a published policy has to name the entity.
 */
const withOperator = (text) =>
  text.replace(/\bTrackitdown is the controller\b/, `${OPERATOR} is the controller`);

function page(doc) {
  const sections = doc.sections
    .map((s) => {
      // The web reader has no profile screen, so the in-app contact route is
      // replaced rather than published as-is.
      const body =
        s.heading === 'Contact'
          ? [`You can reach us at ${CONTACT}.`]
          : s.body;
      return `    <section>
      <h2>${escape(s.heading)}</h2>
      ${renderBody(body)}
    </section>`;
    })
    .join('\n');

  return `<!doctype html>
<html lang="en-GB">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escape(doc.title)} — Trackitdown</title>
<meta name="description" content="${escape(doc.title)} for Trackitdown.">
<style>
  :root { color-scheme: light dark; --ink:#14181d; --muted:#5c6570; --ground:#fff; --rule:#e6e9ee; }
  @media (prefers-color-scheme: dark) {
    :root { --ink:#e6e9ed; --muted:#a0a9b4; --ground:#12151a; --rule:#2e3540; }
  }
  * { box-sizing: border-box; }
  body {
    background: var(--ground); color: var(--ink); margin: 0;
    padding: clamp(2rem,6vw,4rem) clamp(1rem,5vw,2rem) 6rem;
    font: 17px/1.65 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
  }
  main { max-width: 44rem; margin: 0 auto; }
  h1 { font-size: clamp(1.9rem,5vw,2.6rem); line-height: 1.1; margin: 0 0 .4rem; letter-spacing: -.02em; }
  .updated { color: var(--muted); font-size: .9rem; margin: 0 0 2.5rem; }
  h2 { font-size: 1.15rem; margin: 2.5rem 0 .6rem; letter-spacing: -.01em; }
  p, li { margin: 0 0 .9rem; }
  ul { padding-left: 1.2rem; }
  .intro p { color: var(--muted); }
  footer { margin-top: 4rem; padding-top: 1.5rem; border-top: 1px solid var(--rule); color: var(--muted); font-size: .9rem; }
  a { color: inherit; }
</style>
</head>
<body>
<main>
  <h1>${escape(doc.title)}</h1>
  <p class="updated">Last updated ${escape(doc.lastUpdated)}</p>
  <div class="intro">
    ${renderBody(doc.intro.map(withOperator))}
  </div>
${sections}
  <footer>
    <p>${escape(OPERATOR)} · <a href="mailto:${escape(CONTACT)}">${escape(CONTACT)}</a></p>
  </footer>
</main>
</body>
</html>
`;
}

mkdirSync(OUT_DIR, { recursive: true });
for (const slug of Object.keys(LEGAL_DOCUMENTS)) {
  const file = join(OUT_DIR, `${slug}.html`);
  writeFileSync(file, page(LEGAL_DOCUMENTS[slug]), 'utf8');
  console.log(`wrote ${file}`);
}

console.log(`
Deploy these at trackitdown.co.uk/terms, /privacy and /safety, then set
LEGAL_PUBLIC_URLS in src/shared/lib/legal.ts — in that order, never before.

⚠️ KNOWN GAPS IN THE TEXT ITSELF, from legalContent.ts's own header. These are
   not formatting problems and publishing does not fix them:

   1. THE TERMS DO NOT MENTION THE £5 LISTING FEE. legalContent.ts:59 says so
      outright — ADR-0014 added a second pricing mode and the Terms still
      describe only the bounty. You would be charging for a product whose terms
      do not cover it.
   2. THE MONEY WORDING IS UNREVIEWED. The header flags whether the escrow
      arrangement needs FCA authorisation as "a question for a lawyer".
   3. THE LIABILITY WORDING IS UNREVIEWED against the Consumer Rights Act 2015
      — you cannot exclude liability for death or personal injury from
      negligence, and this product invites the public to look for stolen cars.
   4. ICO REGISTRATION likely applies and is not recorded as done.

   1 is a content edit and is squarely ours. 2-4 want a lawyer, and this is the
   point at which the file's header says to get one.
`);

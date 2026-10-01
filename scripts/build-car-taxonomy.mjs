// WHAT:  Builds src/shared/lib/carTaxonomy.generated.ts, the app's car make →
//        model list, from DfT's vehicle licensing statistics CSV:
//          node scripts/build-car-taxonomy.mjs path/to/df_VEH0120_UK.csv
//        `--report` prints each make's top models instead of writing, for
//        checking the labels by eye.
// WHY:   The list is bundled, not fetched: the picker opens instantly and
//        offline, and matching never depends on a network call. DfT refreshes
//        the file quarterly; re-run this against the new one. The download URL
//        changes every release, so take it from
//        https://www.gov.uk/government/statistical-data-sets/vehicle-licensing-statistics-data-files
//        (df_VEH0120_UK.csv). Only the generated file is committed, never the
//        ~40MB CSV.
//        Licence: Open Government Licence v3.0. The app credits it in the
//        legal pages (legalContent.ts).
// LINKS: scripts/carTaxonomy.mjs (the rules); src/shared/lib/carTaxonomy.generated.ts.

import { Buffer } from 'node:buffer';
import { createReadStream, writeFileSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';

import { buildTaxonomy, parseCsvLine } from './carTaxonomy.mjs';

const OUT = fileURLToPath(new URL('../src/shared/lib/carTaxonomy.generated.ts', import.meta.url));
const MAX_BYTES = 150_000;
/** Fewer makes than this means the CSV changed shape, not the UK's cars. */
const MIN_MAKES = 60;

async function main() {
  // Flags in any position: `--report path.csv` works as well as the reverse.
  const args = process.argv.slice(2);
  const flags = args.filter((arg) => arg.startsWith('--'));
  const csvPath = args.find((arg) => !arg.startsWith('--'));
  if (!csvPath) {
    console.error('Usage: node scripts/build-car-taxonomy.mjs <df_VEH0120_UK.csv> [--report]');
    process.exit(1);
  }
  const lines = createInterface({ input: createReadStream(csvPath), crlfDelay: Infinity });
  let header = null;
  const rows = [];
  let bodyCol = -1;
  for await (const line of lines) {
    if (header === null) {
      header = parseCsvLine(line.replace(/^\uFEFF/, ''));
      bodyCol = header.indexOf('BodyType');
    } else {
      // Keep only what buildTaxonomy reads; the rest (motorcycles, buses…)
      // would just cost memory.
      const fields = parseCsvLine(line);
      if (fields[bodyCol] === 'Cars' || fields[bodyCol] === 'Light goods vehicles') rows.push(fields);
    }
  }
  const taxonomy = buildTaxonomy(header, rows);

  if (flags.includes('--report')) {
    for (const make of taxonomy.makes) {
      const models = make.models.map((model) => model.label).join(', ');
      console.log(`${make.label} (${make.count}): ${models}`);
    }
    console.log(`\n${taxonomy.makes.length} makes, ${taxonomy.makes.reduce((n, m) => n + m.models.length, 0)} models`);
    return;
  }

  // ⚠️ A SANITY FLOOR before overwriting the committed list. If DfT renames a
  // body type, a licence status or the quarter headers, the build quietly
  // keeps nothing; better to stop here than to write an empty list.
  const labels = new Set(taxonomy.makes.map((make) => make.label));
  const missing = ['Ford', 'Volkswagen', 'Vauxhall', 'BMW'].filter((make) => !labels.has(make));
  if (taxonomy.makes.length < MIN_MAKES || missing.length > 0) {
    throw new Error(
      `Only ${taxonomy.makes.length} makes${missing.length ? `, missing ${missing.join(', ')}` : ''}: ` +
        'has the CSV format changed? Nothing written.',
    );
  }

  const source = renderModule(taxonomy);
  if (Buffer.byteLength(source) > MAX_BYTES) {
    throw new Error(`Generated list is ${Buffer.byteLength(source)} bytes, over ${MAX_BYTES}: raise the thresholds`);
  }
  writeFileSync(OUT, source);
  console.log(`Wrote ${OUT} (${taxonomy.makes.length} makes, ${Buffer.byteLength(source)} bytes)`);
}

/** Compact: one line per make, models as [label, count] pairs. */
function renderModule({ source, makes }) {
  const rows = makes
    .map((make) => {
      const models = make.models.map((m) => `[${JSON.stringify(m.label)}, ${m.count}]`).join(', ');
      return `  [${JSON.stringify(make.label)}, ${make.count}, [${models}]],`;
    })
    .join('\n');
  return `/**
 * WHAT:  GENERATED — do not edit. The UK car make → model list, with how many of
 *        each are licensed in the UK: [make, count, [[model, count], …]], makes
 *        and models both by count, most first.
 * WHY:   Built by scripts/build-car-taxonomy.mjs from DfT vehicle licensing
 *        statistics (${source}). Contains public sector information licensed
 *        under the Open Government Licence v3.0. To change a label, edit the
 *        tables in scripts/carTaxonomy.mjs and re-run; never edit this file.
 * LINKS: scripts/build-car-taxonomy.mjs; src/shared/lib/carMakes.ts;
 *        src/shared/lib/carModels.ts.
 */

export const CAR_TAXONOMY_SOURCE = ${JSON.stringify(source)};

export const CAR_TAXONOMY: readonly (readonly [string, number, readonly (readonly [string, number])[]])[] = [
${rows}
];
`;
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

// WHAT:  The pure half of the car make/model list build: parse DfT's CSV rows,
//        fold them into make → model counts, and turn DfT's upper-case names
//        ("MERCEDES", "BMW 3 SERIES", "VOLKSWAGEN ID3") into the labels the app
//        shows and stores ("Mercedes-Benz", "3 Series", "ID.3"). No I/O, so the
//        build script and its node tests share it.
// WHY:   The list comes from DfT's vehicle licensing statistics (df_VEH0120_UK,
//        Open Government Licence v3.0), not AutoTrader's: their terms forbid
//        reuse and UK database right protects their curated list (owner's
//        call, 2026-09-30). DfT counts every car licensed in the UK, so it also
//        tells us which makes and models are POPULAR, which is what the picker
//        ranks by.
//        ⚠️ LABELS ARE STORED VALUES. posts.make / posts.model, the garage and
//        alerts all keep the label as typed-or-picked, and search and alerts
//        match on it. So a label that changes breaks every row that has the old
//        one. The overrides below keep the labels the app already used
//        ("Mercedes-Benz", "Škoda", "C-Class", "Range Rover Evoque"), and
//        src/shared/lib/carTaxonomy.test.ts pins them.
//        The rules do the common case; the override tables are for names no
//        rule gets right. Add to the tables, never special-case in the rules.
// LINKS: scripts/build-car-taxonomy.mjs (the CLI); scripts/carTaxonomy.test.mjs;
//        src/shared/lib/carTaxonomy.generated.ts (the output);
//        src/shared/lib/carMakes.ts, carModels.ts (the consumers).

/** Cars with at least this many licensed in the UK make the list. */
export const MIN_MAKE_COUNT = 1000;
/** A model needs at least this many licensed to be listed under its make... */
export const MIN_MODEL_COUNT = 200;
/** ...or be one of its make's top few with at least this many, so a small
 *  make (Cadillac: Escalade 105, CTS 60) still has a list to pick from. */
export const MIN_TOP_MODEL_COUNT = 50;
export const TOP_MODELS_KEPT = 5;

/**
 * Models DfT doesn't name: every Austin-Healey and nearly every Caterham is
 * "MODEL MISSING" there. Well-known model names are facts, so a short list is
 * added by hand rather than leaving the make with a free-text box.
 */
export const EXTRA_MODELS = {
  'Austin-Healey': ['100', '3000', 'Sprite'],
  Caterham: ['Seven', '21'],
  // DfT names MINIs by trim (Cooper, One); owners also say what they are.
  // The app offered these before the DfT list, so rows already store them.
  MINI: ['Hatch', 'Convertible', 'Electric'],
};

/**
 * Vans and pick-ups (DfT "Light goods vehicles") are stolen too, and the app
 * always offered some (Transit, Ranger, Navara). The common ones are listed
 * for makes already on the list, after the cars: ranked at 0, so "Popular Ford
 * models" stays Fiesta and Focus, not Transit Custom.
 */
export const MIN_VAN_MODEL_COUNT = 2000;

/**
 * DfT GenModels that hide a model people name separately, split out by the
 * detailed Model column: [make label, GenModel (make stripped), pattern, label].
 */
export const MODEL_SPLITS = [
  ['Land Rover', 'DISCOVERY', /^DISCO(VERY|-Y) SPORT\b/, 'Discovery Sport'],
];

/** DfT make → the label the app stores. Anything absent is title-cased. */
export const MAKE_LABELS = {
  MERCEDES: 'Mercedes-Benz',
  'MERCEDES-BENZ': 'Mercedes-Benz',
  SKODA: 'Škoda',
  CITROEN: 'Citroën',
  BMW: 'BMW',
  MINI: 'MINI',
  MG: 'MG',
  SEAT: 'SEAT',
  DS: 'DS',
  BYD: 'BYD',
  KGM: 'KGM',
  TVR: 'TVR',
  ORA: 'ORA',
  XPENG: 'XPENG',
  INEOS: 'INEOS',
  MCLAREN: 'McLaren',
  SSANGYONG: 'SsangYong',
  'ROLLS ROYCE': 'Rolls-Royce',
  'CHEVROLET GMC': 'Chevrolet',
  'AUSTIN-MORRIS': 'Austin',
  'ALFA ROMEO': 'Alfa Romeo',
  'ASTON MARTIN': 'Aston Martin',
  'LAND ROVER': 'Land Rover',
  'AUSTIN HEALEY': 'Austin-Healey',
  'LEYLAND CARS': 'Leyland',
  // MCC built the first Smarts: one make to the people who own them.
  MCC: 'Smart',
};

/** DfT makes that aren't a make. */
export const EXCLUDED_MAKES = new Set(['OTHER BRITISH', 'MISSING', 'MAKE MISSING']);

/**
 * Per-make model labels no rule gets right, keyed by the DfT GenModel with the
 * make stripped (upper case). `null` drops the model.
 */
export const MODEL_LABELS = {
  // Conversion builders (wheelchair-accessible and similar) that DfT files as
  // models of the base car. They aren't models anyone would pick.
  // Motorhome converters, filed as models of the base van, likewise.
  '*': {
    ALLIED: null, INDEPENDENCE: null, FREEDOM: null, 'ALLIED VENTURE': null,
    'ROLLER TEAM': null, 'AUTO TRAIL': null, ELDDIS: null, ADRIA: null,
    'MOTOR CARAVAN': null,
  },
  BMW: {
    I3: 'i3', I4: 'i4', I5: 'i5', I7: 'i7', I8: 'i8',
    IX: 'iX', IX1: 'iX1', IX2: 'iX2', IX3: 'iX3', XM: 'XM',
    'ALPINA B3': 'Alpina B3', 'M ROADSTER': 'M Roadster', 'M COUPE': 'M Coupe',
    'Z4 M': 'Z4 M', 'X3 M': 'X3 M', 'X4 M': 'X4 M', 'X5 M': 'X5 M', 'X6 M': 'X6 M',
    '1 SERIES M': '1 Series M',
  },
  'Mercedes-Benz': {
    'AMG CLASS': 'AMG', 'AMG GT CLASS': 'AMG GT', 'AMG G CLASS': 'AMG G-Class',
    'AMG C CLASS': 'AMG C-Class', 'AMG GLC CLASS': 'AMG GLC', 'AMG GLE CLASS': 'AMG GLE',
    VITO: 'Vito', EVITO: 'eVito',
  },
  Volkswagen: {
    ID3: 'ID.3', ID4: 'ID.4', ID5: 'ID.5', ID7: 'ID.7', 'ID BUZZ': 'ID. Buzz',
    UP: 'Up', CC: 'CC', LT: 'LT',
    URBAN: 'Fox', // "Urban Fox" is a trim of the Fox
    // Van weight classes, not models.
    '800': null, '1000': null,
  },
  // A Swift under Ford or Fiat is the motorhome converter; Suzuki's is a car.
  Fiat: { SWIFT: null },
  Isuzu: { 'D-MAX V-CROSS': 'D-Max' },
  Toyota: { 'C-HR': 'C-HR', RAV4: 'RAV4', BZ4X: 'bZ4X', IQ: 'iQ', PROACE: 'Proace' },
  Ford: { ECOSPORT: 'EcoSport', 'KA+': 'Ka+', STREETKA: 'StreetKa', SWIFT: null },
  Vauxhall: { VX: 'VX' },
  Audi: { 'E-TRON': 'e-tron', TTRS: 'TT RS' },
  Hyundai: {
    I10: 'i10', I20: 'i20', I30: 'i30', I40: 'i40', I800: 'i800',
    IX20: 'ix20', IX35: 'ix35',
  },
  Honda: { E: 'e', 'FR-V': 'FR-V', 'ZR-V SPORT': 'ZR-V' },
  'Citroën': {
    AX: 'AX', BX: 'BX', ZX: 'ZX', 'E-C3': 'ë-C3', 'E-C4': 'ë-C4', 'E-C5': 'ë-C5',
    'E-BERLINGO': 'ë-Berlingo', '2CV': '2CV', 'C-CROSSER': 'C-Crosser',
  },
  Renault: { 'GRD MODUS': 'Grand Modus' },
  MG: {
    TF: 'TF', MGF: 'MGF', ZT: 'ZT', 'TD/TF': 'TD/TF', A: 'MGA', B: 'MGB', C: 'MGC',
  },
  Jaguar: {
    'XF SERIES': 'XF', 'XE SERIES': 'XE', 'XJ SERIES': 'XJ', 'XK SERIES': 'XK',
    'X TYPE': 'X-Type', 'S TYPE': 'S-Type', 'E TYPE': 'E-Type', 'MK II': 'Mk II',
    'F-PACE': 'F-PACE', 'E-PACE': 'E-PACE', 'I-PACE': 'I-PACE',
  },
  Lexus: { RZ: 'RZ', SC: 'SC' },
  Subaru: { XV: 'XV', WRX: 'WRX', BRZ: 'BRZ' },
  'Alfa Romeo': { MITO: 'MiTo', GTV: 'GTV' },
  Omoda: {
    '5 NOBLE AUTO': '5', '5 KNIGHT AUTO': '5', '5 COMFORT AUTO': '5',
    'E5 COMFORT': 'E5', 'E5 KNIGHT': 'E5', '9 NOBLE PHEV AUTO': '9',
  },
  MINI: { GT: null }, // a trim, not a model
  Smart: {
    SMART: 'Fortwo', '1': '#1', '3': '#3', '5': '#5',
    FORTWO: 'Fortwo', FORFOUR: 'Forfour',
  },
  Suzuki: { SX: 'SX4', 'E VITARA': 'e Vitara' },
  Kia: { XCEED: 'XCeed', PROCEED: 'ProCeed', 'PRO CEED': 'ProCeed' },
  Nissan: { '350': '350Z', '370': '370Z', '200': '200SX', '300': '300ZX' },
  Peugeot: { ION: 'iOn' },
  DS: { DS3: 'DS 3', DS4: 'DS 4', DS5: 'DS 5', DS7: 'DS 7', DS9: 'DS 9' },
  Cadillac: { BLS: 'BLS', CTS: 'CTS' },
  'Aston Martin': { DBX: 'DBX', DBS: 'DBS' },
  Chrysler: { 'PT CRUISER': 'PT Cruiser' },
  Maserati: { GRANTURISMO: 'GranTurismo', 'GRAN TURISMO': 'GranTurismo', GRANCABRIO: 'GranCabrio' },
  Daimler: { 'SP 250': 'SP250' },
  KGM: { 'TORRES K40': 'Torres', 'ACTYON K50 AUTO': 'Actyon' },
  ORA: { '03 PURE +': '03', '03 PRO +': '03' },
  XPENG: { 'G6 LONG RANGE': 'G6', 'G6 STANDARD RANGE': 'G6' },
  Jensen: { FF: 'FF' },
  Datsun: { '240': '240Z', '260': '260Z', '280': '280ZX' },
  // "HEALEY" under Austin is the Austin-Healey (its own make here); the late
  // Sprites really were badged Austin, so SPRITE stays.
  Austin: { HEALEY: null },
  Lotus: { 'EMIRA V6': 'Emira' },
  Ferrari: { '12CILINDRI': '12Cilindri', FF: 'FF' },
};

/** Words kept upper-case wherever they appear in a model name. */
const UPPER_WORDS = new Set([
  'GT', 'GTI', 'GTS', 'GTE', 'RS', 'SUV', 'EV', 'AMG', 'SVR', 'SRT', 'TT', 'TTS',
  'RCZ', 'MX', 'CX', 'HR', 'CR', 'ZR', 'BR', 'WR', 'SX', 'XJ', 'XK', 'XF', 'XE',
  'DS', 'CLA', 'CLS', 'CLK', 'CLC', 'GLA', 'GLB', 'GLC', 'GLE', 'GLS', 'GL', 'SLK',
  'SLC', 'SL', 'SLS', 'ML', 'EQA', 'EQB', 'EQC', 'EQE', 'EQS', 'EQV', 'CL', 'CLE',
  'MR2', 'GTO', 'NSX', 'JCW', 'UX', 'NX', 'RX', 'LS', 'IS', 'ES', 'CT', 'RC', 'LC',
  'LBX', 'GR', 'XC', 'ZS', 'HS', 'SE', 'GS', 'MG', 'ASX', 'EX', 'MPV',
]);

/** Parse one CSV line: commas, double-quoted fields, "" as an escaped quote. */
export function parseCsvLine(line) {
  const fields = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    if (quoted) {
      if (char === '"' && line[i + 1] === '"') {
        field += '"';
        i += 1;
      } else if (char === '"') {
        quoted = false;
      } else {
        field += char;
      }
    } else if (char === '"') {
      quoted = true;
    } else if (char === ',') {
      fields.push(field);
      field = '';
    } else {
      field += char;
    }
  }
  fields.push(field);
  return fields;
}

/** "ALFA ROMEO" → "Alfa Romeo", unless MAKE_LABELS says otherwise. */
export function makeLabel(dftMake) {
  const key = dftMake.trim().toUpperCase();
  return MAKE_LABELS[key] ?? titleWords(key);
}

/** A model name as the app shows it, from DfT's GenModel for that make. */
export function modelLabel(dftMake, genModel, label = makeLabel(dftMake)) {
  const make = dftMake.trim().toUpperCase();
  let name = genModel.trim().toUpperCase();
  // "ROLLS ROYCE" as its own model is DfT's make-only row, not a model.
  if (name === make) return null;
  if (name.startsWith(`${make} `)) name = name.slice(make.length + 1);
  for (const overrides of [MODEL_LABELS[label] ?? {}, MODEL_LABELS['*']]) {
    if (Object.prototype.hasOwnProperty.call(overrides, name)) return overrides[name];
  }
  if (/\bMISSING\b/.test(name) || name === 'OTHER' || name === '') return null;
  // Mercedes-style classes: "A CLASS" → "A-Class", "GLA CLASS" → "GLA".
  const cls = /^([A-Z]{1,3}) CLASS$/.exec(name);
  if (cls) return cls[1].length === 1 ? `${cls[1]}-Class` : cls[1];
  return titleWords(name);
}

/** Title-case word by word, hyphen parts too; digits and short codes upper. */
function titleWords(value) {
  return value
    .split(' ')
    .map((word) => word.split('-').map(titlePart).join('-'))
    .join(' ');
}

function titlePart(part) {
  if (part === '') return part;
  if (UPPER_WORDS.has(part)) return part;
  if (/\d/.test(part)) return part; // X5, 208, RAV4, V40
  if (part.length === 1) return part; // the T in T-Roc
  return part.charAt(0) + part.slice(1).toLowerCase();
}

/**
 * Fold DfT rows into the list: `rows` yields parsed CSV fields after the
 * header. Returns makes by UK count, each with its models by count.
 */
export function buildTaxonomy(header, rows) {
  const col = (name) => {
    const index = header.indexOf(name);
    if (index < 0) throw new Error(`CSV has no "${name}" column`);
    return index;
  };
  const body = col('BodyType');
  const makeCol = col('Make');
  const genCol = col('GenModel');
  const modelCol = col('Model');
  const statusCol = col('LicenceStatus');
  // The latest quarter column, by its name rather than its position.
  const quarters = header
    .map((name, index) => ({ name, index }))
    .filter(({ name }) => /^\d{4} Q[1-4]$/.test(name));
  if (quarters.length === 0) throw new Error('CSV has no quarter columns');
  const latest = quarters.reduce((best, q) => (q.name > best.name ? q : best)).index;

  const makes = new Map(); // label → { count, models, vans: Map(label → count) }
  for (const fields of rows) {
    const isCar = fields[body] === 'Cars';
    const isVan = fields[body] === 'Light goods vehicles';
    if ((!isCar && !isVan) || fields[statusCol] !== 'Licensed') continue;
    const dftMake = fields[makeCol].trim().toUpperCase();
    if (EXCLUDED_MAKES.has(dftMake) || /\bMISSING\b/.test(dftMake)) continue;
    const count = Number(fields[latest]) || 0;
    if (count === 0) continue;
    const label = makeLabel(dftMake);
    const entry = makes.get(label) ?? { count: 0, models: new Map(), vans: new Map() };
    const model = splitModel(label, dftMake, fields[genCol], fields[modelCol]);
    if (isCar) {
      // Only cars decide whether a make is listed, and how models rank.
      entry.count += count;
      if (model) entry.models.set(model, (entry.models.get(model) ?? 0) + count);
    } else if (model) {
      entry.vans.set(model, (entry.vans.get(model) ?? 0) + count);
    }
    makes.set(label, entry);
  }

  const list = [...makes.entries()]
    .filter(([, entry]) => entry.count >= MIN_MAKE_COUNT)
    .map(([label, entry]) => {
      const ranked = [...entry.models.entries()]
        .map(([model, count]) => ({ label: model, count }))
        .sort(byCountThenLabel);
      const models = ranked.filter(
        (model, index) =>
          model.count >= MIN_MODEL_COUNT ||
          (index < TOP_MODELS_KEPT && model.count >= MIN_TOP_MODEL_COUNT),
      );
      // Common vans and pick-ups, then the hand-added names: listed after the
      // counted cars at 0, so they're offered but never "popular".
      const vans = [...entry.vans.entries()]
        .filter(([, count]) => count >= MIN_VAN_MODEL_COUNT)
        .sort((a, b) => b[1] - a[1])
        .map(([model]) => model);
      for (const extra of [...vans, ...(EXTRA_MODELS[label] ?? [])]) {
        if (!models.some((model) => model.label === extra)) models.push({ label: extra, count: 0 });
      }
      return { label, count: entry.count, models };
    })
    .sort(byCountThenLabel);
  return { source: `DfT VEH0120 ${header[latest]}`, makes: list };
}

/** The model label, after any MODEL_SPLITS rule on the detailed Model name. */
function splitModel(label, dftMake, genModel, detailed) {
  const base = modelLabel(dftMake, genModel, label);
  const make = dftMake.trim().toUpperCase();
  let gen = genModel.trim().toUpperCase();
  if (gen.startsWith(`${make} `)) gen = gen.slice(make.length + 1);
  for (const [splitMake, splitGen, pattern, splitLabel] of MODEL_SPLITS) {
    if (splitMake === label && splitGen === gen && pattern.test(detailed.trim().toUpperCase())) {
      return splitLabel;
    }
  }
  return base;
}

function byCountThenLabel(a, b) {
  return b.count - a.count || a.label.localeCompare(b.label);
}

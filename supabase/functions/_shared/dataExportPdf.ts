/**
 * WHAT:  dataExportPdf — lays out the data export (buildDataExport's object)
 *        as a readable PDF: the logo on every page, a short intro, a link to
 *        the machine-readable copy, then one section per kind of data that has
 *        something in it — label/value rows, dates in UK format, pence as
 *        pounds, codes as words, photos as tappable links — and the empty ones
 *        named together at the end ("Nothing to show"). Owner, 2026-10-26:
 *        "Not included" out, more readable, the logo in the corner.
 * WHY:   Owner, 2026-10-23: phones can't open JSON without another app, so
 *        the download is a PDF every phone opens. The JSON stays — linked from
 *        page 1 — for moving data to another service (Art. 20 portability).
 *
 *        Reads ONLY what buildDataExport already chose (and anonymised): this
 *        is presentation, not a second place deciding what goes in. Ids are
 *        left out of the PDF (they mean nothing to a person); the JSON keeps
 *        them.
 * LINKS: ./dataExport.ts (what goes in); ./pdfDocument.ts (the writer);
 *        ./dataExportPdf.test.ts; ../export-my-data/index.ts.
 */

import { renderPdf, type PdfBlock, type PdfLine, type PdfRow } from './pdfDocument.ts';

type Value = unknown;
type Obj = Record<string, Value>;

const isObj = (v: Value): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);

const LONDON = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Europe/London',
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
});
const LONDON_DAY = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Europe/London',
  day: 'numeric',
  month: 'short',
  year: 'numeric',
});

/** "21 Oct 2026, 10:00" for a timestamp, "21 Oct 2026" for a date. */
export function formatDate(value: string): string {
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return LONDON_DAY.format(new Date(`${value}T12:00:00Z`));
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : LONDON.format(date);
}

const ISO = /^\d{4}-\d{2}-\d{2}(T|$)/;

/** Labels people read, where the column name isn't one. */
const LABELS: Record<string, string> = {
  first_name: 'First name',
  display_name: 'Display name',
  sightings_reported: 'Sightings reported',
  sightings_helpful: 'Sightings marked helpful',
  recoveries_credited: 'Recoveries credited',
  bounty_amount_pence: 'Reward',
  listing_fee_pence: 'Listing fee',
  amount_pence: 'Amount',
  transfer_amount_pence: 'Paid out',
  platform_fee_pence: 'Our fee',
  refunded_amount_pence: 'Refunded',
  last_payout_amount_pence: 'Last payout',
  min_bounty_pence: 'Minimum reward',
  last_seen_at: 'Last seen',
  last_seen_area: 'Last seen area',
  last_seen_locality: 'Last seen locality',
  last_seen_point: 'Last seen location',
  radius_m: 'Radius',
  recency_days: 'Within days',
  bank_last4: 'Bank account ending',
  onboarding_complete: 'Set up',
  payouts_enabled: 'Payouts on',
  you_are: 'You are the',
  created_at: 'Created',
  updated_at: 'Updated',
  read_at: 'Read',
  captured_at: 'Taken',
  released_at: 'Paid out',
  refunded_at: 'Refunded',
  term_ends_at: 'Reward term ends',
  resolved_at: 'Resolved',
  expires_at: 'Ends',
  account_created_at: 'Account created',
  last_sign_in_at: 'Last sign-in',
  providers: 'Sign-in methods',
  area_label: 'Area',
  desc_recognise: 'How to recognise it',
  desc_drives: 'How it drives',
};

/** Fields that hold a code ("listing_fee", "collected"): shown as words. */
const CODE_KEYS = new Set([
  'status',
  'kind',
  'role',
  'reason',
  'target_type',
  'platform',
  'providers',
  'severity',
  'frequency',
  'direction',
  'exit_path',
  'body_type',
  'colour_finish',
  'parked_likelihood',
  'people_presence',
  'context_flags',
  'damage_kinds',
  'missing_parts',
  'withdraw_reason',
  'last_payout_status',
  'you_are',
]);
const CODE = /^[a-z0-9]+(_[a-z0-9]+)*$/;

/** "listing_fee" → "Listing fee". Only a value shaped like a code changes —
 *  free text (a name, a note) is never touched — and an unknown code still
 *  reads (the database is ahead of this list at times). */
export function humanise(value: string): string {
  if (!CODE.test(value)) return value;
  const words = value.replace(/_/g, ' ');
  return words.charAt(0).toUpperCase() + words.slice(1);
}

const isRow = (block: PdfBlock): block is PdfRow => 'kind' in block && block.kind === 'row';

/** Ids mean nothing to a person (the JSON copy keeps them). */
const isIdKey = (key: string) => key === 'id' || key.endsWith('_id') || key.endsWith('_ids');

function label(key: string): string {
  if (LABELS[key]) return LABELS[key];
  const words = key.replace(/_/g, ' ');
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** A value as words, or null to leave the line out (empty, an id). */
export function formatValue(key: string, value: Value): string | null {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (typeof value === 'number') {
    if (key.endsWith('_pence')) return `£${(value / 100).toFixed(2)}`;
    if (key === 'radius_m') return `${Math.round(value / 100) / 10} km`;
    return String(value);
  }
  if (typeof value === 'string') {
    if (ISO.test(value)) return formatDate(value);
    return CODE_KEYS.has(key) ? humanise(value) : value;
  }
  if (Array.isArray(value)) {
    // A list of codes (damage kinds, sign-in methods) reads as words too.
    const itemKey = CODE_KEYS.has(key) ? key : '';
    const parts = value.map((v) => formatValue(itemKey, v)).filter((v): v is string => v !== null);
    return parts.length ? parts.join(', ') : null;
  }
  if (isObj(value)) {
    if ('lat' in value && 'lng' in value) return `${value.lat}, ${value.lng}`;
    const parts = Object.entries(value)
      .map(([k, v]) => {
        const text = formatValue(k, v);
        return text === null ? null : `${label(k)}: ${text}`;
      })
      .filter((v): v is string => v !== null);
    return parts.length ? parts.join('; ') : null;
  }
  return String(value);
}

// --- block builders -----------------------------------------------------------

const heading = (text: string): PdfLine => ({
  text,
  font: 'bold',
  size: 17,
  gapBefore: 22,
  rule: true,
});
const subheading = (text: string): PdfLine => ({ text, font: 'bold', size: 13, gapBefore: 12 });
const row = (label: string, value: string, link?: string): PdfRow => ({
  kind: 'row',
  label,
  value,
  link,
});

/** Label/value rows for an object's fields (nested lists handled by the
 *  caller), skipping ids and empties. */
function fields(obj: Obj | null, skip: readonly string[] = []): PdfBlock[] {
  if (!obj) return [];
  const rows: PdfBlock[] = [];
  for (const [key, value] of Object.entries(obj)) {
    if (isIdKey(key) || skip.includes(key)) continue;
    if (Array.isArray(value) && value.some(isObj)) continue; // lists render as blocks
    const text = formatValue(key, value);
    if (text !== null) rows.push(row(label(key), text));
  }
  return rows;
}

/** "Photos  Photo 1 / Photo 2…" — the label once, each link on its own line. */
const linkRows = (urls: Value, labelText: string, name: string): PdfBlock[] =>
  (Array.isArray(urls) ? urls : [])
    .filter((u): u is string => typeof u === 'string' && u.length > 0)
    .map((url, i) => row(i === 0 ? labelText : '', `${name} ${i + 1}`, url));

const mapRows = (point: Value): PdfBlock[] =>
  isObj(point) && typeof point.lat === 'number' && typeof point.lng === 'number'
    ? [
        row('Last seen location', `${point.lat}, ${point.lng}`),
        row('', 'Open on a map', `https://www.google.com/maps?q=${point.lat},${point.lng}`),
      ]
    : [];

const list = (value: Value): Obj[] => (Array.isArray(value) ? value.filter(isObj) : []);

/** Each item's fields, under its own subheading or a little apart. */
function items(
  entries: Obj[],
  itemTitle?: (item: Obj, i: number) => string,
  /** Fields the title already says. */
  skip: readonly string[] = [],
): PdfBlock[] {
  const blocks: PdfBlock[] = [];
  entries.forEach((item, i) => {
    if (itemTitle) blocks.push(subheading(itemTitle(item, i)));
    const rows = fields(item, skip);
    if (!itemTitle && i > 0 && rows[0]) rows[0] = { ...rows[0], gapBefore: 12 };
    blocks.push(...rows);
  });
  return blocks;
}

const vehicleName = (v: Obj) =>
  [v.plate, v.make, v.model].filter((p) => typeof p === 'string' && p).join(' · ') || 'Car';

const distinctive = (features: Value): PdfBlock[] =>
  list(features).flatMap((feature) => [
    row('Distinctive', String(feature.description ?? '')),
    ...(typeof feature.photo_url === 'string' ? [row('', 'Photo', feature.photo_url)] : []),
  ]);

const joined = (...parts: Value[]) =>
  parts.filter((p): p is string => typeof p === 'string' && p.length > 0).join(' · ');

// --- the document -------------------------------------------------------------

/** The JSON copy's signed link and when it stops working. */
export interface MachineReadableCopy {
  url: string;
  expiresAt: string;
}

export function dataExportPdfLines(data: Obj, machineReadable: MachineReadableCopy): PdfBlock[] {
  const about = isObj(data.about) ? data.about : {};
  const blocks: PdfBlock[] = [
    { text: 'Your data', font: 'bold', size: 24 },
    {
      text: `Made ${typeof about.generated_at === 'string' ? formatDate(about.generated_at) : ''}`,
      tone: 'muted',
      gapBefore: 2,
    },
  ];
  // What's withheld and why stays in the JSON copy's `about` (and RECORD_OF_
  // PROCESSING §4.20) — the owner took the "Not included" list out of the PDF.
  for (const key of ['what_this_is', 'photos', 'your_rights', 'delete_your_account'] as const) {
    if (typeof about[key] === 'string') {
      // The JSON's line is only the path; the PDF says what it's for.
      const text =
        key === 'delete_your_account'
          ? `To delete your account: ${about[key] as string}`
          : (about[key] as string);
      blocks.push({ text, gapBefore: key === 'what_this_is' ? 14 : 6 });
    }
  }
  blocks.push(
    subheading('Machine-readable copy'),
    { text: 'Download the same data as a file (JSON)', link: machineReadable.url, gapBefore: 2 },
    {
      // The time, not "24 hours": a PDF re-sent later in the day has less left.
      text: `For moving it to another service. The link works until ${formatDate(machineReadable.expiresAt)}.`,
      tone: 'muted',
      gapBefore: 2,
    },
  );

  // Sections with something in them get a heading; the empty ones are named
  // together at the end (owner's pick, 2026-10-26) — short, but the reader
  // still sees every kind of data was looked at.
  const empty: string[] = [];
  const section = (title: string, body: PdfBlock[]) => {
    if (body.length) blocks.push(heading(title), ...body);
    else empty.push(title);
  };

  // Account.
  const account = isObj(data.account) ? data.account : {};
  section('Your account', [
    ...fields(account, ['sign_in', 'avatar']),
    ...(isObj(account.sign_in) ? fields(account.sign_in) : []),
    ...(typeof account.avatar === 'string' ? [row('Your photo', 'Open', account.avatar)] : []),
  ]);

  // Listings.
  section(
    'Your listings',
    list(data.listings).flatMap((listing) => {
      const sightings = list(listing.sightings_from_others);
      const features = formatValue(
        'features',
        Array.isArray(listing.features)
          ? listing.features.map((f) => (typeof f === 'string' ? humanise(f) : f))
          : listing.features,
      );
      return [
        subheading(vehicleName(listing)),
        // Plate, make and model are the heading already.
        ...fields(listing, ['photos', 'features', 'last_seen_point', 'plate', 'make', 'model']),
        ...mapRows(listing.last_seen_point),
        ...(features ? [row('Features', features)] : []),
        ...linkRows(listing.photos, 'Photos', 'Photo'),
        ...distinctive(listing.distinctive_features),
        ...(sightings.length
          ? [
              {
                text: `Sightings from others (${sightings.length})`,
                font: 'bold',
                gapBefore: 10,
              } as PdfLine,
              ...sightings.flatMap((s) => [
                row(
                  formatValue('created_at', s.created_at) ?? '',
                  joined(s.area_label, formatValue('status', s.status)) || 'Sighting',
                ),
                ...fields(s, ['created_at', 'area_label', 'status']).map((r) =>
                  // Their details sit under the sighting's own line.
                  isRow(r) ? { ...r, gapBefore: 0 } : r,
                ),
              ]),
            ]
          : []),
      ];
    }),
  );

  // Garage.
  section(
    'Your garage',
    list(data.garage).flatMap((vehicle) => [
      subheading(vehicleName(vehicle)),
      ...fields(vehicle, ['photos', 'plate', 'make', 'model']),
      ...linkRows(vehicle.photos, 'Photos', 'Photo'),
      ...distinctive(vehicle.distinctive_features),
    ]),
  );

  // Sightings they reported.
  section(
    'Sightings you reported',
    list(data.sightings_you_reported).flatMap((s) => [
      subheading(joined(formatValue('created_at', s.created_at), s.area_label) || 'Sighting'),
      ...fields(s, ['created_at', 'area_label']),
      ...linkRows(
        list(s.photos).map((p) => p.url),
        'Photos',
        'Photo',
      ),
    ]),
  );

  // Conversations — the other person stays "Other person".
  section(
    'Conversations',
    list(data.conversations).flatMap((c, i) => [
      subheading(`Conversation ${i + 1}${c.you_are ? ` — you were the ${c.you_are}` : ''}`),
      ...list(c.messages).flatMap((m): PdfBlock[] => [
        {
          text: joined(
            m.from === 'you' ? 'You' : 'Other person',
            typeof m.sent_at === 'string' ? formatDate(m.sent_at) : '',
          ),
          tone: 'muted',
          size: 11,
          gapBefore: 8,
        },
        ...String(m.text ?? '')
          .split('\n')
          .map((para): PdfLine => ({ text: para, gapBefore: 1 })),
      ]),
    ]),
  );

  // Watchlist.
  const watchlist = isObj(data.watchlist) ? data.watchlist : {};
  const collections = list(watchlist.collections);
  const saved = list(watchlist.saved_listings);
  section('Watchlist', [
    ...(collections.length
      ? [row('Collections', joined(...collections.map((c) => c.name)).replace(/ · /g, ', '))]
      : []),
    ...(saved.length ? [row('Saved listings', String(saved.length))] : []),
  ]);

  section(
    'Alert areas',
    items(list(data.alert_areas), (a) => String(a.name ?? 'Alert area')),
  );

  // Notifications: the time beside what it said.
  section(
    'Notifications',
    list(data.notifications).map((n) =>
      row(
        typeof n.created_at === 'string' ? formatDate(n.created_at) : '',
        [n.title, n.body].filter(Boolean).join(' — '),
      ),
    ),
  );
  section(
    'Notification settings',
    isObj(data.notification_settings) ? fields(data.notification_settings) : [],
  );

  // Payments.
  section(
    'Payments',
    items(
      list(data.payments),
      (p) =>
        joined(
          formatValue('created_at', p.created_at),
          p.role === 'received' ? 'Paid to you' : 'You paid',
          formatValue('amount_pence', p.amount_pence),
        ),
      // The title says when, which way and how much.
      ['created_at', 'role', 'amount_pence'],
    ),
  );
  section('Payout account', isObj(data.payout_account) ? fields(data.payout_account) : []);

  const disputes = isObj(data.disputes) ? data.disputes : {};
  section('Refund holds', items(list(data.refund_holds)));
  section('Disputes you raised', items(list(disputes.you_raised)));
  section('Disputes on your listings', items(list(disputes.on_your_listings)));
  section('Reports you made', items(list(data.reports_you_made)));
  section('People you blocked', items(list(data.people_you_blocked)));

  // Bug reports.
  section(
    'Bug reports',
    list(data.bug_reports).flatMap((bug) => [
      subheading(typeof bug.created_at === 'string' ? formatDate(bug.created_at) : 'Bug report'),
      ...fields(bug, ['created_at', 'screenshots', 'breadcrumbs']),
      ...linkRows(bug.screenshots, 'Screenshots', 'Screenshot'),
    ]),
  );

  section('Devices', items(list(data.devices)));
  section('Verification documents', items(list(data.verification_documents)));

  if (empty.length) {
    blocks.push(heading('Nothing to show'), {
      text: empty.join(' · '),
      tone: 'muted',
      gapBefore: 2,
    });
  }
  return blocks;
}

/** The PDF's bytes: every page headed with the logo and "Trackitdown". */
export function renderDataExportPdf(data: Obj, machineReadable: MachineReadableCopy): Uint8Array {
  return renderPdf(dataExportPdfLines(data, machineReadable), {
    title: 'Your Trackitdown data',
    header: 'Trackitdown',
  });
}

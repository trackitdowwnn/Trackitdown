/**
 * WHAT:  dataExportPdf — lays out the data export (buildDataExport's object)
 *        as a readable PDF: a title page explaining what it is and what isn't
 *        in it, a link to the machine-readable copy, then one section per kind
 *        of data — listings, sightings, conversations, payments… — with dates
 *        in UK format, pence as pounds, photos as tappable links.
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

import { renderPdf, type PdfLine } from './pdfDocument.ts';

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
  if (typeof value === 'string') return ISO.test(value) ? formatDate(value) : value;
  if (Array.isArray(value)) {
    const parts = value.map((v) => formatValue('', v)).filter((v): v is string => v !== null);
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

// --- line builders ------------------------------------------------------------

const heading = (text: string): PdfLine => ({ text, font: 'bold', size: 14, gapBefore: 18 });
const subheading = (text: string, indent = 0): PdfLine => ({
  text,
  font: 'bold',
  size: 11,
  gapBefore: 8,
  indent,
});
const none = (): PdfLine => ({ text: 'None', tone: 'muted' });

/** "Label: value" lines for an object's fields (nested lists handled by the
 *  caller), skipping ids and empties. */
function fields(obj: Obj | null, skip: readonly string[] = [], indent = 0): PdfLine[] {
  if (!obj) return [];
  const lines: PdfLine[] = [];
  for (const [key, value] of Object.entries(obj)) {
    if (isIdKey(key) || skip.includes(key)) continue;
    if (Array.isArray(value) && value.some(isObj)) continue; // lists render as blocks
    const text = formatValue(key, value);
    if (text !== null) lines.push({ text: `${label(key)}: ${text}`, indent });
  }
  return lines;
}

const linkLines = (urls: Value, name: string, indent = 0): PdfLine[] =>
  (Array.isArray(urls) ? urls : [])
    .filter((u): u is string => typeof u === 'string' && u.length > 0)
    .map((url, i) => ({ text: `${name} ${i + 1}`, link: url, indent }));

const mapLink = (point: Value, indent = 0): PdfLine[] =>
  isObj(point) && typeof point.lat === 'number' && typeof point.lng === 'number'
    ? [
        {
          text: 'Open on a map',
          link: `https://www.google.com/maps?q=${point.lat},${point.lng}`,
          indent,
        },
      ]
    : [];

const list = (value: Value): Obj[] => (Array.isArray(value) ? value.filter(isObj) : []);

/** A plain section: each item's fields, items apart. */
function itemsSection(
  title: string,
  items: Obj[],
  itemTitle?: (item: Obj, i: number) => string,
): PdfLine[] {
  const lines: PdfLine[] = [heading(title)];
  if (items.length === 0) return [...lines, none()];
  items.forEach((item, i) => {
    if (itemTitle) lines.push(subheading(itemTitle(item, i)));
    else if (i > 0) lines.push({ text: '', size: 4 });
    lines.push(...fields(item));
  });
  return lines;
}

const vehicleName = (v: Obj) =>
  [v.plate, v.make, v.model].filter((p) => typeof p === 'string' && p).join(' · ') || 'Car';

// --- the document -------------------------------------------------------------

/** The JSON copy's signed link and when it stops working. */
export interface MachineReadableCopy {
  url: string;
  expiresAt: string;
}

export function dataExportPdfLines(data: Obj, machineReadable: MachineReadableCopy): PdfLine[] {
  const about = isObj(data.about) ? data.about : {};
  const lines: PdfLine[] = [
    { text: 'Your Trackitdown data', font: 'bold', size: 20 },
    {
      text: `Made ${typeof about.generated_at === 'string' ? formatDate(about.generated_at) : ''}`,
      tone: 'muted',
    },
  ];
  if (typeof about.what_this_is === 'string') {
    lines.push({ text: about.what_this_is, gapBefore: 10 });
  }
  lines.push(subheading('Not included'));
  for (const item of Array.isArray(about.not_included) ? about.not_included : []) {
    lines.push({ text: `• ${item}`, indent: 8 });
  }
  for (const key of ['photos', 'your_rights', 'delete_your_account'] as const) {
    if (typeof about[key] === 'string') lines.push({ text: about[key] as string, gapBefore: 6 });
  }
  lines.push(
    subheading('Machine-readable copy'),
    {
      // The time, not "24 hours": a PDF re-sent later in the day has less left.
      text: `The same data as a file, for moving it to another service. This link works until ${formatDate(machineReadable.expiresAt)}.`,
    },
    { text: 'Download the machine-readable copy (JSON)', link: machineReadable.url },
  );

  // Account.
  const account = isObj(data.account) ? data.account : {};
  lines.push(heading('Your account'), ...fields(account, ['sign_in', 'avatar']));
  if (isObj(account.sign_in)) lines.push(...fields(account.sign_in));
  if (typeof account.avatar === 'string') lines.push({ text: 'Your photo', link: account.avatar });

  // Listings.
  const listings = list(data.listings);
  lines.push(heading('Your listings'));
  if (listings.length === 0) lines.push(none());
  for (const listing of listings) {
    lines.push(subheading(vehicleName(listing)));
    // Plate, make and model are the heading already.
    lines.push(
      ...fields(listing, ['photos', 'features', 'last_seen_point', 'plate', 'make', 'model']),
    );
    if (listing.last_seen_point) {
      const where = formatValue('last_seen_point', listing.last_seen_point);
      if (where) lines.push({ text: `Last seen location: ${where}` });
      lines.push(...mapLink(listing.last_seen_point));
    }
    const features = formatValue(
      'features',
      Array.isArray(listing.features)
        ? listing.features.map((f) => (typeof f === 'string' ? f.replace(/_/g, ' ') : f))
        : listing.features,
    );
    if (features) lines.push({ text: `Features: ${features}` });
    lines.push(...linkLines(listing.photos, 'Photo'));
    for (const feature of list(listing.distinctive_features)) {
      lines.push({ text: `Distinctive: ${feature.description ?? ''}`.trim() });
      if (typeof feature.photo_url === 'string')
        lines.push({ text: 'Photo', link: feature.photo_url, indent: 8 });
    }
    const sightings = list(listing.sightings_from_others);
    if (sightings.length) {
      lines.push({
        text: `Sightings from others (${sightings.length})`,
        font: 'bold',
        gapBefore: 4,
      });
      for (const s of sightings) {
        const summary = [formatValue('created_at', s.created_at), s.area_label, s.status]
          .filter((p) => typeof p === 'string' && p)
          .join(' · ');
        lines.push({ text: summary || 'Sighting', indent: 8 });
        lines.push(...fields(s, ['created_at', 'area_label', 'status'], 16));
      }
    }
  }

  // Garage.
  const garage = list(data.garage);
  lines.push(heading('Your garage'));
  if (garage.length === 0) lines.push(none());
  for (const vehicle of garage) {
    lines.push(
      subheading(vehicleName(vehicle)),
      ...fields(vehicle, ['photos', 'plate', 'make', 'model']),
    );
    lines.push(...linkLines(vehicle.photos, 'Photo'));
    for (const feature of list(vehicle.distinctive_features)) {
      lines.push({ text: `Distinctive: ${feature.description ?? ''}`.trim() });
      if (typeof feature.photo_url === 'string')
        lines.push({ text: 'Photo', link: feature.photo_url, indent: 8 });
    }
  }

  // Sightings they reported.
  const mine = list(data.sightings_you_reported);
  lines.push(heading('Sightings you reported'));
  if (mine.length === 0) lines.push(none());
  for (const s of mine) {
    lines.push(
      subheading(
        [formatValue('created_at', s.created_at), s.area_label]
          .filter((p) => typeof p === 'string' && p)
          .join(' · ') || 'Sighting',
      ),
      ...fields(s, ['created_at', 'area_label']),
    );
    for (const [i, photo] of list(s.photos).entries()) {
      if (typeof photo.url === 'string') lines.push({ text: `Photo ${i + 1}`, link: photo.url });
    }
  }

  // Conversations — the other person stays "Other person".
  const conversations = list(data.conversations);
  lines.push(heading('Conversations'));
  if (conversations.length === 0) lines.push(none());
  conversations.forEach((c, i) => {
    lines.push(
      subheading(`Conversation ${i + 1}${c.you_are ? ` — you were the ${c.you_are}` : ''}`),
    );
    for (const m of list(c.messages)) {
      const who = m.from === 'you' ? 'You' : 'Other person';
      const when = typeof m.sent_at === 'string' ? formatDate(m.sent_at) : '';
      lines.push({ text: `${who} · ${when}`, tone: 'muted', gapBefore: 2 });
      for (const para of String(m.text ?? '').split('\n')) lines.push({ text: para, indent: 8 });
    }
  });

  // Watchlist.
  const watchlist = isObj(data.watchlist) ? data.watchlist : {};
  lines.push(heading('Watchlist'));
  const collections = list(watchlist.collections);
  const saved = list(watchlist.saved_listings);
  if (!collections.length && !saved.length) lines.push(none());
  if (collections.length) {
    lines.push({
      text: `Collections: ${collections
        .map((c) => c.name)
        .filter(Boolean)
        .join(', ')}`,
    });
  }
  if (saved.length) lines.push({ text: `Saved listings: ${saved.length}` });

  // Alert areas.
  lines.push(
    ...itemsSection('Alert areas', list(data.alert_areas), (a) => String(a.name ?? 'Alert area')),
  );

  // Notifications: one line each.
  const notifications = list(data.notifications);
  lines.push(heading('Notifications'));
  if (notifications.length === 0) lines.push(none());
  for (const n of notifications) {
    const when = typeof n.created_at === 'string' ? formatDate(n.created_at) : '';
    lines.push({ text: when, tone: 'muted', gapBefore: 2 });
    lines.push({ text: [n.title, n.body].filter(Boolean).join(' — '), indent: 8 });
  }
  lines.push(
    heading('Notification settings'),
    ...(isObj(data.notification_settings) ? fields(data.notification_settings) : [none()]),
  );

  // Payments.
  lines.push(
    ...itemsSection('Payments', list(data.payments), (p) =>
      [
        formatValue('created_at', p.created_at),
        p.role === 'received' ? 'Paid to you' : 'You paid',
        formatValue('amount_pence', p.amount_pence),
      ]
        .filter(Boolean)
        .join(' · '),
    ),
  );
  lines.push(
    heading('Payout account'),
    ...(isObj(data.payout_account) ? fields(data.payout_account) : [none()]),
  );

  const disputes = isObj(data.disputes) ? data.disputes : {};
  lines.push(...itemsSection('Refund holds', list(data.refund_holds)));
  lines.push(...itemsSection('Disputes you raised', list(disputes.you_raised)));
  lines.push(...itemsSection('Disputes on your listings', list(disputes.on_your_listings)));
  lines.push(...itemsSection('Reports you made', list(data.reports_you_made)));
  lines.push(...itemsSection('People you blocked', list(data.people_you_blocked)));

  // Bug reports.
  const bugs = list(data.bug_reports);
  lines.push(heading('Bug reports'));
  if (bugs.length === 0) lines.push(none());
  for (const bug of bugs) {
    lines.push(
      subheading(typeof bug.created_at === 'string' ? formatDate(bug.created_at) : 'Bug report'),
      ...fields(bug, ['created_at', 'screenshots', 'breadcrumbs']),
    );
    lines.push(...linkLines(bug.screenshots, 'Screenshot'));
  }

  lines.push(...itemsSection('Devices', list(data.devices)));
  lines.push(...itemsSection('Verification documents', list(data.verification_documents)));
  return lines;
}

/** The PDF's bytes. */
export function renderDataExportPdf(data: Obj, machineReadable: MachineReadableCopy): Uint8Array {
  return renderPdf(dataExportPdfLines(data, machineReadable), {
    title: 'Your Trackitdown data',
  });
}

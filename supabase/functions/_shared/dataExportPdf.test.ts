/**
 * WHAT:  Tests for the data export's PDF layout — readable words (UK dates,
 *        pounds, Yes/No), no ids, the other person still "Other person", a
 *        link to the machine-readable copy, and a valid PDF out the end.
 * WHY:   The PDF is what people actually read; it must say what the JSON says
 *        without adding anything the builder left out.
 * LINKS: ./dataExportPdf.ts; ./dataExport.ts.
 */

import { buildDataExport, type DataExportRaw } from './dataExport';
import { dataExportPdfLines, formatValue, renderDataExportPdf } from './dataExportPdf';

const A = 'aaaaaaaa-0000-0000-0000-00000000000a';
const B = 'bbbbbbbb-0000-0000-0000-00000000000b';
const NOW = new Date('2026-10-23T12:00:00Z');
const JSON_URL = 'https://files.example/export.json';

const raw: DataExportRaw = {
  email: 'alice@example.com',
  signIn: { providers: ['email'], last_sign_in_at: '2026-10-23T09:00:00Z' },
  profile: { first_name: 'Alice', created_at: '2026-01-01T10:00:00Z' },
  avatarUrl: null,
  posts: [
    {
      id: 'post-a',
      plate: 'AB12 CDE',
      make: 'Ford',
      model: 'Fiesta',
      status: 'active',
      bounty_amount_pence: 25000,
      keys_taken: false,
    },
  ],
  postPoints: [{ id: 'post-a', lat: 53.48, lng: -2.24 }],
  postPhotos: [{ post_id: 'post-a', url: 'https://cdn/p1.jpg' }],
  postFeatures: [],
  postDistinctive: [],
  vehicles: [],
  vehiclePhotos: [],
  vehicleDistinctive: [],
  mySightings: [],
  mySightingPhotos: [],
  sightingsOnMyListings: [
    {
      post_id: 'post-a',
      spotter_id: B,
      area_label: 'Deansgate',
      status: 'unverified',
      created_at: '2026-10-20T08:00:00Z',
    },
  ],
  threads: [{ id: 't1', post_id: 'post-a', owner_id: A, spotter_id: B }],
  messages: [
    {
      thread_id: 't1',
      sender_id: B,
      kind: 'text',
      content: 'Saw it!',
      created_at: '2026-10-21T10:00:00Z',
    },
  ],
  watchlistCollections: [],
  watchlistItems: [],
  alertZones: [],
  alertPoints: [],
  notifications: [],
  notificationPreferences: null,
  payments: [
    {
      id: 'pay-1',
      role: 'paid',
      kind: 'listing_fee',
      status: 'collected',
      amount_pence: 500,
      created_at: '2026-10-01T09:00:00Z',
    },
  ],
  payoutAccount: null,
  refundHolds: [],
  myDisputes: [],
  disputesOnMyListings: [],
  flagsFiled: [],
  listingReportsFiled: [],
  blocks: [],
  bugReports: [],
  bugScreenshotUrls: {},
  pushDevices: [],
  verificationDocuments: [],
};

const exported = buildDataExport(raw, A, NOW);
const allText = () =>
  dataExportPdfLines(exported, JSON_URL)
    .map((l) => l.text)
    .join('\n');

describe('dataExportPdfLines', () => {
  it('reads like a document: UK dates, pounds, Yes/No', () => {
    const text = allText();
    expect(text).toContain('Your Trackitdown data');
    expect(text).toContain('AB12 CDE · Ford · Fiesta');
    expect(text).toContain('Reward: £250.00');
    expect(text).toContain('Keys taken: No');
    expect(text).toMatch(/1 Oct 2026, 10:00 · You paid · £5\.00/);
  });

  it('⚠️ keeps the other person anonymous and leaves ids out', () => {
    const text = allText();
    expect(text).toContain('Other person ·');
    expect(text).toContain('Saw it!');
    expect(text).not.toContain(B);
    expect(text).not.toContain('post-a');
    expect(text).not.toContain('pay-1');
  });

  it('links the machine-readable copy, photos and the map', () => {
    const lines = dataExportPdfLines(exported, JSON_URL);
    expect(lines).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ link: JSON_URL }),
        expect.objectContaining({ text: 'Photo 1', link: 'https://cdn/p1.jpg' }),
        expect.objectContaining({ link: 'https://www.google.com/maps?q=53.48,-2.24' }),
      ]),
    );
  });

  it('empty sections say "None" rather than vanish', () => {
    expect(allText()).toMatch(/Your garage\nNone/);
  });

  it('renders to a PDF', () => {
    const pdf = String.fromCharCode(...renderDataExportPdf(exported, JSON_URL));
    expect(pdf.startsWith('%PDF-1.4')).toBe(true);
    expect(pdf).toContain(`/URI (${JSON_URL})`);
  });
});

describe('formatValue', () => {
  it.each([
    ['amount_pence', 1234, '£12.34'],
    ['radius_m', 2000, '2 km'],
    ['payouts_enabled', true, 'Yes'],
    ['created_at', '2026-10-21T10:00:00Z', '21 Oct 2026, 11:00'],
    ['term_ends_at', '2026-12-25', '25 Dec 2026'],
    ['damage_kinds', ['dent', 'scratch'], 'dent, scratch'],
    ['note', '', null],
    ['note', null, null],
  ])('%s %p → %p', (key, value, expected) => {
    expect(formatValue(key, value)).toBe(expected);
  });
});

/**
 * WHAT:  Tests for buildSharePayload — the share text carries colour, make,
 *        model, plate and area; it carries a link only when there is somewhere
 *        to link to, and today there is not.
 * WHY:   Shares must identify the CAR (plate + area) and never a spotter, so a
 *        test pins the payload against a refactor dropping the plate or leaking
 *        a different field.
 *
 *        ⚠️ AND IT MUST NEVER SHIP A DEAD LINK AGAIN. Every share this app has
 *        ever produced carried `https://trackitdown.app/post/<id>` — a domain
 *        we do not own — and no test noticed, because the old suite asserted
 *        only that the URL ENDED IN THE POST ID. It did. It also went nowhere.
 *        The assertions here are about reachability, not shape.
 * LINKS: src/features/vehicles/lib/postShare.ts;
 *        src/shared/lib/publicSite.ts.
 */

import { PUBLIC_WEB_ORIGIN, publicPostUrl } from '@/shared/lib/publicSite';

import type { PostDetail } from '../types';
import { buildSharePayload } from './postShare';

const base: PostDetail = {
  id: 'abc-123',
  isOwner: false,
  status: 'active',
  make: 'BMW',
  model: '3 Series',
  colour: 'Blue',
  plate: 'AB12 CDE',
  bountyPence: 50000,
  lastSeenAt: '2026-07-10T18:00:00Z',
  lastSeenArea: 'Camden',
  createdAt: '2026-07-08T12:00:00Z',
  photos: [],
  owner: { memberSince: '2025-01-05T00:00:00Z', firstName: 'Alex' },
  features: [],
  distinctiveFeatures: [],
  sightingCount: 0,
  viewerHasSighting: false,
};

describe('what the share says about the car', () => {
  it('includes the car identity, plate and area', () => {
    const { message } = buildSharePayload(base);

    expect(message).toContain('Blue BMW 3 Series');
    expect(message).toContain('AB12 CDE');
    expect(message).toContain('near Camden');
  });

  it('omits the area clause when there is no area', () => {
    const { message } = buildSharePayload({ ...base, lastSeenArea: undefined });

    expect(message).not.toContain('Last seen near');
  });

  it('omits the plate parens for a plate-less car (never shares "(null)")', () => {
    const { message } = buildSharePayload({ ...base, plate: null });

    expect(message).not.toContain('null');
    expect(message).not.toContain('()');
    expect(message).toContain('Blue BMW 3 Series.');
  });

  // SECURITY_AND_TRUST: a share identifies the CAR. Nothing about whoever
  // reported it, or whoever spotted it, may travel with it.
  it('carries nothing about any person', () => {
    const { message } = buildSharePayload({ ...base, sightingCount: 3 });

    expect(message).not.toContain('Alex');
    expect(message.toLowerCase()).not.toContain('spotter');
    expect(message.toLowerCase()).not.toContain('owner');
  });
});

// ⚠️ THE POINT OF THIS FILE. These use the REAL constant, never an injected
// one — TESTING.md's rule about a mocked constant hiding a ten-day-stale floor
// applies exactly here, and the previous suite is what happens when it is
// ignored.
describe('⚠️ it must not promise a link it cannot deliver', () => {
  it('produces no url at all while we own no domain', () => {
    const payload = buildSharePayload(base);

    expect(payload.url).toBeUndefined();
    expect('url' in payload).toBe(false);
  });

  it('puts no http(s) address anywhere in the message', () => {
    const { message } = buildSharePayload(base);

    expect(message).not.toMatch(/https?:\/\//);
    expect(message).not.toContain('trackitdown.app');
  });

  it('still says where the report came from', () => {
    // Without a link the text is an unattributed claim about a stranger's car.
    expect(buildSharePayload(base).message).toContain('Trackitdown');
  });

  // ⚠️ A TRIPWIRE, NOT A TAUTOLOGY. The day someone sets PUBLIC_WEB_ORIGIN this
  // fails, which is the intended behaviour: it forces whoever does it to come
  // here, confirm a page actually SERVES /post/<id>, and rewrite the three
  // assertions above rather than discovering in the wild that the link is live
  // and 404ing.
  it('records that there is still nowhere to link to', () => {
    expect(PUBLIC_WEB_ORIGIN).toBeNull();
    expect(publicPostUrl(base.id)).toBeNull();
  });
});

// The formatting of the link, provable before the domain exists. ⚠️ These
// inject an origin and therefore prove NOTHING about whether links work today —
// that is what the tripwire above is for.
describe('the shape a link will take, once there is one', () => {
  it('appends the link to the message and returns it as a field', () => {
    const payload = buildSharePayload(base, publicPostUrl(base.id, 'https://example.test'));

    expect(payload.url).toBe('https://example.test/post/abc-123');
    // Android's Share reads `message` only, so the link has to be in both.
    expect(payload.message).toContain('https://example.test/post/abc-123');
    expect(payload.message).not.toContain('Reported on Trackitdown.');
  });

  it('does not double the slash when the origin has a trailing one', () => {
    expect(publicPostUrl('abc-123', 'https://example.test/')).toBe(
      'https://example.test/post/abc-123',
    );
  });
});

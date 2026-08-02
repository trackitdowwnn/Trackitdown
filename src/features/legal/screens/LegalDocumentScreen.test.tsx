/**
 * WHAT:  Tests for the legal document reader and the content behind it.
 * WHY:   Two different kinds of assertion live here.
 *
 *        The rendering ones are ordinary: each slug resolves, an unknown slug
 *        degrades instead of crashing (these arrive from a route param, so an
 *        old link must not white-screen).
 *
 *        The CONTENT ones are not decoration. The don't-approach rule is the
 *        promise the whole product rests on (SECURITY_AND_TRUST §1), and the
 *        Terms and Privacy documents make specific factual claims about money
 *        and data that the code has to keep true. A silent copy edit that drops
 *        "never approach", or that promises a full refund we do not give, is
 *        exactly the change nobody would notice in review.
 * LINKS: ./LegalDocumentScreen.tsx; ../lib/legalContent.ts;
 *        docs/SECURITY_AND_TRUST.md §1; docs/DOMAIN.md (bounty rules).
 */

import { render } from '@testing-library/react-native';

import { LEGAL_DOCUMENTS, legalDocument } from '../lib/legalContent';
import { LegalDocumentScreen } from './LegalDocumentScreen';

jest.mock('react-native-safe-area-context', () =>
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- jest.mock factories cannot use ESM imports
  require('react-native-safe-area-context/jest/mock').default,
);

const mockBack = jest.fn();
jest.mock('expo-router', () => ({
  useRouter: () => ({ back: mockBack, push: jest.fn() }),
}));

beforeEach(() => jest.clearAllMocks());

describe('rendering', () => {
  it.each(['safety', 'terms', 'privacy'] as const)('renders the %s document', async (slug) => {
    const { getByText } = await render(<LegalDocumentScreen slug={slug} />);
    expect(getByText(LEGAL_DOCUMENTS[slug].title)).toBeTruthy();
    // Every heading present — a document that renders its title but silently
    // drops its body would otherwise pass.
    LEGAL_DOCUMENTS[slug].sections.forEach((section) => {
      expect(getByText(section.heading)).toBeTruthy();
    });
  });

  it('degrades on an unknown slug rather than crashing', async () => {
    // The slug is a route param: a stale link or a typo must not white-screen.
    const { getByText } = await render(<LegalDocumentScreen slug="not-a-document" />);
    expect(getByText("We couldn't find that page")).toBeTruthy();
  });

  it('shows when the document was last updated', async () => {
    const { getByText } = await render(<LegalDocumentScreen slug="terms" />);
    expect(getByText(`Last updated ${LEGAL_DOCUMENTS.terms.lastUpdated}`)).toBeTruthy();
  });
});

describe('the safety promise', () => {
  const safetyText = JSON.stringify(LEGAL_DOCUMENTS.safety).toLowerCase();

  // SECURITY_AND_TRUST §1: report, don't approach. If this ever fails, the
  // change that caused it is the problem — do not fix the test.
  it('tells people not to approach, follow or confront', () => {
    expect(safetyText).toContain('never approach');
    expect(safetyText).toContain('follow');
    expect(safetyText).toContain('confront');
  });

  it('gives the emergency number', () => {
    expect(safetyText).toContain('999');
  });

  it('leads with the safety rule, not with the bounty', () => {
    // Ordering is the message. The first section a frightened or excited
    // person reads must be the one that keeps them safe.
    expect(LEGAL_DOCUMENTS.safety.sections[0].heading).toBe('The one rule');
  });
});

describe('factual claims the code must keep true', () => {
  const terms = JSON.stringify(LEGAL_DOCUMENTS.terms);
  const privacy = JSON.stringify(LEGAL_DOCUMENTS.privacy);

  it('states the bounty range and the split that DOMAIN.md defines', () => {
    expect(terms).toContain('£50');
    expect(terms).toContain('£5,000');
    expect(terms).toContain('95%');
    expect(terms).toContain('5%');
  });

  it('does NOT promise a full refund — card fees are withheld', () => {
    // deactivate-post and refund-recovery both refund `amount - stripe fee`.
    // Promising the whole bounty back would be a false statement about money.
    expect(terms).toContain('minus the card processing costs');
  });

  it('says only one sighting can be credited', () => {
    expect(terms).toContain('Only one sighting can be credited');
  });

  it('tells users a push carries no plate, no coordinates, no message content', () => {
    // SECURITY_AND_TRUST §3 — asserted in SQL too; this is the user-facing half.
    expect(privacy).toContain('never a number plate');
    expect(privacy).toContain('never coordinates');
  });

  it('explains that sighting photos survive account deletion', () => {
    // The retention decision made in the delete-account work. If that call is
    // reversed, this sentence has to go with it.
    expect(privacy).toContain('stay attached to that listing');
  });

  it('names the ICO as the route to complain', () => {
    expect(privacy).toContain('ico.org.uk');
  });
});

describe('legalDocument()', () => {
  it('returns null for an unknown slug instead of throwing', () => {
    expect(legalDocument('nope')).toBeNull();
    // Guards against a prototype key resolving to something truthy.
    expect(legalDocument('constructor')).toBeNull();
    expect(legalDocument('toString')).toBeNull();
  });
});

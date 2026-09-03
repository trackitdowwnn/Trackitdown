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

import { fireEvent, render } from '@testing-library/react-native';

// Deep import, not the '@/features/vehicles' barrel: that barrel reaches
// AsyncStorage and this suite will not even load through it. ARCHITECTURE rule 1
// says features talk via index.ts, and this is the fourth place to reach past it
// for these constants — alertSteps and searchCriteria already do, from
// PRODUCTION code. That makes bountyBounds a de-facto shared module owned by one
// feature; the money constants beside LISTING_FEE_PENCE in shared/lib/money.ts
// is where they probably belong. Recorded rather than fixed here — moving them
// touches nine files and is not a review-cycle change.
import {
  MAX_BOUNTY_PENCE,
  MIN_BOUNTY_PENCE,
} from '@/shared/lib/bountyBounds';
import { formatPounds, LISTING_FEE_PENCE } from '@/shared/lib/money';

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

describe('⚠️ the reading chrome (Airbnb pass, 2026-08-26)', () => {
  // A full recomposition of a COMPLIANCE surface, so these test that the new
  // navigation does not cost anything the document already promised.

  it('opens on the document, not on its table of contents', async () => {
    // The index is collapsed by default, deliberately. Expanded, twenty
    // headings push the document's own first sentence off the screen — a
    // consent surface that opens on its contents page rather than its content.
    const { getByTestId, queryByTestId } = await render(<LegalDocumentScreen slug="privacy" />);

    expect(getByTestId('legal-index-toggle')).toBeTruthy();
    expect(queryByTestId('legal-index-0')).toBeNull();
  });

  it('lists every section once opened, in document order', async () => {
    const { getByTestId, findByTestId } = await render(<LegalDocumentScreen slug="privacy" />);

    fireEvent.press(getByTestId('legal-index-toggle'));

    // ⚠️ EVERY section, not "some". An index that silently omits one is worse
    // than no index: a reader who cannot find "How long we keep things"
    // concludes it is not covered, rather than that the list is short.
    for (let index = 0; index < LEGAL_DOCUMENTS.privacy.sections.length; index++) {
      expect(await findByTestId(`legal-index-${index}`)).toBeTruthy();
    }
  });

  it('tells assistive tech whether the contents are open', async () => {
    // The chevron carries this visually and cannot carry it otherwise;
    // "Contents, button" alone leaves a screen-reader user tapping to find out.
    const { getByTestId, findByTestId } = await render(<LegalDocumentScreen slug="terms" />);
    const toggle = getByTestId('legal-index-toggle');

    expect(toggle.props.accessibilityState).toMatchObject({ expanded: false });

    fireEvent.press(toggle);

    const reopened = await findByTestId('legal-index-toggle');
    expect(reopened.props.accessibilityState).toMatchObject({ expanded: true });
  });

  it('⚠️ renders a bullet as a hanging indent, with the marker out of the prose', async () => {
    // The previous implementation put "• " inside the paragraph text and gave
    // the whole Text a paddingLeft, which insets EVERY line — so a wrapped
    // bullet aligned under the dot, precisely what its comment claimed to
    // avoid. The marker now lives in its own column, which also keeps it out of
    // the string a screen reader reads.
    const bulletSource = LEGAL_DOCUMENTS.safety.sections
      .flatMap((section) => section.body)
      .find((paragraph) => paragraph.startsWith('• '));
    // Guard the fixture: if the copy ever loses its bullets this test would
    // otherwise pass by testing nothing.
    expect(bulletSource).toBeDefined();

    const { getByText, queryByText } = await render(<LegalDocumentScreen slug="safety" />);

    expect(getByText(bulletSource!.slice(2))).toBeTruthy();
    expect(queryByText(bulletSource!)).toBeNull();
  });

  it('shows no current-section label before anything has been scrolled', async () => {
    // It reports where you are. At the top you are nowhere in particular, and a
    // label naming section one while the intro is on screen would be wrong.
    const { queryByTestId } = await render(<LegalDocumentScreen slug="privacy" />);

    expect(queryByTestId('legal-current-section')).toBeNull();
  });

  it('keeps the not-found state, which arrives from a route param', async () => {
    const { getByText, queryByTestId } = await render(<LegalDocumentScreen slug="nonsense" />);

    expect(getByText("We couldn't find that page")).toBeTruthy();
    // No chrome for a document that does not exist — an index of nothing and a
    // progress bar for an empty page.
    expect(queryByTestId('legal-index-toggle')).toBeNull();
    expect(queryByTestId('legal-scroll')).toBeNull();
  });
});

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

  it('⚠️ states the bounty range the app actually ENFORCES', () => {
    // Derived from the bounds, not typed here, and this is the whole point.
    // The floor moved to £10 on 2026-08-13; the Terms went on saying £50 until
    // 2026-08-23 — a legal document telling people a £10 listing was impossible
    // while the app happily took one — and this test SAID £50 too, so it agreed
    // with the mistake instead of catching it.
    //
    // The prose stays a literal on purpose (legal text changes by decision, not
    // as a side effect of a constant). This is the thread between them: move the
    // floor without opening the Terms and you fail here.
    // The whole PHRASE, not the two tokens. A bare toContain('£5') passes on the
    // '£5,000' already in the sentence, and '£1' passes on '£10' — so two plausible
    // floors would have slipped through the guard this test exists to be.
    expect(terms).toContain(
      `between ${formatPounds(MIN_BOUNTY_PENCE)} and ${formatPounds(MAX_BOUNTY_PENCE)}`,
    );
    expect(terms).toContain('95%');
    expect(terms).toContain('5%');
  });

  it('⚠️ states the listing fee, and that it is NOT refundable', () => {
    // ADR-0014 shipped a second pricing mode on 2026-08-19 and the Terms
    // described only the bounty until 2026-09-01 — thirteen days of taking a £5
    // charge under a document that never mentioned it. The gap was KNOWN and
    // written into legalContent.ts's own header, and it still survived a Terms
    // revision on 2026-08-23, because a note explaining why something is wrong
    // reads as a decision rather than a debt. A test does not read that way.
    //
    // ⚠️ THE WHOLE PHRASE, for the reason the bounty test above spells out and
    // more sharply here: the fee IS £5, and a bare toContain('£5') passes on
    // the '£5,000' ceiling already in this section. Anchoring on the sentence
    // is the only version of this assertion that can fail.
    expect(terms).toContain(`The listing fee is ${formatPounds(LISTING_FEE_PENCE)}.`);
    // Non-refundability is the term a reader is most likely to be surprised by,
    // so it is the one that must survive an edit.
    expect(terms).toContain('It is not refundable');
    // And the spotter's side: credit and record, but no money.
    expect(terms).toMatch(/no bounty for us to pay them|there is no money attached/i);
  });

  it('⚠️ does not promise an expiry the app never performs', () => {
    // The Terms said "A listing lasts 90 days unless you cancel or renew it"
    // and that the bounty comes back "or it expires". ROADMAP records passive
    // expiry as deliberately CUT — "we are cutting the PROMISE, not building
    // the machine" — and the Terms were missed in that cut, leaving a term an
    // owner could rely on and we would breach.
    //
    // ⚠️ create_post still stamps expires_at and post detail still SHOWS it.
    // That is a live bug tracked separately; if it is ever FIXED, this test is
    // the thing that should be revisited, not silently deleted.
    expect(terms).not.toMatch(/lasts 90 days|or it expires/i);
    expect(terms).toContain('We do not close it automatically.');
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

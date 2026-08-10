/**
 * WHAT:  Tests for SafetyNotice — carries the non-negotiable "report, don't
 *        approach" copy and the 999 line, as an accessibility alert, in BOTH
 *        the full-banner and collapsible forms.
 * WHY:   SECURITY_AND_TRUST §1 makes this exact wording a product requirement;
 *        a test locks it so a well-meaning copy edit can't soften it. The
 *        collapsible form (chat) needs more than that: shrinking a safety
 *        notice is only legitimate while it stays PRESENT, stays an alert,
 *        cannot be dismissed, and still reads in full to a screen reader — so
 *        each of those is asserted rather than assumed. The failure this
 *        guards against isn't a crash; it's a later redesign quietly turning a
 *        requirement into a hint.
 * LINKS: src/shared/ui/SafetyNotice.tsx, docs/SECURITY_AND_TRUST.md §1,
 *        src/features/chat/screens/ChatThreadScreen.tsx (the only collapsible
 *        consumer).
 */

import { act, fireEvent, render } from '@testing-library/react-native';

import { SAFETY_NOTICE_BODY, SafetyNotice } from './SafetyNotice';

const FULL_BODY =
  /Never approach the vehicle, follow it, or confront anyone\. If a crime is in progress, call 999\./;

describe('SafetyNotice', () => {
  it('states never-approach and call 999, as an alert', async () => {
    const { getByText, getByRole } = await render(<SafetyNotice />);
    expect(getByText(/Never approach the vehicle/i)).toBeTruthy();
    expect(getByText(/call 999/i)).toBeTruthy();
    expect(getByRole('alert')).toBeTruthy();
  });
});

describe('SafetyNotice (collapsible)', () => {
  it('is still an alert, and still names the rule, while collapsed', async () => {
    const { getByRole, getByText } = await render(<SafetyNotice collapsible />);

    expect(getByRole('alert')).toBeTruthy();
    // The ACTIONABLE half stays on screen — only the elaboration folds.
    expect(getByText(/report, don’t approach/i)).toBeTruthy();
  });

  it('reads the FULL notice to a screen reader even when collapsed', async () => {
    const { getByTestId } = await render(<SafetyNotice collapsible />);

    // The whole point: visually short, never short to assistive tech.
    expect(getByTestId('safety-notice-collapsible').props.accessibilityLabel).toMatch(FULL_BODY);
  });

  it('expands to the full body on tap, and folds back', async () => {
    const { getByTestId, queryByText } = await render(<SafetyNotice collapsible />);
    const strip = getByTestId('safety-notice-collapsible');

    expect(queryByText(FULL_BODY)).toBeNull();

    await act(async () => {
      fireEvent.press(strip);
    });
    expect(queryByText(FULL_BODY)).toBeTruthy();

    await act(async () => {
      fireEvent.press(strip);
    });
    expect(queryByText(FULL_BODY)).toBeNull();
  });

  it('cannot be dismissed — collapsing is not hiding', async () => {
    const { getByTestId, queryByText } = await render(<SafetyNotice collapsible />);

    // Toggle it every way a user can; the notice is still mounted and still
    // says the rule. There is no state in which this renders nothing.
    await act(async () => {
      fireEvent.press(getByTestId('safety-notice-collapsible'));
    });
    await act(async () => {
      fireEvent.press(getByTestId('safety-notice-collapsible'));
    });

    expect(getByTestId('safety-notice-collapsible')).toBeTruthy();
    expect(queryByText(/report, don’t approach/i)).toBeTruthy();
  });

  it('exports the exact §1 wording for the one surface that restates it', async () => {
    // SightingDetailScreen's "Open in Maps" confirm repeats this sentence
    // before handing an owner the captured point. It IMPORTS this constant
    // rather than retyping it — a second hand-typed copy had already drifted
    // once. Pinning the export to the same wording the component renders means
    // the confirm cannot silently disagree with the notice above it.
    expect(SAFETY_NOTICE_BODY).toMatch(FULL_BODY);
  });
});

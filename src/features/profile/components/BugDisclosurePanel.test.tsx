/**
 * WHAT:  Tests for the "Sent with your report" panel — what it promises, and
 *        that it can never promise less than the payload carries.
 * WHY:   The panel is the feature. It is the only thing that makes the privacy
 *        policy's diagnostics bullet true rather than boilerplate, and every way
 *        it can go wrong is a way of collecting something the user was not told
 *        about.
 *
 *        ⚠️ THESE ASSERTIONS MOVED HERE FROM ReportBugScreen.test ON 2026-08-27
 *        when the screen became a wizard, and they got SHARPER in the move.
 *        They used to render the whole screen to inspect one panel; now they
 *        test the panel, which is what they were always about. Two defects they
 *        pin shipped invisibly once already: the panel was conditioned on
 *        `lines.length > 0`, so a handset where no device field read showed no
 *        promise at all, and the platform was folded into the OS string so the
 *        list said less than the payload.
 * LINKS: ./BugDisclosurePanel.tsx; ../api/bugReportApi.ts (what is sent);
 *        ../lib/bugDiagnostics.ts (where the rows come from).
 */

import { render } from '@testing-library/react-native';

import { BugDisclosurePanel, bugDisclosureRows } from './BugDisclosurePanel';

const LINES = [
  { label: 'App version', value: '1.0.0' },
  { label: 'Phone', value: 'Pixel 6' },
  { label: 'Android', value: '16' },
];

describe('what the panel promises', () => {
  it('lists every device fact it was given', async () => {
    const { getByText } = await render(
      <BugDisclosurePanel lines={LINES} area="explore" shots={0} />,
    );

    for (const line of LINES) {
      expect(getByText(line.label)).toBeTruthy();
      expect(getByText(line.value)).toBeTruthy();
    }
  });

  it('⚠️ still promises what it always sends when NO device field reads', async () => {
    // The whole panel used to hang on `lines.length > 0`, so on a handset where
    // nothing could be read the user was told NOTHING — while their account
    // link still travelled.
    //
    // ⚠️ THE ACCOUNT ROW IS UNCONDITIONAL, and this is the test that keeps it
    // so. It replaced a closing paragraph the owner asked to remove
    // (2026-08-27), and it is the ONLY thing on the panel that mentions
    // identity — every other row describes the report, not the reporter. The
    // operator's email carries the reporter's address and user id, so this row
    // going missing would mean collecting an identity the screen never named.
    const { getByText, getByTestId } = await render(
      <BugDisclosurePanel lines={[]} area={null} shots={0} />,
    );

    expect(getByTestId('report-bug-diagnostics')).toBeTruthy();
    expect(getByText('Sent with your report')).toBeTruthy();
    expect(getByText('Your account')).toBeTruthy();
    expect(getByText('So we can reply')).toBeTruthy();
    // And the trail stays named even with nothing else to show.
    expect(getByText('Recent activity')).toBeTruthy();
  });

  it('names the breadcrumb trail, which is the part they did not choose', async () => {
    // Every other row describes something the reporter typed, picked or owns.
    // The trail is the one thing on the list they never touched, so it is the
    // one that most needs saying out loud.
    const { getByText } = await render(<BugDisclosurePanel lines={[]} area={null} shots={0} />);

    expect(getByText('Recent activity')).toBeTruthy();
    expect(getByText('Step names only')).toBeTruthy();
  });

  it('⚠️ counts attached screenshots, and says nothing when there are none', async () => {
    // An image is the one attachment whose weight is easy to forget.
    expect(bugDisclosureRows({ lines: [], area: null, shots: 0 })).not.toContainEqual(
      expect.objectContaining({ label: 'Screenshots' }),
    );
    expect(bugDisclosureRows({ lines: [], area: null, shots: 1 })).toContainEqual({
      label: 'Screenshots',
      value: '1 image',
    });
    expect(bugDisclosureRows({ lines: [], area: null, shots: 3 })).toContainEqual({
      label: 'Screenshots',
      value: '3 images',
    });
  });

  it('shows the chosen area, so the panel matches what travels', async () => {
    expect(bugDisclosureRows({ lines: [], area: 'payments', shots: 0 })).toContainEqual({
      label: 'Area',
      value: 'Payments & bounties',
    });
  });

  it('omits the area row when none was chosen, rather than inventing one', async () => {
    // The context step is skippable; a row reading "Area — Something else"
    // would be the panel claiming an answer nobody gave.
    expect(bugDisclosureRows({ lines: [], area: null, shots: 0 })).not.toContainEqual(
      expect.objectContaining({ label: 'Area' }),
    );
  });

  it('⚠️ reads each row as ONE item to a screen reader', async () => {
    // Unwrapped, a two-Text row is announced as two fragments and the pairing
    // is lost — "App version" and "1.0.0" arriving as separate stops tells
    // nobody which belongs to which.
    const { getByLabelText } = await render(
      <BugDisclosurePanel lines={LINES} area={null} shots={0} />,
    );

    expect(getByLabelText('App version: 1.0.0')).toBeTruthy();
  });
});

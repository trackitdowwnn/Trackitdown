/**
 * WHAT:  Tests for StatusBadge — renders the mapped label for a non-active
 *        status, renders nothing for `active`, and the statusBadgeLabel helper.
 * WHY:   The badge is the one signal that a listing isn't live; a badge
 *        wrongly shown on an active post (or missing on a recovered one) would
 *        misrepresent a car's state.
 * LINKS: src/shared/ui/StatusBadge.tsx, docs/TESTING.md.
 */

import { render } from '@testing-library/react-native';

import { StatusBadge, statusBadgeLabel } from './StatusBadge';

// Reduce Motion, steerable per test (the going-live spinner falls back to a dot).
let mockReduceMotion = false;
jest.mock('react-native-reanimated', () => ({
  ...jest.requireActual('react-native-reanimated'),
  useReducedMotion: () => mockReduceMotion,
}));

describe('StatusBadge', () => {
  it('renders the mapped label for a non-active status', async () => {
    const { getByText } = await render(<StatusBadge status="recovered" />);
    expect(getByText('Recovered')).toBeTruthy();
  });

  it('renders nothing for an active post by default (public stays calm)', async () => {
    const { toJSON } = await render(<StatusBadge status="active" />);
    expect(toJSON()).toBeNull();
  });

  it('renders a green "Live" badge for an active post ONLY when opted in (owner)', async () => {
    const { getByText } = await render(<StatusBadge status="active" showLiveWhenActive />);
    expect(getByText('Live')).toBeTruthy();
  });

  it('says "Going live" with a spinner in the badge’s place while a just-paid listing goes live', async () => {
    const { getByText, getByTestId, queryByText } = await render(
      <StatusBadge status="draft" showLiveWhenActive goingLive="confirming" />,
    );
    expect(getByText('Going live')).toBeTruthy();
    // Decorative — hidden from screen readers; the label says it.
    expect(getByTestId('status-going-live-spinner', { includeHiddenElements: true })).toBeTruthy();
    // Never "Draft" for a listing that has been paid for.
    expect(queryByText('Draft')).toBeNull();
  });

  it('says "Going live soon" (no spinner) when it is taking longer', async () => {
    const { getByText, queryByTestId } = await render(
      <StatusBadge status="draft" showLiveWhenActive goingLive="slow" />,
    );
    expect(getByText('Going live soon')).toBeTruthy();
    expect(queryByTestId('status-going-live-spinner', { includeHiddenElements: true })).toBeNull();
  });

  it('never hides a real status behind it — only Draft is replaced', async () => {
    const { getByText, queryByText } = await render(
      <StatusBadge status="rejected" showLiveWhenActive goingLive="slow" />,
    );
    expect(getByText('Rejected')).toBeTruthy();
    expect(queryByText('Going live soon')).toBeNull();
  });

  it('shows a still dot, not a spinner, under Reduce Motion', async () => {
    mockReduceMotion = true;
    const { getByText, queryByTestId } = await render(
      <StatusBadge status="draft" showLiveWhenActive goingLive="confirming" />,
    );
    expect(getByText('Going live')).toBeTruthy();
    expect(queryByTestId('status-going-live-spinner', { includeHiddenElements: true })).toBeNull();
    mockReduceMotion = false;
  });

  it('shows "Live" once the post is active, whatever the watch still says', async () => {
    const { getByText, queryByText } = await render(
      <StatusBadge status="active" showLiveWhenActive goingLive="confirming" />,
    );
    expect(getByText('Live')).toBeTruthy();
    expect(queryByText('Going live')).toBeNull();
  });

  it('statusBadgeLabel returns the label or null, honouring the Live opt-in', () => {
    expect(statusBadgeLabel('pending_verification')).toBe('Pending');
    expect(statusBadgeLabel('recovery_claimed')).toBe('Recovery claimed');
    expect(statusBadgeLabel('active')).toBeNull();
    expect(statusBadgeLabel('active', true)).toBe('Live');
  });
});

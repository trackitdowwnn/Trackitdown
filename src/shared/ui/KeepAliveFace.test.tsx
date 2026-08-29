/**
 * WHAT:  Tests for KeepAliveFace — that an inactive face stays MOUNTED, and is
 *        hidden from touch and from BOTH platforms' screen readers.
 * WHY:   ⚠️ THIS IS THE ONE CONTRACT IN THE INBOX PASS THAT A SIGHTED REVIEW
 *        CANNOT CATCH. The inactive face is fully laid out at `opacity: 0`, so
 *        it looks perfect while remaining a whole second screen in the tree.
 *        The props that keep a screen reader out of it are single-platform —
 *        `accessibilityElementsHidden` is iOS-only, `importantForAccessibility`
 *        is Android-only — so deleting either changes nothing on screen, fails
 *        nothing else, and breaks exactly half the users.
 *
 *        The device pass (VoiceOver AND TalkBack, not one) is still worth doing
 *        once. This is what stops it regressing afterwards.
 * LINKS: ./KeepAliveFace.tsx; src/app/(tabs)/inbox.tsx (the consumer);
 *        docs/design-refs/inbox/GAP_ANALYSIS.md ("Verify before trusting").
 */

import { render } from '@testing-library/react-native';
import { Text } from 'react-native';

import { KeepAliveFace } from './KeepAliveFace';

/**
 * ⚠️ `includeHiddenElements` IS THE ASSERTION'S PREMISE, not a workaround.
 * RNTL excludes accessibility-hidden nodes from queries by default, so an
 * inactive face is unfindable without it — which is itself the first proof it
 * is hidden. The flag then lets the test check HOW, since "not found" alone
 * would also pass if the subtree had been unmounted, which is the bug this
 * component exists to prevent.
 */
const HIDDEN_TOO = { includeHiddenElements: true } as const;

describe('an active face', () => {
  it('is visible to touch and to a screen reader', async () => {
    const { getByTestId } = await render(
      <KeepAliveFace active testID="face">
        <Text>CONTENT</Text>
      </KeepAliveFace>,
    );

    const face = getByTestId('face');
    expect(face.props.accessibilityElementsHidden).toBe(false);
    expect(face.props.importantForAccessibility).toBe('auto');
    expect(face.props.pointerEvents).toBe('auto');
  });

  it('reads out normally', async () => {
    const { getByText } = await render(
      <KeepAliveFace active>
        <Text>CONTENT</Text>
      </KeepAliveFace>,
    );

    expect(getByText('CONTENT')).toBeTruthy();
  });
});

describe('an inactive face', () => {
  it('⚠️ is hidden from touch AND from both platforms’ screen readers', async () => {
    // All three together: iOS-only prop, Android-only prop, and touch. Two out
    // of three is the failure mode this exists to make impossible.
    const { getByTestId } = await render(
      <KeepAliveFace active={false} testID="face">
        <Text>CONTENT</Text>
      </KeepAliveFace>,
    );

    const face = getByTestId('face', HIDDEN_TOO);
    expect(face.props.accessibilityElementsHidden).toBe(true);
    expect(face.props.importantForAccessibility).toBe('no-hide-descendants');
    expect(face.props.pointerEvents).toBe('none');
  });

  it('⚠️ is unreachable by an accessibility-aware query', async () => {
    // The property a screen-reader user actually experiences, stated directly.
    const { queryByText } = await render(
      <KeepAliveFace active={false}>
        <Text>CONTENT</Text>
      </KeepAliveFace>,
    );

    expect(queryByText('CONTENT')).toBeNull();
  });

  it('⚠️ but stays MOUNTED — hidden is not unmounted', async () => {
    // The whole reason the component exists: an unmounted face loses its
    // scroll position, refetches, and replays its entrance on every switch.
    const { queryByText } = await render(
      <KeepAliveFace active={false}>
        <Text>CONTENT</Text>
      </KeepAliveFace>,
    );

    expect(queryByText('CONTENT', HIDDEN_TOO)).toBeTruthy();
  });

  it('does not collapse its layout — opacity, never display:none', async () => {
    // display:none would zero the subtree in Yoga, so a list inside it drops
    // its rendered window and has to re-measure on reveal.
    const { getByTestId } = await render(
      <KeepAliveFace active={false} testID="face">
        <Text>CONTENT</Text>
      </KeepAliveFace>,
    );

    const flat = Object.assign({}, ...[getByTestId('face', HIDDEN_TOO).props.style].flat());
    expect(flat.opacity).toBe(0);
    expect(flat.display).toBeUndefined();
  });
});

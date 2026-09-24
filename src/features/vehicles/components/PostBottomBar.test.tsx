/**
 * WHAT:  Tests for PostBottomBar — the spotter sees the bounty + "I've seen
 *        this car", or "Message the owner" once they have reported; the owner
 *        sees "Your listing" + "Manage listing". Mode drives which action fires.
 * WHY:   is_owner decides the whole bar; a spotter shown "Manage listing" (or an
 *        owner shown the sighting CTA on their own car) is a broken flow.
 * LINKS: src/features/vehicles/components/PostBottomBar.tsx, docs/TESTING.md.
 */

import { fireEvent, render } from '@testing-library/react-native';

import type { PostDetail } from '../types';
import { PostBottomBar } from './PostBottomBar';

jest.mock('react-native-safe-area-context', () =>
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- jest.mock factories cannot use ESM imports
  require('react-native-safe-area-context/jest/mock').default,
);

const base: PostDetail = {
  id: 'p1',
  isOwner: false,
  status: 'active',
  make: 'BMW',
  model: '3 Series',
  colour: 'Blue',
  plate: 'AB12 CDE',
  bountyPence: 50000,
  lastSeenAt: '2026-07-10T18:00:00Z',
  createdAt: '2026-07-08T12:00:00Z',
  photos: [],
  owner: { memberSince: '2025-01-05T00:00:00Z', firstName: 'Alex' },
  features: [],
  distinctiveFeatures: [],
  sightingCount: 0,
  viewerHasSighting: false,
};

const handlers = () => ({ onSeen: jest.fn(), onMessageOwner: jest.fn(), onManage: jest.fn() });

describe('PostBottomBar', () => {
  it('spotter mode: bounty + "I\'ve seen this car", firing onSeen', async () => {
    const h = handlers();
    const { getByText, queryByText } = await render(<PostBottomBar post={base} {...h} />);

    expect(getByText('£500')).toBeTruthy();
    expect(getByText('reward')).toBeTruthy();
    expect(queryByText('Manage listing')).toBeNull();

    fireEvent.press(getByText("I've seen this car"));
    expect(h.onSeen).toHaveBeenCalledTimes(1);
    expect(h.onManage).not.toHaveBeenCalled();
  });

  // Once they have reported, the step they have done stops being the
  // headline: the bar opens the conversation it unlocked.
  it('spotter who has reported: "Message the owner", firing onMessageOwner', async () => {
    const h = handlers();
    const { getByText, queryByText } = await render(
      <PostBottomBar post={{ ...base, viewerHasSighting: true }} {...h} />,
    );

    expect(queryByText("I've seen this car")).toBeNull();
    fireEvent.press(getByText('Message the owner'));
    expect(h.onMessageOwner).toHaveBeenCalledTimes(1);
    expect(h.onSeen).not.toHaveBeenCalled();
  });

  // ⚠️ Chat is sighting-gated (DOMAIN Chat: no cold DMs). The bar must never
  // offer "Message" to someone who has not reported.
  it('never offers "Message the owner" before a sighting', async () => {
    const { queryByText } = await render(<PostBottomBar post={base} {...handlers()} />);

    expect(queryByText('Message the owner')).toBeNull();
  });

  it('owner mode: "Your listing" + "Manage listing", firing onManage', async () => {
    const h = handlers();
    const { getByText, queryByText } = await render(
      <PostBottomBar post={{ ...base, isOwner: true, viewerHasSighting: true }} {...h} />,
    );

    expect(getByText('Your listing')).toBeTruthy();
    expect(queryByText("I've seen this car")).toBeNull();
    expect(queryByText('Message the owner')).toBeNull();

    fireEvent.press(getByText('Manage listing'));
    expect(h.onManage).toHaveBeenCalledTimes(1);
    expect(h.onSeen).not.toHaveBeenCalled();
  });
});

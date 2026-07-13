/**
 * WHAT:  Tests for PostBottomBar — the spotter sees the bounty + "I've seen
 *        this car"; the owner sees "Your listing" + "Manage post". Mode drives
 *        which action fires.
 * WHY:   is_owner decides the whole bar; a spotter shown "Manage post" (or an
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
  sightingCount: 0,
};

describe('PostBottomBar', () => {
  it('spotter mode: bounty + "I\'ve seen this car", firing onSeen', async () => {
    const onSeen = jest.fn();
    const onManage = jest.fn();
    const { getByText, queryByText } = await render(
      <PostBottomBar post={base} onSeen={onSeen} onManage={onManage} />,
    );

    expect(getByText('£500')).toBeTruthy();
    expect(getByText('reward')).toBeTruthy();
    expect(queryByText('Manage post')).toBeNull();

    fireEvent.press(getByText("I've seen this car"));
    expect(onSeen).toHaveBeenCalledTimes(1);
    expect(onManage).not.toHaveBeenCalled();
  });

  it('owner mode: "Your listing" + "Manage post", firing onManage', async () => {
    const onSeen = jest.fn();
    const onManage = jest.fn();
    const { getByText, queryByText } = await render(
      <PostBottomBar post={{ ...base, isOwner: true }} onSeen={onSeen} onManage={onManage} />,
    );

    expect(getByText('Your listing')).toBeTruthy();
    expect(queryByText("I've seen this car")).toBeNull();

    fireEvent.press(getByText('Manage post'));
    expect(onManage).toHaveBeenCalledTimes(1);
    expect(onSeen).not.toHaveBeenCalled();
  });
});

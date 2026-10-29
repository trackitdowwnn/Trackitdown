/**
 * WHAT:  Tests for ./serverDraft.ts — which draft listing the + button finds.
 * WHY:   The "Finish your draft?" sheet must name the right car and never
 *        fail a report on a lookup error.
 * LINKS: ./serverDraft.ts; src/features/garage/hooks/useStartReport.ts.
 */

import { findServerDraft } from './serverDraft';

const mockListMyPosts = jest.fn();
jest.mock('../api/myPostsApi', () => ({ listMyPosts: () => mockListMyPosts() }));

const post = (id: string, status: string, extra: Record<string, unknown> = {}) => ({
  id,
  status,
  make: 'Ford',
  model: 'Fiesta',
  colour: 'blue',
  ...extra,
});

beforeEach(() => {
  mockListMyPosts.mockReset();
});

it('finds the newest draft (the list is newest first) and names its car', async () => {
  mockListMyPosts.mockResolvedValue([
    post('live', 'active'),
    post('d-new', 'draft'),
    post('d-old', 'draft', { make: 'VW', model: 'Golf' }),
  ]);
  await expect(findServerDraft()).resolves.toEqual({ id: 'd-new', label: 'Ford Fiesta · Blue' });
});

it('leaves the colour off when there is none', async () => {
  mockListMyPosts.mockResolvedValue([post('d1', 'draft', { colour: null })]);
  await expect(findServerDraft()).resolves.toEqual({ id: 'd1', label: 'Ford Fiesta' });
});

it('finds nothing when no listing is a draft', async () => {
  mockListMyPosts.mockResolvedValue([post('live', 'active')]);
  await expect(findServerDraft()).resolves.toBeNull();
});

it('a failed lookup means "no draft known", never an error', async () => {
  mockListMyPosts.mockRejectedValue(new Error('offline'));
  await expect(findServerDraft()).resolves.toBeNull();
});

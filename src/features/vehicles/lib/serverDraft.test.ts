/**
 * WHAT:  Tests for ./serverDraft.ts — which draft listing the + button finds,
 *        and that the report screen gets it exactly once.
 * WHY:   The "Finish your draft?" question must name the right car, never
 *        fail a report on a lookup error, and not repeat on a later visit.
 * LINKS: ./serverDraft.ts; src/features/garage/screens/StartReportScreen.tsx.
 */

import { primeServerDraft, takePrimedServerDraft } from './serverDraft';

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
  takePrimedServerDraft();
});

it('finds the newest draft (the list is newest first) and names its car', async () => {
  mockListMyPosts.mockResolvedValue([
    post('live', 'active'),
    post('d-new', 'draft'),
    post('d-old', 'draft', { make: 'VW', model: 'Golf' }),
  ]);
  await primeServerDraft();
  expect(takePrimedServerDraft()).toEqual({ id: 'd-new', label: 'Ford Fiesta · Blue' });
});

it('finds nothing when no listing is a draft', async () => {
  mockListMyPosts.mockResolvedValue([post('live', 'active')]);
  await primeServerDraft();
  expect(takePrimedServerDraft()).toBeNull();
});

it('a failed lookup means "no draft known", never an error', async () => {
  mockListMyPosts.mockRejectedValue(new Error('offline'));
  await expect(primeServerDraft()).resolves.toBeUndefined();
  expect(takePrimedServerDraft()).toBeNull();
});

it('hands the draft over once', async () => {
  mockListMyPosts.mockResolvedValue([post('d1', 'draft')]);
  await primeServerDraft();
  expect(takePrimedServerDraft()?.id).toBe('d1');
  expect(takePrimedServerDraft()).toBeNull();
});

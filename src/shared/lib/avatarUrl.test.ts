/**
 * WHAT:  Tests for avatarUrlFromPath — the avatar is shown through a signed
 *        URL, never a public one (security audit run 2, lead 2).
 * WHY:   The avatars bucket goes private; a public URL would 404 and a bucket
 *        left public would let anyone holding a uid fetch the photo.
 * LINKS: ./avatarUrl.ts.
 */

import { avatarUrlFromPath } from './avatarUrl';

const mockCreateSignedUrl = jest.fn();
const mockFrom = jest.fn((_bucket: string) => ({ createSignedUrl: mockCreateSignedUrl }));

jest.mock('@/shared/api', () => ({
  supabase: { storage: { from: (bucket: string) => mockFrom(bucket) } },
}));

beforeEach(() => {
  mockCreateSignedUrl.mockReset();
  mockFrom.mockClear();
});

it('signs the stored path in the avatars bucket', async () => {
  mockCreateSignedUrl.mockResolvedValue({
    data: { signedUrl: 'https://x/sign/u1?token=t' },
    error: null,
  });
  await expect(avatarUrlFromPath('u1/avatar.jpg')).resolves.toBe('https://x/sign/u1?token=t');
  expect(mockFrom).toHaveBeenCalledWith('avatars');
  expect(mockCreateSignedUrl).toHaveBeenCalledWith('u1/avatar.jpg', expect.any(Number));
});

it('is null without a stored photo, and asks nothing', async () => {
  await expect(avatarUrlFromPath(null)).resolves.toBeNull();
  expect(mockCreateSignedUrl).not.toHaveBeenCalled();
});

it('falls back to no photo when signing fails', async () => {
  mockCreateSignedUrl.mockResolvedValue({ data: null, error: new Error('Object not found') });
  await expect(avatarUrlFromPath('u1/avatar.jpg')).resolves.toBeNull();
});

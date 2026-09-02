/**
 * WHAT:  Tests for the single Supabase client — where the session is persisted,
 *        how it is configured, and that a missing config fails loudly.
 * WHY:   ⚠️ NO COVERAGE until 2026-09-02, on 52 lines that decide where every
 *        user's ACCESS AND REFRESH TOKENS are stored on their phone.
 *
 *        The property worth a test is the one that would regress silently:
 *        **the storage adapter must be SecureStore, not AsyncStorage.** The
 *        keychain (Keychain / Keystore) is encrypted at rest; AsyncStorage is a
 *        plaintext file readable on a rooted or jailbroken device, and on a
 *        device-level backup. Swapping the adapter is a one-line change that
 *        makes every test in the repo still pass, the app still work, and the
 *        credentials plaintext — SECURITY_AND_TRUST §3/§6 names the choice, and
 *        until now nothing enforced it.
 *
 *        `detectSessionInUrl: false` is pinned for a smaller reason: it is a
 *        web concern, and leaving it on makes the client parse URL fragments on
 *        a native app that never receives one.
 *
 *        ⚠️ Every test here uses `jest.isolateModules`-style resetting, because
 *        the module reads env and constructs the client at IMPORT time — which
 *        is also exactly why a missing key is a startup crash rather than a
 *        confusing network error twenty screens later.
 * LINKS: ./supabase.ts; docs/SECURITY_AND_TRUST.md §3 and §6;
 *        src/features/auth/hooks/useSession.ts (the first consumer).
 */

// Typed with a rest parameter so `mock.calls[0][2]` is reachable — a
// zero-arg jest.fn() gives calls the tuple type `[]`, and the options object
// this suite is entirely about would be untypeable.
const mockCreateClient = jest.fn((..._args: unknown[]) => ({ auth: {} }));
jest.mock('@supabase/supabase-js', () => ({
  createClient: (...args: unknown[]) => mockCreateClient(...(args as [])),
}));

const mockGetItemAsync = jest.fn();
const mockSetItemAsync = jest.fn();
const mockDeleteItemAsync = jest.fn();
jest.mock('expo-secure-store', () => ({
  getItemAsync: (...args: unknown[]) => mockGetItemAsync(...args),
  setItemAsync: (...args: unknown[]) => mockSetItemAsync(...args),
  deleteItemAsync: (...args: unknown[]) => mockDeleteItemAsync(...args),
}));

jest.mock('react-native-url-polyfill/auto', () => ({}));

const URL = 'https://project.supabase.co';
const KEY = 'anon-key';

/** Load a fresh copy of the module with the given env. */
function loadWith(env: { url?: string; key?: string }) {
  jest.resetModules();
  // `delete`, not assignment: process.env coerces, so `= undefined` stores the
  // STRING "undefined" — which is truthy, and would sail past the guard being
  // tested here while looking like it had been cleared.
  if (env.url === undefined) delete process.env.EXPO_PUBLIC_SUPABASE_URL;
  else process.env.EXPO_PUBLIC_SUPABASE_URL = env.url;
  if (env.key === undefined) delete process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
  else process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY = env.key;
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- the module reads env at import time; that is the behaviour under test
  return require('./supabase') as typeof import('./supabase');
}

const savedUrl = process.env.EXPO_PUBLIC_SUPABASE_URL;
const savedKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

beforeEach(() => {
  mockCreateClient.mockClear();
  mockGetItemAsync.mockReset();
  mockSetItemAsync.mockReset();
  mockDeleteItemAsync.mockReset();
});

afterAll(() => {
  process.env.EXPO_PUBLIC_SUPABASE_URL = savedUrl;
  process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY = savedKey;
  jest.resetModules();
});

describe('the Supabase client', () => {
  it('is built from the two public env vars', () => {
    loadWith({ url: URL, key: KEY });
    expect(mockCreateClient).toHaveBeenCalledWith(URL, KEY, expect.anything());
  });

  it('⚠️ persists the session in the OS keychain, not AsyncStorage', async () => {
    loadWith({ url: URL, key: KEY });

    const options = mockCreateClient.mock.calls[0][2] as {
      auth: { storage: { getItem: (k: string) => unknown; setItem: (k: string, v: string) => unknown; removeItem: (k: string) => unknown } };
    };
    const storage = options.auth.storage;

    // Each adapter method must reach expo-secure-store. If any of them were
    // ever repointed at AsyncStorage, a refresh token would sit in a plaintext
    // file readable on a rooted device or in a device backup.
    await storage.getItem('sb-project-auth-token');
    await storage.setItem('sb-project-auth-token', 'token');
    await storage.removeItem('sb-project-auth-token');

    expect(mockGetItemAsync).toHaveBeenCalledWith('sb-project-auth-token');
    expect(mockSetItemAsync).toHaveBeenCalledWith('sb-project-auth-token', 'token');
    expect(mockDeleteItemAsync).toHaveBeenCalledWith('sb-project-auth-token');
  });

  it('persists and refreshes, and does not read the URL for a session', () => {
    loadWith({ url: URL, key: KEY });

    const options = mockCreateClient.mock.calls[0][2] as { auth: Record<string, unknown> };
    expect(options.auth).toMatchObject({
      persistSession: true,
      autoRefreshToken: true,
      // A web concern. A native app never receives a session in a URL
      // fragment, and parsing for one is work with a surface attached.
      detectSessionInUrl: false,
    });
  });

  it('⚠️ throws at import when the config is missing, rather than at first use', () => {
    // The alternative is a confusing network error twenty screens later, on
    // someone else's machine. The message names the fix.
    expect(() => loadWith({ url: undefined, key: KEY })).toThrow(/Copy \.env\.example/);
    expect(() => loadWith({ url: URL, key: undefined })).toThrow(/EXPO_PUBLIC_SUPABASE_ANON_KEY/);
  });

  it('treats an empty string as missing, not as a value', () => {
    // A half-filled .env is a likelier mistake than an absent one, and an
    // empty URL would otherwise construct a client that fails on every call.
    expect(() => loadWith({ url: '', key: KEY })).toThrow(/Missing Supabase config/);
  });
});

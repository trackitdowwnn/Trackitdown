/**
 * WHAT:  Tests for the dispute screen — every server-driven state renders the
 *        right card, filing re-reads rather than assumes, and every refusal
 *        collapses to the calm window-closed answer.
 * WHY:   This screen is a spotter's only lever against an owner denying them
 *        £47.50-£4,750. The states must be exact: showing the form after the
 *        window closed invites a doomed submission; showing "we're looking
 *        into it" before the server recorded anything is a lie about money.
 * LINKS: ./SightingDisputeScreen.tsx; ../api/disputeApi.ts;
 *        supabase/migrations/20260805100000_refund_holds_and_disputes.sql.
 */

import { act, fireEvent, render } from '@testing-library/react-native';

import { DisputeError } from '../api/disputeApi';
import { SightingDisputeScreen } from './SightingDisputeScreen';

jest.mock('react-native-safe-area-context', () =>
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- jest.mock factories cannot use ESM imports
  require('react-native-safe-area-context/jest/mock').default,
);

const mockPush = jest.fn();
jest.mock('expo-router', () => ({
  useRouter: () => ({
    back: jest.fn(),
    push: mockPush,
    replace: jest.fn(),
    canGoBack: () => true,
  }),
}));

const mockShowToast = jest.fn();
jest.mock('@/shared/ui', () => {
  const actual = jest.requireActual('@/shared/ui');
  return {
    ...actual,
    get useToast() {
      return () => ({ show: mockShowToast });
    },
  };
});

const mockFetchContext = jest.fn();
const mockOpenDispute = jest.fn();
// A REAL class, not requireActual: the real module imports the supabase
// client, which throws at import without env vars — and the screen branches
// on `instanceof DisputeError`, so a stand-in object would silently skip
// those branches.
jest.mock('../api/disputeApi', () => ({
  DisputeError: class DisputeError extends Error {
    code: string;
    constructor(message: string, code: string) {
      super(message);
      this.name = 'DisputeError';
      this.code = code;
    }
  },
  fetchDisputeContext: (...args: unknown[]) => mockFetchContext(...args),
  openDispute: (...args: unknown[]) => mockOpenDispute(...args),
}));

const SIGHTING_ID = 'd0d0d0d0-0000-0000-0000-000000000001';

const context = (overrides: Record<string, unknown> = {}) => ({
  car: { make: 'Fiesta', colour: 'Blue' },
  windowEndsAt: '2026-08-08T12:00:00Z',
  bountySharePence: 19000,
  dispute: null,
  ...overrides,
});

beforeEach(() => {
  jest.clearAllMocks();
  mockFetchContext.mockResolvedValue(context());
  mockOpenDispute.mockResolvedValue(undefined);
});

describe('what each state shows', () => {
  it('asks the question with the car and the money when nothing is filed yet', async () => {
    const { getByTestId, getByText } = await act(async () =>
      render(<SightingDisputeScreen sightingId={SIGHTING_ID} />),
    );
    expect(getByTestId('dispute-form')).toBeTruthy();
    // Server-derived share, never client arithmetic.
    expect(getByText(/£190/)).toBeTruthy();
    expect(getByText(/Blue Fiesta/)).toBeTruthy();
  });

  it('shows the calm closed state when the server says there is nothing here', async () => {
    // One answer for every reason (not yours, window over, money moved) —
    // the no-oracle rule carried through to the UI.
    mockFetchContext.mockResolvedValue(null);
    const { getByText, queryByTestId } = await act(async () =>
      render(<SightingDisputeScreen sightingId={SIGHTING_ID} />),
    );
    expect(getByText('Nothing to do here')).toBeTruthy();
    expect(queryByTestId('dispute-form')).toBeNull();
  });

  it('says "we are looking into it" once filed — and promises nothing else', async () => {
    mockFetchContext.mockResolvedValue(
      context({ dispute: { status: 'open', createdAt: '2026-08-05T10:00:00Z' } }),
    );
    const { getByTestId } = await act(async () =>
      render(<SightingDisputeScreen sightingId={SIGHTING_ID} />),
    );
    expect(getByTestId('dispute-open')).toBeTruthy();
  });

  it('sends a winner to payouts with their number', async () => {
    mockFetchContext.mockResolvedValue(
      context({ dispute: { status: 'upheld', createdAt: '2026-08-05T10:00:00Z' } }),
    );
    const { getByTestId, getByText } = await act(async () =>
      render(<SightingDisputeScreen sightingId={SIGHTING_ID} />),
    );
    expect(getByTestId('dispute-upheld')).toBeTruthy();
    await act(async () => {
      fireEvent.press(getByText('Set up the payout'));
    });
    expect(mockPush).toHaveBeenCalledWith('/payouts');
  });

  it('closes a rejection kindly and finally — no reasons, no appeal', async () => {
    mockFetchContext.mockResolvedValue(
      context({ dispute: { status: 'rejected', createdAt: '2026-08-05T10:00:00Z' } }),
    );
    const { getByTestId, queryByText } = await act(async () =>
      render(<SightingDisputeScreen sightingId={SIGHTING_ID} />),
    );
    expect(getByTestId('dispute-rejected')).toBeTruthy();
    expect(queryByText(/appeal/i)).toBeNull();
  });
});

describe('filing', () => {
  it('files with the statement and RE-READS rather than assuming', async () => {
    const { getByTestId, getByText } = await act(async () =>
      render(<SightingDisputeScreen sightingId={SIGHTING_ID} />),
    );
    await act(async () => {
      fireEvent.changeText(getByTestId('dispute-statement'), 'I found it on Monday.');
    });
    mockFetchContext.mockResolvedValue(
      context({ dispute: { status: 'open', createdAt: '2026-08-05T10:00:00Z' } }),
    );
    await act(async () => {
      fireEvent.press(getByText('My sighting led to this recovery'));
    });
    expect(mockOpenDispute).toHaveBeenCalledWith(SIGHTING_ID, 'I found it on Monday.');
    // The filed card came from the server's answer, not from optimism.
    expect(getByTestId('dispute-open')).toBeTruthy();
    expect(mockFetchContext).toHaveBeenCalledTimes(2);
  });

  it('collapses a refusal into the closed state, not an error loop', async () => {
    mockOpenDispute.mockRejectedValue(
      new DisputeError('This one can’t be contested any more.', 'DISPUTE_NOT_AVAILABLE'),
    );
    const { getByText } = await act(async () =>
      render(<SightingDisputeScreen sightingId={SIGHTING_ID} />),
    );
    await act(async () => {
      fireEvent.press(getByText('My sighting led to this recovery'));
    });
    expect(getByText('Nothing to do here')).toBeTruthy();
    expect(mockShowToast).toHaveBeenCalledWith(expect.stringContaining('contested'), 'error');
  });
});

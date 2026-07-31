/**
 * WHAT:  Tests for the alerts api layer — the strict response schema, the
 *        miles/metres boundary, criteria mapping, and the "render what the
 *        server stored" contract.
 * WHY:   SAFETY. Two properties are load-bearing and silent when broken: the
 *        schema is `.strict()` so a widened RPC fails loudly in one place
 *        instead of shipping a new column into the UI, and create/update must
 *        return the STORED (snapped) point rather than echoing what was sent —
 *        the whole approximate-area promise is that those differ.
 * LINKS: ./alertsApi.ts; supabase/migrations/20260802150000_multi_alert.sql.
 */

import {
  createAlert,
  deleteAlert,
  fetchMyAlerts,
  setAlertEnabled,
  updateAlert,
} from './alertsApi';
import type { AlertDraft } from '../types';

const mockRpc = jest.fn();
jest.mock('@/shared/api', () => ({
  supabase: { rpc: (...args: unknown[]) => mockRpc(...args) },
}));

/** A row as the RPC returns it: 10 miles, snapped to the ~1km grid. */
const row = {
  id: '11111111-2222-3333-4444-555555555555',
  name: 'Home',
  lat: 51.5,
  lng: -0.13,
  radius_m: 16093,
  enabled: true,
  approximate: true,
  make: 'BMW',
  model: null,
  colour: 'Blue',
  body_type: null,
  min_bounty_pence: 50000,
  recency_days: null,
  updated_at: '2026-07-31T12:00:00Z',
};

const draft: AlertDraft = {
  name: '  Home  ',
  latitude: 51.5119,
  longitude: -0.1278,
  radiusMiles: 10,
  enabled: true,
  approximate: true,
  criteria: {
    make: 'BMW',
    model: null,
    colour: 'Blue',
    bodyType: null,
    minBountyPence: 50000,
    recencyDays: null,
  },
};

beforeEach(() => jest.clearAllMocks());

describe('fetchMyAlerts', () => {
  it('maps rows into miles and a criteria object', async () => {
    mockRpc.mockResolvedValue({ data: [row], error: null });
    const [alert] = await fetchMyAlerts();
    expect(alert).toMatchObject({
      id: row.id,
      name: 'Home',
      radiusMiles: 10,
      criteria: { make: 'BMW', colour: 'Blue', minBountyPence: 50000, model: null },
    });
  });

  it('returns an empty list rather than erroring when there are none', async () => {
    mockRpc.mockResolvedValue({ data: [], error: null });
    await expect(fetchMyAlerts()).resolves.toEqual([]);
  });

  it('throws on a widened row rather than passing the new field through', async () => {
    // SAFETY: `.strict()`. If the RPC grows a column this must fail here —
    // loudly, in one place — instead of silently reaching the UI.
    mockRpc.mockResolvedValue({ data: [{ ...row, home_address: '12 Shenley Rd' }], error: null });
    await expect(fetchMyAlerts()).rejects.toThrow();
  });

  it('throws when the RPC errors', async () => {
    mockRpc.mockResolvedValue({ data: null, error: { message: 'boom', code: '42501' } });
    await expect(fetchMyAlerts()).rejects.toThrow('boom');
  });
});

describe('createAlert', () => {
  it('trims the name, converts miles to metres, and sends criteria as nulls for "any"', async () => {
    mockRpc.mockResolvedValue({ data: row, error: null });
    await createAlert(draft);

    expect(mockRpc).toHaveBeenCalledWith('create_my_alert', {
      p_name: 'Home',
      p_lat: 51.5119,
      p_lng: -0.1278,
      p_radius_m: 16093,
      p_approximate: true,
      p_enabled: true,
      p_make: 'BMW',
      p_model: null,
      p_colour: 'Blue',
      p_body_type: null,
      p_min_bounty_pence: 50000,
      p_recency_days: null,
    });
  });

  it('returns the STORED point, not the one it sent', async () => {
    mockRpc.mockResolvedValue({ data: row, error: null });
    const saved = await createAlert(draft);
    // The coarsening actually happening — not an echo of the input.
    expect(saved.latitude).toBe(51.5);
    expect(saved.latitude).not.toBe(draft.latitude);
  });

  it('surfaces the cap token so the screen can explain it', async () => {
    mockRpc.mockResolvedValue({ data: null, error: { message: 'ALERT_LIMIT_REACHED' } });
    await expect(createAlert(draft)).rejects.toThrow('ALERT_LIMIT_REACHED');
  });
});

describe('updateAlert', () => {
  it('scopes to the alert id and re-sends the whole draft (full replace)', async () => {
    mockRpc.mockResolvedValue({ data: row, error: null });
    await updateAlert(row.id, draft);
    expect(mockRpc).toHaveBeenCalledWith(
      'update_my_alert',
      expect.objectContaining({ p_alert_id: row.id, p_name: 'Home', p_make: 'BMW' }),
    );
  });

  it('surfaces ALERT_NOT_FOUND for someone else’s alert', async () => {
    mockRpc.mockResolvedValue({ data: null, error: { message: 'ALERT_NOT_FOUND' } });
    await expect(updateAlert(row.id, draft)).rejects.toThrow('ALERT_NOT_FOUND');
  });
});

describe('deleteAlert / setAlertEnabled', () => {
  it('deletes by id', async () => {
    mockRpc.mockResolvedValue({ data: { deleted: true }, error: null });
    await deleteAlert(row.id);
    expect(mockRpc).toHaveBeenCalledWith('delete_my_alert', { p_alert_id: row.id });
  });

  it('pauses ONE alert without sending coordinates', async () => {
    mockRpc.mockResolvedValue({ data: { ...row, enabled: false }, error: null });
    const alert = await setAlertEnabled(row.id, false);
    // Pausing must not round-trip a location, so it can never re-store the
    // point at a different precision than the user chose.
    expect(mockRpc).toHaveBeenCalledWith('set_my_alert_enabled', {
      p_alert_id: row.id,
      p_enabled: false,
    });
    expect(alert.enabled).toBe(false);
  });
});

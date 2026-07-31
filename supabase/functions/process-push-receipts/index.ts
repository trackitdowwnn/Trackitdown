/**
 * WHAT:  Drains parked Expo push tickets into receipts and prunes the device
 *        tokens Expo reports as gone.
 * WHY:   Expo's push API is two-phase — a send only tells you Expo accepted
 *        the message; whether it reached the device shows up in a receipt
 *        ~15 minutes later. Without this drain, uninstalled devices are
 *        pushed to forever and every send slowly gets more wasteful.
 *        Split into its own function (rather than living inside notify-*)
 *        so it can be invoked fire-and-forget without adding its latency to
 *        the send path, and so a future pg_cron schedule has something to
 *        call with no code change.
 * LINKS: supabase/functions/_shared/push.ts (drainPushReceipts);
 *        supabase/functions/notify-spotters/index.ts (opportunistic caller);
 *        supabase/functions/README.md; src/features/notifications/README.md.
 */

import { drainPushReceipts } from '../_shared/push.ts';
import { createServiceRoleClient, requireEnv } from '../_shared/clients.ts';
import { errorResponse, jsonResponse, preflightResponse } from '../_shared/http.ts';

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return preflightResponse();
  if (request.method !== 'POST') {
    return errorResponse('METHOD_NOT_ALLOWED', 'Use POST.', 405);
  }

  // SERVICE-TO-SERVICE ONLY. This is not a user-facing endpoint: it reads the
  // whole receipt table and deletes device tokens. Compare the bearer against
  // the service-role key rather than resolving it to a user — an authenticated
  // caller must not be able to reach it at all.
  const bearer = request.headers.get('Authorization')?.replace('Bearer ', '') ?? '';
  if (bearer !== requireEnv('SUPABASE_SERVICE_ROLE_KEY')) {
    return errorResponse('NOT_AUTHORISED', 'Service role required.', 401);
  }

  try {
    const admin = createServiceRoleClient();
    const result = await drainPushReceipts(admin);
    // Counts only — never a token, never a user id.
    console.log('[notifications] receipts drained', result);
    return jsonResponse(result);
  } catch (err) {
    console.error('[notifications] receipt drain failed', (err as Error).message);
    return errorResponse('DRAIN_FAILED', 'Could not drain push receipts.', 500);
  }
});

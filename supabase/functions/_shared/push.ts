/**
 * WHAT:  The ONE push-sending utility every notification type uses — chunked
 *        sends to Expo's push API, ticket handling, and the deferred receipt
 *        drain that prunes dead device tokens.
 * WHY:   Without a single door here, every feature grows its own fetch to
 *        exp.host and its own idea of what to do with a DeviceNotRegistered.
 *        Expo's API is TWO-PHASE and that is the part everyone gets wrong: a
 *        send returns *tickets* (accepted by Expo), and real delivery errors
 *        only surface later in *receipts*. Both stages can report a dead
 *        token, so both stages prune.
 *        Raw fetch rather than expo-server-sdk: one less npm: specifier to
 *        pin, and the whole contract is ~2 endpoints.
 * LINKS: supabase/functions/notify-spotters/index.ts (the main caller);
 *        supabase/functions/process-push-receipts/index.ts (the drain);
 *        supabase/migrations/20260802100000_push_infrastructure.sql
 *        (push_tokens / push_receipts / prune_push_token);
 *        https://docs.expo.dev/push-notifications/sending-notifications/;
 *        src/features/notifications/README.md.
 */

import type { SupabaseClient } from 'npm:@supabase/supabase-js@2.45.4';

const EXPO_SEND_URL = 'https://exp.host/--/api/v2/push/send';
const EXPO_RECEIPTS_URL = 'https://exp.host/--/api/v2/push/getReceipts';

/** Expo's documented per-request maximums. Exceeding either is a hard error
 *  (PUSH_TOO_MANY_NOTIFICATIONS / PUSH_TOO_MANY_RECEIPTS), not a truncation. */
const MAX_MESSAGES_PER_REQUEST = 100;
const MAX_RECEIPT_IDS_PER_REQUEST = 1000;

/** Expo recommends waiting 15 minutes before reading receipts; they are
 *  cleared after 24 hours. Draining sooner mostly returns nothing, so the
 *  opportunistic drain deliberately ignores anything younger than this. */
const RECEIPT_MIN_AGE_MS = 15 * 60 * 1000;
/** Past this, a receipt is gone from Expo's side — stop asking and bin the row. */
const RECEIPT_MAX_AGE_MS = 24 * 60 * 60 * 1000;

/** One notification, addressed to a single Expo push token. */
export interface PushMessage {
  to: string;
  title: string;
  body: string;
  /** SAFETY: ids only. The client parses this through a `.strict()` schema
   *  (src/features/notifications/lib/pushPayload.ts), so anything richer than
   *  ids fails the parse and the tap is dropped rather than acted on. */
  data: Record<string, unknown>;
  /** Android channel; must already exist on the device (created at launch). */
  channelId?: string;
  priority?: 'default' | 'normal' | 'high';
  sound?: 'default' | null;
  /** Replace rather than stack an earlier notification about the same thing.
   *  `collapseId` is the iOS/Expo name, `tag` the Android one — both needed. */
  collapseId?: string;
  tag?: string;
}

export interface SendPushResult {
  /** Tickets Expo accepted (NOT deliveries — see the receipt drain). */
  accepted: number;
  /** Tickets Expo rejected outright. */
  rejected: number;
  /** Tokens deleted because Expo said the device is gone. */
  pruned: number;
}

interface ExpoTicket {
  status: 'ok' | 'error';
  id?: string;
  message?: string;
  details?: { error?: string };
}

interface ExpoReceipt {
  status: 'ok' | 'error';
  message?: string;
  details?: { error?: string };
}

function chunk<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/** Enhanced Security for Push Notifications makes this mandatory; without it
 *  enabled the header is simply ignored, so sending it whenever we have one
 *  is always correct. */
function expoHeaders(): HeadersInit {
  const headers: Record<string, string> = {
    accept: 'application/json',
    'accept-encoding': 'gzip, deflate',
    'content-type': 'application/json',
  };
  const accessToken = Deno.env.get('EXPO_ACCESS_TOKEN');
  if (accessToken) headers.authorization = `Bearer ${accessToken}`;
  return headers;
}

/**
 * Send a batch of notifications. Chunks to Expo's 100-per-request limit,
 * parks each accepted ticket id for the later receipt drain, and prunes any
 * token Expo rejects immediately.
 *
 * NEVER THROWS. A notification is a nudge — losing one must not fail the
 * caller's request (for spotter alerts the caller is the Stripe webhook, where
 * throwing would turn a settled payment into a retry). Failures are counted
 * and logged; a bad chunk does not stop the remaining chunks.
 */
export async function sendExpoPush(
  admin: SupabaseClient,
  messages: readonly PushMessage[],
): Promise<SendPushResult> {
  const result: SendPushResult = { accepted: 0, rejected: 0, pruned: 0 };
  if (messages.length === 0) return result;

  for (const batch of chunk(messages, MAX_MESSAGES_PER_REQUEST)) {
    let tickets: ExpoTicket[];
    try {
      const response = await fetch(EXPO_SEND_URL, {
        method: 'POST',
        headers: expoHeaders(),
        body: JSON.stringify(batch),
      });
      const payload = (await response.json()) as { data?: ExpoTicket[]; errors?: unknown };
      if (!response.ok || !Array.isArray(payload.data)) {
        // Request-level failure (TOO_MANY_REQUESTS, UNAUTHORIZED, …). Nothing
        // in this chunk was accepted; the post is still visible in-app.
        console.error('[notifications] expo send rejected the batch', response.status);
        result.rejected += batch.length;
        continue;
      }
      tickets = payload.data;
    } catch (err) {
      console.error('[notifications] expo send failed', (err as Error).message);
      result.rejected += batch.length;
      continue;
    }

    // Tickets map POSITIONALLY onto the messages we sent, which is the only
    // way to know whose token a failure belongs to.
    const pending: { ticket_id: string; token: string }[] = [];
    const dead: string[] = [];
    tickets.forEach((ticket, index) => {
      const token = batch[index]?.to;
      if (ticket.status === 'ok' && ticket.id) {
        result.accepted += 1;
        if (token) pending.push({ ticket_id: ticket.id, token });
        return;
      }
      result.rejected += 1;
      // DeviceNotRegistered can arrive HERE as well as in the receipt — the
      // app was uninstalled and Expo already knows.
      if (ticket.details?.error === 'DeviceNotRegistered' && token) dead.push(token);
      else if (ticket.status === 'error') {
        console.error('[notifications] push ticket error', ticket.details?.error ?? 'unknown');
      }
    });

    if (pending.length > 0) {
      const { error } = await admin.from('push_receipts').upsert(pending, {
        onConflict: 'ticket_id',
      });
      // A parking failure costs us the ability to prune later, nothing more.
      if (error) console.error('[notifications] could not park tickets', error.message);
    }
    result.pruned += await pruneTokens(admin, dead);
  }

  return result;
}

/** Supabase `.in()` goes in the URL, so a large audience 414s without this. */
const MAX_IDS_PER_QUERY = 200;

/** The Android channel every notification targets. Must match ALERTS_CHANNEL_ID
 *  in src/features/notifications/lib/pushDevice.ts — Android silently DROPS a
 *  notification whose channel does not exist on the device. */
const ANDROID_CHANNEL_ID = 'alerts';

/**
 * The one fan-out: user ids → their devices → Expo. Every notification type
 * goes through here, so audience chunking, channel id and priority are decided
 * once rather than per feature.
 *
 * A user with several devices gets one notification per device — that is the
 * point of keying push_tokens on the token.
 */
export async function sendToUsers(
  admin: SupabaseClient,
  userIds: readonly string[],
  content: {
    title: string;
    body: string;
    data: Record<string, unknown>;
    /**
     * Collapse key. Notifications sharing one REPLACE each other on the device
     * instead of stacking. This is the volume control for the paths that have
     * no per-user cap: chat allows 20 messages per minute per thread, so
     * without collapsing, someone typing fast buzzes the recipient 20 times.
     * The user still sees every message in-app — only the banner collapses.
     */
    collapseKey?: string;
  },
): Promise<SendPushResult> {
  const unique = [...new Set(userIds)];
  if (unique.length === 0) return { accepted: 0, rejected: 0, pruned: 0 };

  const messages: PushMessage[] = [];
  for (const batch of chunk(unique, MAX_IDS_PER_QUERY)) {
    const { data, error } = await admin
      .from('push_tokens')
      .select('token')
      .in('user_id', batch);
    if (error) {
      console.error('[notifications] token lookup failed', error.message);
      continue;
    }
    for (const row of data ?? []) {
      messages.push({
        to: row.token as string,
        title: content.title,
        body: content.body,
        data: content.data,
        channelId: ANDROID_CHANNEL_ID,
        priority: 'high',
        sound: 'default',
        collapseId: content.collapseKey,
        tag: content.collapseKey,
      });
    }
  }

  return sendExpoPush(admin, messages);
}

/** Delete tokens Expo has told us are dead. Best-effort and idempotent. */
async function pruneTokens(admin: SupabaseClient, tokens: readonly string[]): Promise<number> {
  let pruned = 0;
  for (const token of new Set(tokens)) {
    const { error } = await admin.rpc('prune_push_token', { p_token: token });
    if (error) console.error('[notifications] token prune failed', error.message);
    else pruned += 1;
  }
  return pruned;
}

export interface DrainReceiptsResult {
  checked: number;
  pruned: number;
}

/**
 * Read receipts for tickets parked at least RECEIPT_MIN_AGE_MS ago and prune
 * the tokens Expo reports as gone.
 *
 * HONEST LIMITATION: there is no pg_cron in this project, so this runs
 * opportunistically — `notify-spotters` fire-and-forgets it at the start of
 * each run. A dead token is therefore pruned on some LATER send, not the one
 * that discovered it. The cost is a handful of wasted sends to a dead device;
 * the alternative is a scheduler this project does not have. pg_cron is the
 * upgrade path, and it needs no change here beyond who calls it.
 */
export async function drainPushReceipts(admin: SupabaseClient): Promise<DrainReceiptsResult> {
  const result: DrainReceiptsResult = { checked: 0, pruned: 0 };
  const now = Date.now();

  // Expo clears receipts after 24h — anything older will never resolve, so
  // bin it rather than asking forever.
  await admin
    .from('push_receipts')
    .delete()
    .lt('created_at', new Date(now - RECEIPT_MAX_AGE_MS).toISOString());

  const { data: rows, error } = await admin
    .from('push_receipts')
    .select('ticket_id, token')
    .lt('created_at', new Date(now - RECEIPT_MIN_AGE_MS).toISOString())
    .order('created_at', { ascending: true })
    .limit(MAX_RECEIPT_IDS_PER_REQUEST);

  if (error) {
    console.error('[notifications] could not read parked tickets', error.message);
    return result;
  }
  if (!rows || rows.length === 0) return result;

  const tokenByTicket = new Map<string, string>(
    rows.map((row) => [row.ticket_id as string, row.token as string]),
  );

  for (const batch of chunk([...tokenByTicket.keys()], MAX_RECEIPT_IDS_PER_REQUEST)) {
    let receipts: Record<string, ExpoReceipt>;
    try {
      const response = await fetch(EXPO_RECEIPTS_URL, {
        method: 'POST',
        headers: expoHeaders(),
        body: JSON.stringify({ ids: batch }),
      });
      const payload = (await response.json()) as { data?: Record<string, ExpoReceipt> };
      if (!response.ok || !payload.data) {
        console.error('[notifications] expo receipts rejected', response.status);
        continue;
      }
      // NOTE: the receipts response is a MAP keyed by ticket id, not an array.
      receipts = payload.data;
    } catch (err) {
      console.error('[notifications] expo receipts failed', (err as Error).message);
      continue;
    }

    const dead: string[] = [];
    const settled: string[] = [];
    for (const [ticketId, receipt] of Object.entries(receipts)) {
      settled.push(ticketId);
      result.checked += 1;
      if (receipt.status !== 'error') continue;
      const reason = receipt.details?.error;
      if (reason === 'DeviceNotRegistered') {
        const token = tokenByTicket.get(ticketId);
        if (token) dead.push(token);
      } else {
        // MessageTooBig / MessageRateExceeded / MismatchSenderId /
        // InvalidCredentials. All are OUR configuration or payload problems,
        // not the device's — log loudly, prune nothing.
        console.error('[notifications] push receipt error', reason ?? 'unknown');
      }
    }

    result.pruned += await pruneTokens(admin, dead);
    if (settled.length > 0) {
      await admin.from('push_receipts').delete().in('ticket_id', settled);
    }
  }

  return result;
}

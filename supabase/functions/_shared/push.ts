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
import { createLog } from './log.ts';
import { describeError } from './redact.ts';

const log = createLog('push');

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
    const isolate: Isolation = { requestsLeft: MAX_ISOLATION_REQUESTS, failedAlone: [] };
    const acceptedBefore = result.accepted;
    await sendChunk(admin, batch, result, isolate);
    // A token that fails a request on its own is pruned ONLY when others in
    // the same chunk got through — otherwise the cause was ours (a bad access
    // token, say), and pruning would delete every user's token.
    if (isolate.failedAlone.length > 0 && result.accepted > acceptedBefore) {
      result.pruned += await pruneTokens(admin, isolate.failedAlone);
    }
  }

  return result;
}

/** Halving a 100-message chunk to one bad message takes ~14 requests; 64
 *  leaves room for a few bad tokens without letting a global failure multiply. */
const MAX_ISOLATION_REQUESTS = 64;

interface Isolation {
  requestsLeft: number;
  failedAlone: string[];
}

/** A 4xx that one message could cause. Not 429 (our rate) and not a 5xx (Expo's outage). */
function couldBeOneToken(status: number): boolean {
  return status >= 400 && status < 500 && status !== 429;
}

async function sendChunk(
  admin: SupabaseClient,
  batch: readonly PushMessage[],
  result: SendPushResult,
  isolate: Isolation,
): Promise<void> {
  let tickets: ExpoTicket[];
  try {
    const response = await fetch(EXPO_SEND_URL, {
      method: 'POST',
      headers: expoHeaders(),
      body: JSON.stringify(batch),
    });
    const payload = (await response.json()) as { data?: ExpoTicket[]; errors?: unknown };
    if (!response.ok || !Array.isArray(payload.data)) {
      // SAFETY: a token from ANOTHER Expo project (anyone can mint a real one
      // and register it) fails the whole request for every stranger sharing
      // it. Resend each project's tokens on their own (audit run 2, lead 5).
      const groups = splitByProject(batch, payload.errors);
      if (groups) {
        log.error('notifications_batch_mixed_expo_projects_resending_per_project');
        for (const group of groups) await sendChunk(admin, group, result, isolate);
        return;
      }
      // SAFETY: any OTHER error one stranger's token can cause (Enhanced
      // Security on their project, say) would still fail everyone sharing the
      // request, and Expo does not name the token (audit run 3, lead 2). Halve
      // until the message that fails alone is found; the rest still go.
      if (couldBeOneToken(response.status)) {
        if (batch.length === 1) {
          log.warn('notifications_push_token_failed_alone', { status: response.status });
          isolate.failedAlone.push(batch[0].to);
          result.rejected += 1;
          return;
        }
        if (isolate.requestsLeft >= 2) {
          isolate.requestsLeft -= 2;
          log.warn('notifications_batch_rejected_halving', {
            size: batch.length,
            status: response.status,
          });
          const middle = Math.ceil(batch.length / 2);
          await sendChunk(admin, batch.slice(0, middle), result, isolate);
          await sendChunk(admin, batch.slice(middle), result, isolate);
          return;
        }
      }
      // Request-level failure (TOO_MANY_REQUESTS, UNAUTHORIZED, …). Nothing
      // in this chunk was accepted; the post is still visible in-app.
      log.error('notifications_expo_send_rejected_the_batch', { status: response.status });
      result.rejected += batch.length;
      return;
    }
    tickets = payload.data;
  } catch (err) {
    log.error('notifications_expo_send_failed', { error: describeError(err) });
    result.rejected += batch.length;
    return;
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
      log.error('notifications_push_ticket_error', { code: ticket.details?.error ?? 'unknown' });
    }
  });

  if (pending.length > 0) {
    const { error } = await admin.from('push_receipts').upsert(pending, {
      onConflict: 'ticket_id',
    });
    // A parking failure costs us the ability to prune later, nothing more.
    if (error) log.error('notifications_could_not_park_tickets', { error: describeError(error) });
  }
  result.pruned += await pruneTokens(admin, dead);
}

/**
 * PUSH_TOO_MANY_EXPERIENCE_IDS carries `details`: { "@owner/project": [tokens] }.
 * Returns the batch split into those groups (plus one for any token Expo did
 * not name), or null when this is some other failure. Only splits into 2+
 * non-empty groups, so every resend is strictly smaller and the recursion ends.
 */
function splitByProject(batch: readonly PushMessage[], errors: unknown): PushMessage[][] | null {
  const mixed = Array.isArray(errors)
    ? errors.find((e) => e?.code === 'PUSH_TOO_MANY_EXPERIENCE_IDS')
    : undefined;
  const details = mixed?.details;
  if (!details || typeof details !== 'object') return null;

  const projectOf = new Map<string, string>();
  for (const [project, tokens] of Object.entries(details as Record<string, unknown>)) {
    if (Array.isArray(tokens)) for (const t of tokens) projectOf.set(String(t), project);
  }
  const groups = new Map<string, PushMessage[]>();
  for (const message of batch) {
    const key = projectOf.get(message.to) ?? '';
    groups.set(key, [...(groups.get(key) ?? []), message]);
  }
  return groups.size > 1 ? [...groups.values()] : null;
}

/** Supabase `.in()` goes in the URL, so a large audience 414s without this. */
const MAX_IDS_PER_QUERY = 200;
/** register_push_token keeps 10 tokens per user, so 100 users is at most 1000
 *  rows — PostgREST's max_rows, past which the tail is cut with NO error. */
const MAX_USERS_PER_TOKEN_QUERY = 100;

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
    /**
     * The notification kind. REQUIRED, because it is what the per-category
     * preference filter keys on — an optional kind would let a new caller
     * quietly opt out of every mute the user has set.
     */
    kind: string;
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

  const recipients = await filterByPreference(admin, unique, content.kind);
  if (recipients.length < unique.length) {
    // Counts only, no ids. Without this a `sent: 0` is indistinguishable
    // between "nobody has a token", "everybody muted it" and "the filter is
    // broken" — and the third one is the failure that would otherwise be
    // silent in production.
    log.info('notifications_preference_filter_applied', {
      kind: content.kind,
      audience: unique.length,
      after_filter: recipients.length,
    });
  }
  if (recipients.length === 0) return { accepted: 0, rejected: 0, pruned: 0 };

  const messages: PushMessage[] = [];
  for (const batch of chunk(recipients, MAX_USERS_PER_TOKEN_QUERY)) {
    const { data, error } = await admin
      .from('push_tokens')
      .select('token')
      .in('user_id', batch);
    if (error) {
      log.error('notifications_token_lookup_failed', { error: describeError(error) });
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

/**
 * THE RULE (DOMAIN.md, ADR-0012): persist first, then maybe push. Every
 * notification-worthy event calls THIS, which writes one `notifications` row
 * per recipient and then hands the same content to `sendToUsers` — so the
 * in-app center and the push can never disagree, and a user who denied push
 * permission still gets everything in the feed.
 *
 * ORDER IS THE POINT: the row insert comes first, and a push failure (or
 * zero registered tokens) still leaves the rows. An INSERT failure is logged
 * and the push still goes out — a database blip must not eat the lock-screen
 * moment too; the row is the durable half, the push the best-effort half,
 * and each fails alone. Never throws (same contract as sendToUsers).
 *
 * Chat is the one deliberate NON-caller: message pushes stay on bare
 * sendToUsers because the Messages segment IS chat's persistent surface —
 * duplicating threads into the center is noise (spec decision, 2026-08-05).
 */
export async function notifyUsers(
  admin: SupabaseClient,
  userIds: readonly string[],
  content: {
    kind: string;
    title: string;
    body: string;
    data: Record<string, unknown>;
    collapseKey?: string;
  },
): Promise<SendPushResult> {
  const unique = [...new Set(userIds)];
  if (unique.length === 0) return { accepted: 0, rejected: 0, pruned: 0 };

  const { error } = await admin.from('notifications').insert(
    unique.map((userId) => ({
      user_id: userId,
      kind: content.kind,
      title: content.title,
      body: content.body,
      payload: content.data,
    })),
  );
  if (error) {
    log.error('notifications_feed_rows_insert_failed', {
      kind: content.kind,
      error: describeError(error),
    });
  }

  return sendToUsers(admin, unique, {
    kind: content.kind,
    title: content.title,
    body: content.body,
    data: content.data,
    collapseKey: content.collapseKey,
  });
}

/**
 * Drop the users who have muted this kind.
 *
 * ⚠️ THE ONLY PLACE PREFERENCES ARE CONSULTED, and it sits on the PUSH side of
 * persist-then-push on purpose. By the time this runs, notifyUsers has already
 * written the notifications rows — so a muted user still has the event in their
 * in-app centre, and muting costs the interruption rather than the information.
 * Moving this check any earlier would start deleting things people asked to be
 * told about. ADR-0012 is the rule; this is the line it draws.
 *
 * ⚠️ FAILS OPEN — a broken lookup sends to EVERYONE rather than to nobody. The
 * two failure modes are not symmetrical: over-notifying during a database blip
 * is an annoyance, while under-notifying means a stolen car reported near
 * someone whose phone stayed silent. The entire product is that second thing
 * not happening.
 *
 * The kind → category map lives in SQL (notification_category) so there is one
 * definition rather than one per Edge Function.
 */
async function filterByPreference(
  admin: SupabaseClient,
  userIds: readonly string[],
  kind: string,
): Promise<string[]> {
  const recipients: string[] = [];

  // ⚠️ CHUNKED, like the token lookup. PostgREST applies its db-max-rows limit
  // (1000 by default) to set-returning RPCs, so a single call with a larger
  // audience comes back TRUNCATED — with no error. The dropped users would be
  // indistinguishable from users who muted, and the fail-open branch below
  // would never fire, so a big alert fan-out would just go quieter than it
  // should. Sending the same batches the token query uses keeps any one call
  // well under the limit.
  for (const batch of chunk([...userIds], MAX_IDS_PER_QUERY)) {
    const { data, error } = await admin.rpc('push_recipients', {
      p_user_ids: batch,
      p_kind: kind,
    });

    // ⚠️ `!Array.isArray`, not `data == null`. Anything non-iterable — a bare
    // object, a number, whatever a client-library change hands back — made the
    // `for…of` below throw a TypeError that escaped this function, then
    // sendToUsers, then notifyUsers, all three of which document that they
    // never throw. It would have skipped fail-open entirely: the one path left
    // where a fault silenced people instead of over-notifying them. This also
    // subsumes the null case.
    if (error || !Array.isArray(data)) {
      log.error('notifications_preference_filter_failed_sending_to_all', {
        kind,
        error: error ? describeError(error) : 'unusable result',
      });
      return [...userIds];
    }

    for (const row of data) {
      // ⚠️ ANY UNEXPECTED SHAPE FAILS OPEN. `returns setof uuid` comes back as
      // bare strings, and that is the live branch. The object branch exists
      // only because this file cannot be run here — there is no Deno on the
      // machine it was written on — and the FIRST version of it guessed the
      // key was `id`. It is not: PostgREST names the column after the
      // FUNCTION, so `.id` would have been undefined for every row, the
      // audience would have looked full, `.in('user_id', [undefined])` would
      // have matched no tokens, and EVERY push in the app would have gone
      // silent — including the two kinds that may never be muted. Reading the
      // first value rather than a guessed key removes the guess; bailing to
      // the full audience removes the consequence of being wrong anyway.
      const id =
        typeof row === 'string'
          ? row
          : row && typeof row === 'object'
            ? Object.values(row)[0]
            : undefined;

      if (typeof id !== 'string') {
        log.error('notifications_unexpected_push_recipients_shape_sending_to_all', { kind });
        return [...userIds];
      }
      recipients.push(id);
    }
  }

  return recipients;
}

/** Delete tokens Expo has told us are dead. Best-effort and idempotent. */
async function pruneTokens(admin: SupabaseClient, tokens: readonly string[]): Promise<number> {
  let pruned = 0;
  for (const token of new Set(tokens)) {
    const { error } = await admin.rpc('prune_push_token', { p_token: token });
    if (error) log.error('notifications_token_prune_failed', { error: describeError(error) });
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
    log.error('notifications_could_not_read_parked_tickets', { error: describeError(error) });
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
        log.error('notifications_expo_receipts_rejected', { status: response.status });
        continue;
      }
      // NOTE: the receipts response is a MAP keyed by ticket id, not an array.
      receipts = payload.data;
    } catch (err) {
      log.error('notifications_expo_receipts_failed', { error: describeError(err) });
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
        log.error('notifications_push_receipt_error', { code: reason ?? 'unknown' });
      }
    }

    result.pruned += await pruneTokens(admin, dead);
    if (settled.length > 0) {
      await admin.from('push_receipts').delete().in('ticket_id', settled);
    }
  }

  return result;
}

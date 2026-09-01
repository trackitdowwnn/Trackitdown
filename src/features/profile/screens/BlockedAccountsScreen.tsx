/**
 * WHAT:  BlockedAccountsScreen — the accounts the signed-in person has blocked,
 *        newest first, each with an undo.
 * WHY:   Blocking is created in a chat thread, where the decision is made. This
 *        is the only place it can be UNDONE, and without it a block is a
 *        one-way door: the header action disappears once blocked, so the thread
 *        itself offers no way back. App Store guideline 1.2 asks for a block
 *        mechanism; a person being able to see and reverse their own is what
 *        makes it a control rather than a trap.
 *
 * ⚠️ THIS LIST IS OUTBOUND ONLY — who the caller has blocked, never who has
 *        blocked them. The second list would tell a blocked person they were
 *        blocked, which is the one thing ADR-0017 refuses to reveal. If a
 *        future change adds it, that is a privacy regression rather than a
 *        missing feature.
 *
 *        The empty state is therefore the normal state and is written as such —
 *        "You haven't blocked anyone" is a statement of fact, not a prompt to
 *        go and do it.
 * LINKS: src/features/profile/api/blocksApi.ts (the two RPC wrappers);
 *        src/features/chat/components/ThreadHeader.tsx (where a block is made);
 *        docs/decisions/ADR-0017-user-blocking.md;
 *        src/app/blocked-accounts.tsx (the route).
 */

import { useRouter } from 'expo-router';
import { ChevronLeft, UserX } from 'lucide-react-native';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { spacing, sizes, typography, usePalette, useThemedStyles, type Palette } from '@/shared/theme';
import { Button, EmptyState, ErrorState, Screen, useToast } from '@/shared/ui';

import { fetchMyBlocks, unblockAccount, type BlockedAccount } from '../api/blocksApi';

type Status = 'loading' | 'ready' | 'error';

export function BlockedAccountsScreen() {
  const styles = useThemedStyles(makeStyles);
  const palette = usePalette();
  const router = useRouter();
  const toast = useToast();

  const [status, setStatus] = useState<Status>('loading');
  const [blocks, setBlocks] = useState<BlockedAccount[]>([]);
  // Which row is mid-request, so only that button goes quiet rather than the
  // whole list. This drives the LABEL and the disabled state.
  const [pending, setPending] = useState<string | null>(null);
  /**
   * ⚠️ THE ACTUAL RE-ENTRY GUARD, AND IT HAS TO BE A REF. `pending` is state:
   * two presses in the same tick both read the value from the render they were
   * dispatched in, so both see null and both fire. A test caught this doing
   * exactly that — `disabled` only helps once React has re-rendered, which is
   * a frame too late for a double tap.
   *
   * The server's delete is idempotent so the cost is a wasted round trip
   * rather than a wrong outcome, but a guard that does not guard is worse than
   * none: it invites the next person to rely on it.
   */
  const inFlight = useRef(false);

  /**
   * ⚠️ DOES NOT SET 'loading' ITSELF, and that is not an oversight. `status`
   * already starts there, and a setState in the synchronous body of an effect
   * cascades a render — which `react-hooks/set-state-in-effect` forbids, and
   * the rule is right (CollectionPickerSheet's header records the same
   * conclusion). Only `retry` moves the state back, because only there is the
   * screen coming FROM a settled state.
   */
  const load = useCallback(() => {
    fetchMyBlocks()
      .then((rows) => {
        setBlocks(rows);
        setStatus('ready');
      })
      .catch(() => setStatus('error'));
  }, []);

  useEffect(load, [load]);

  const retry = useCallback(() => {
    setStatus('loading');
    load();
  }, [load]);

  const unblock = useCallback(
    async (account: BlockedAccount) => {
      if (inFlight.current) return;
      inFlight.current = true;
      setPending(account.id);
      try {
        await unblockAccount(account.id);
        // Removed locally rather than refetched: the server is authoritative
        // and a whole reload would flash the list for one row's worth of change.
        setBlocks((current) => current.filter((row) => row.id !== account.id));
        toast.show(`${account.firstName} unblocked`, 'success');
      } catch (error) {
        // blocksApi already turned this into copy a person can read.
        toast.show(
          error instanceof Error ? error.message : 'We couldn’t do that. Please try again.',
          'error',
        );
      } finally {
        inFlight.current = false;
        setPending(null);
      }
    },
    [toast],
  );

  return (
    <Screen scroll>
      {/* Pushed page, headers hidden app-wide → an on-screen back control.
          Same shape as My reports and the other pushed screens; the BackButton
          duplication across them is a known tidy-up, not something to solve
          here by reaching for AppHeaderButton, which is a circle-on-media
          control for scroll-fading hero headers. */}
      <View style={styles.headerRow}>
        <Pressable
          onPress={() => router.back()}
          accessibilityRole="button"
          accessibilityLabel="Back"
          style={styles.back}
          testID="blocked-back"
        >
          <ChevronLeft size={sizes.icon} color={palette.textPrimary} />
        </Pressable>
        <Text style={styles.title} accessibilityRole="header">
          Blocked accounts
        </Text>
      </View>

      {status === 'error' ? (
        <ErrorState
          title="We couldn’t load this"
          body="Check your connection and try again."
          onRetry={retry}
        />
      ) : status === 'ready' && blocks.length === 0 ? (
        <EmptyState
          illustration={<UserX size={sizes.icon} color={palette.textSecondary} />}
          title="You haven’t blocked anyone"
          // ⚠️ NOT A PROMPT. This is the normal state, and the copy says what
          // blocking is FOR rather than inviting anyone to use it.
          body="If someone makes you uncomfortable, you can block them from your conversation with them."
        />
      ) : (
        <View style={styles.list}>
          {blocks.map((account) => (
            <View key={account.id} style={styles.row} testID={`blocked-${account.id}`}>
              {/* First name only — the same passport rule as everywhere else
                  a person appears in this app. No surname, no avatar. */}
              <Text style={styles.name} numberOfLines={1}>
                {account.firstName}
              </Text>
              <Button
                label={pending === account.id ? 'Unblocking…' : 'Unblock'}
                variant="ghost"
                disabled={pending !== null}
                onPress={() => void unblock(account)}
              />
            </View>
          ))}
        </View>
      )}
    </Screen>
  );
}

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    back: {
      width: sizes.touchTarget,
      height: sizes.touchTarget,
      alignItems: 'center',
      justifyContent: 'center',
      marginLeft: -(sizes.touchTarget - sizes.icon) / 2,
    },
    headerRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.xs,
      // 24, the house gutter, matching the rows below and every other pushed
      // screen.
      paddingHorizontal: spacing.xl,
    },
    title: {
      ...typography.title,
      color: c.textPrimary,
    },
    list: {
      gap: spacing.xs,
      paddingHorizontal: spacing.xl,
      paddingTop: spacing.md,
    },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: spacing.md,
      // The row IS the item; the button carries its own target, and the name
      // needs enough height beside it not to look wedged in.
      minHeight: sizes.touchTarget,
    },
    name: {
      ...typography.body,
      color: c.textPrimary,
      flex: 1,
    },
  });

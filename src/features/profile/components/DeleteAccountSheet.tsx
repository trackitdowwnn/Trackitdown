/**
 * WHAT:  DeleteAccountSheet — the bottom sheet behind Profile's red "Delete
 *        account" row. On open it reads what still stops the deletion; if
 *        anything does, it lists it (one line each, saying what to do) and
 *        offers no button. Otherwise it says what goes and what's kept, and
 *        deletes once they type DELETE.
 * WHY:   Owner, 2026-10-23: a bottom sheet rather than a whole page, and
 *        "type in a word to confirm" — DELETE, the common convention — in
 *        place of the emailed code (#266, removed with its server check at
 *        the owner's call; SECURITY_AND_TRUST §3 records the trade-off).
 *        Delete straight away, but only when nothing is pending.
 *
 *        The blockers read is ADVISORY (it can be a beat stale, and the payout
 *        balance is only checked at the server). A refusal from the server
 *        shows its own reason and re-reads the list.
 *
 *        No "Stripe" anywhere (owner: say "payouts"). Minimal words. The X and
 *        a swipe are the way out — no second Cancel beside the button.
 * LINKS: ../api/profileApi.ts (fetchDeletionBlockers, fetchLiveListingCount,
 *        requestAccountDeletion); ../lib/deletionReasons.ts;
 *        supabase/functions/delete-account/index.ts; ../screens/ProfileScreen.tsx.
 */

import { useRouter } from 'expo-router';
import {
  Banknote,
  Car,
  Clock,
  FileText,
  MessageCircle,
  Receipt,
  Scale,
  TriangleAlert,
  UserRound,
  type LucideIcon,
} from 'lucide-react-native';
import { type Ref, useCallback, useImperativeHandle, useRef, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';

import {
  spacing,
  sizes,
  typography,
  usePalette,
  useThemedStyles,
  type Palette,
} from '@/shared/theme';
import {
  BottomSheet,
  Button,
  ListRow,
  ListRowGroup,
  TextField,
  useToast,
  type BottomSheetRef,
} from '@/shared/ui';

import {
  AccountDeletionError,
  fetchDeletionBlockers,
  fetchLiveListingCount,
  requestAccountDeletion,
  type DeletionBlocker,
} from '../api/profileApi';
import { deletionReason } from '../lib/deletionReasons';

const CONFIRM_WORD = 'DELETE';

const DELETED: { icon: LucideIcon; title: string }[] = [
  { icon: UserRound, title: 'Your profile and photos' },
  { icon: FileText, title: 'Your listings and sightings' },
  { icon: MessageCircle, title: 'Messages and alerts' },
  { icon: Banknote, title: 'Payout details' },
];

/** An icon per reason, so the list scans like the rest of the app's rows. */
const BLOCKER_ICON: Record<string, LucideIcon> = {
  LIVE_LISTING: Car,
  MONEY_HELD: Banknote,
  REWARD_ON_ITS_WAY: Banknote,
  DISPUTE_OPEN: Scale,
  REVIEW_OPEN: Clock,
};

type Status = 'loading' | 'ready' | 'error';

export interface DeleteAccountSheetProps {
  ref?: Ref<BottomSheetRef>;
  /** The signed-in user — whose live listings to count. */
  userId: string;
}

export function DeleteAccountSheet({ ref, userId }: DeleteAccountSheetProps) {
  const styles = useThemedStyles(makeStyles);
  const palette = usePalette();
  const router = useRouter();
  const toast = useToast();
  const sheetRef = useRef<BottomSheetRef>(null);

  const [status, setStatus] = useState<Status>('loading');
  const [blockers, setBlockers] = useState<DeletionBlocker[]>([]);
  const [liveListings, setLiveListings] = useState(0);
  const [typed, setTyped] = useState('');
  const [deleting, setDeleting] = useState(false);
  // The re-entry guard, as a REF: two taps in one tick both read `deleting`
  // from the same render (BlockedAccountsScreen records the same lesson).
  const inFlight = useRef(false);

  // Both, or neither: without the live-listing count the sheet can't warn that
  // deleting takes a listing down, so a failed read is an error, never a 0.
  const load = useCallback(() => {
    setStatus('loading');
    Promise.all([fetchDeletionBlockers(), fetchLiveListingCount(userId)])
      .then(([rows, live]) => {
        setBlockers(rows);
        setLiveListings(live);
        setStatus('ready');
      })
      .catch(() => setStatus('error'));
  }, [userId]);

  // Read fresh on every open — what blocks can change between visits.
  useImperativeHandle(ref, () => ({
    open: () => {
      setTyped('');
      load();
      sheetRef.current?.open();
    },
    close: () => sheetRef.current?.close(),
  }));

  const confirmed = typed.trim().toUpperCase() === CONFIRM_WORD;

  const remove = useCallback(async () => {
    if (inFlight.current || !confirmed) return;
    inFlight.current = true;
    setDeleting(true);
    try {
      await requestAccountDeletion(); // also clears the local session
      toast.show('Your account has been deleted', 'success');
      sheetRef.current?.close();
      // Guest mode now; the feed is the one surface that works with no
      // account (the same landing as Log out). The guard stays SET: a second
      // tap before the sheet goes would send a request with no session.
      router.navigate('/(tabs)/explore');
    } catch (error) {
      toast.show(
        error instanceof AccountDeletionError
          ? error.message
          : 'We couldn’t delete your account. Please try again.',
        'error',
      );
      inFlight.current = false;
      setDeleting(false);
      // Something changed since the list was read — show what it is now.
      load();
    }
  }, [confirmed, load, router, toast]);

  return (
    <BottomSheet
      ref={sheetRef}
      title="Delete account"
      titleIcon={
        <TriangleAlert
          size={sizes.iconSm}
          color={palette.danger}
          accessible={false}
          importantForAccessibility="no"
        />
      }
    >
      {status === 'loading' ? (
        <ActivityIndicator
          color={palette.textSecondary}
          style={styles.loading}
          accessibilityLabel="Checking your account"
          testID="delete-account-loading"
        />
      ) : status === 'error' ? (
        <View style={styles.body}>
          <Text style={styles.reason}>We couldn’t check your account.</Text>
          <Button label="Try again" variant="secondary" onPress={load} />
        </View>
      ) : blockers.length > 0 ? (
        // The app's row language (owner, 2026-10-23: "use the current design
        // language" — the old stacked sentences were hard to read): a titled
        // group of icon rows, each a short title with what to do beneath.
        <View style={styles.body} testID="delete-account-blocked">
          <ListRowGroup title="Before you can delete">
            {blockers.map((blocker) => {
              const reason = deletionReason(blocker);
              return (
                <ListRow
                  key={blocker.code}
                  icon={BLOCKER_ICON[blocker.code] ?? Clock}
                  title={reason.title}
                  subtitle={reason.detail}
                />
              );
            })}
          </ListRowGroup>
        </View>
      ) : (
        <View style={styles.body} testID="delete-account-clear">
          <ListRowGroup title="Deleted">
            {/* First: a live listing comes down with the account
                (20261023140000) — the one item they might not expect. */}
            {liveListings > 0 ? (
              <ListRow
                icon={Car}
                title={
                  liveListings === 1 ? 'Your live listing' : `Your ${liveListings} live listings`
                }
                subtitle="Taken down now"
                testID="delete-account-live-listings"
              />
            ) : null}
            {DELETED.map((item) => (
              <ListRow key={item.title} icon={item.icon} title={item.title} />
            ))}
          </ListRowGroup>
          <ListRowGroup title="Kept">
            {/* The ledger survives, detached (20261023120000) — the tax
                records rule. Deliberately NOT "nothing identifies you": the
                snapshot keeps the plate. */}
            <ListRow
              icon={Receipt}
              title="Payment records"
              subtitle="For 6 years, as the law requires"
            />
          </ListRowGroup>
          <View style={styles.confirm}>
            <TextField
              label={`Type ${CONFIRM_WORD} to confirm`}
              labelPlacement="above"
              // Between the label and the box (GOV.UK order) — read right
              // before typing.
              helperText="This can’t be undone."
              value={typed}
              onChangeText={setTyped}
              autoCapitalize="characters"
              autoCorrect={false}
              autoComplete="off"
              disabled={deleting}
              testID="delete-account-input"
            />
            <Button
              label="Delete account"
              variant="danger"
              disabled={!confirmed}
              loading={deleting}
              // Heard, not seen — why the button is dimmed.
              accessibilityHint={confirmed ? undefined : `Type ${CONFIRM_WORD} above first`}
              onPress={() => void remove()}
            />
          </View>
        </View>
      )}
    </BottomSheet>
  );
}

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    body: {
      gap: spacing.xl,
      paddingBottom: spacing.md,
    },
    // The field and button sit on the rows' own inset (ListRow/ListRowGroup
    // pad spacing.md), so the sheet reads as one column.
    confirm: {
      gap: spacing.lg,
      paddingHorizontal: spacing.md,
    },
    loading: {
      paddingVertical: spacing.xxl,
    },
    reason: {
      ...typography.body,
      color: c.textPrimary,
    },
  });

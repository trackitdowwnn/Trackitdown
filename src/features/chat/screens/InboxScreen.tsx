/**
 * WHAT:  ChatInboxScreen — the Inbox tab's signed-in content: filter chips
 *        (All · Unread · My cars · My sightings) over the thread list
 *        (FlashList of ThreadRows, newest activity first), skeleton rows
 *        while loading, per-filter empty states, pull-to-refresh, and an
 *        error state with retry. Guest handling stays in the route.
 * WHY:   Airbnb's 2024 inbox pillars, translated: one unified list with
 *        Unread as the workhorse chip, and their category filters becoming
 *        our owner-side/spotter-side split. Filtering is CLIENT-side over
 *        the loaded payload (inboxModel) — a chip must never cost a round
 *        trip. Refetch-on-focus (in useInbox) keeps rows and the tab badge
 *        honest at every glance — the v1 freshness mechanism. Skeletons are
 *        surfaceSubtle blocks (design system: no spinners on lists).
 *
 *        The chips row renders only when there ARE threads: a first-time
 *        user gets the plain invitation, not four filters over nothing. An
 *        empty FILTER keeps the chips visible (switching away must stay
 *        possible) with copy specific to what's empty — an empty Unread is
 *        good news and reads like it. The row SCROLLS rather than wraps
 *        (2026-08-05): four labels don't fit a phone, and the wrapped orphan
 *        read as broken layout — scrolling also pins the header height, so a
 *        growing count ("Unread (12)") can't shove the list down.
 * LINKS: src/features/chat/hooks/useInbox.ts; src/features/chat/lib/
 *        inboxModel.ts (filter maths + empty copy); src/features/chat/
 *        components/ThreadRow.tsx; src/app/(tabs)/inbox.tsx (route/guest).
 */

import { FlashList } from '@shopify/flash-list';
import { useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, { FadeIn, FadeInDown, ReduceMotion } from 'react-native-reanimated';

import { useEntranceGate } from '@/shared/hooks';
import { motion, sizes, spacing, useThemedStyles, type Palette } from '@/shared/theme';
import {
  ChoiceChips,
  EmptyState,
  ErrorState,
  ThemedRefreshControl,
} from '@/shared/ui';

import { ThreadRow, ThreadRowSkeleton } from '../components/ThreadRow';
import { useInbox } from '../hooks/useInbox';
import {
  INBOX_FILTERS,
  emptyFilterCopy,
  filterLabel,
  filterThreads,
  type InboxFilter,
} from '../lib/inboxModel';

export function ChatInboxScreen() {
  const styles = useThemedStyles(makeStyles);
  const router = useRouter();
  const { status, threads, refreshing, refresh, retry } = useInbox();
  // Window opens when data is READY (not at mount, which is the skeleton
  // phase) so a slow load still gets the entrance; recycled cells don't.
  const entranceActive = useEntranceGate(status === 'ready');

  // Session-local, deliberately not persisted: a filter is a glance tool,
  // and reopening the app onto a stale "Unread" filter would read as a
  // half-empty inbox.
  const [filter, setFilter] = useState<InboxFilter>('all');
  // The list IS the filtered threads now — no day grouping, so there is no
  // second structure to keep in step with the chips. (The note that used to
  // stand here warned about grouping before filtering, which would leave
  // headers standing over days whose only thread the chip had removed. That
  // hazard left with the headers.)
  const items = useMemo(() => filterThreads(threads, filter), [threads, filter]);
  const chipOptions = useMemo(
    () => INBOX_FILTERS.map((value) => ({ value, label: filterLabel(value, threads) })),
    [threads],
  );

  if (status === 'loading') {
    return (
      <View
        style={styles.container}
        testID="inbox-skeleton"
        accessibilityLabel="Loading conversations"
      >
        {/* The chip row's height is reserved: the real list always shows it
            once there are threads, and a skeleton without it would promise the
            first conversation 52pt higher than it lands. */}
        <View style={styles.chipsRow}>
          <View style={styles.chipsPlaceholder} />
        </View>
        {/* No day header any more — the real list leads with a row, so the
            skeleton does too. One more skeleton row takes the space the header
            used to, so the block still fills the same band. */}
        {[0, 1, 2, 3].map((n) => (
          <ThreadRowSkeleton key={n} />
        ))}
      </View>
    );
  }

  if (status === 'error') {
    return (
      <View style={styles.centered}>
        <ErrorState
          title="We couldn’t load your inbox"
          body="Check your connection and try again."
          onRetry={retry}
        />
      </View>
    );
  }

  // A truly empty inbox: the invitation, no chips — four filters over
  // nothing would be furniture.
  if (threads.length === 0) {
    return (
      <View style={styles.centered}>
        <EmptyState
          title="No conversations yet"
          body="Conversations open when a spotter reports a sighting on your car — or when you report one."
        />
      </View>
    );
  }

  const empty = emptyFilterCopy(filter);

  return (
    <View style={styles.container}>
      {/* Scrollable, not wrapping: the four labels overflow a phone by ~20px,
          so "My sightings" used to drop to a second line as an orphan. The
          chips own the gutter themselves (full-bleed scroller), so this
          wrapper carries only the vertical rhythm. */}
      <View style={styles.chipsRow}>
        <ChoiceChips options={chipOptions} value={filter} onSelect={setFilter} scrollable />
      </View>
      {items.length === 0 ? (
        // Chips stay mounted: the way OUT of an empty filter is the chips
        // themselves. keyed by filter so switching between two empty filters
        // still reads as a change.
        <Animated.View
          key={filter}
          style={styles.centered}
          entering={FadeIn.duration(motion.fast).reduceMotion(ReduceMotion.System)}
        >
          <EmptyState title={empty.title} body={empty.body} />
        </Animated.View>
      ) : (
        /* ⚠️ A FLAT LIST SINCE 2026-09-04 — no day headers. Owner's call, and
            the structure it borrows depends on it: a messaging list is a
            recency-ordered stack of conversations where each row's own stamp
            says when, so a header saying the same thing above it is a second
            answer to an answered question. `formatListStamp` is what took the
            job over, degrading from a clock to "Yesterday" to a date.

            ⚠️ `getItemType` WENT WITH THE HEADERS, and its old comment called
            it "MANDATORY, not an optimisation" — correctly, while the list
            interleaved ~38pt headers with ~106pt rows. Every cell is now a
            ThreadRow, so there is one type and nothing to tell FlashList
            apart. Restore it the moment anything else enters this list. */
        <FlashList
          data={items}
          keyExtractor={(item) => item.threadId}
          renderItem={({ item, index }) => (
            <Animated.View
              entering={
                entranceActive
                  ? FadeInDown.duration(motion.standard)
                      .delay(Math.min(index, 6) * motion.listStagger)
                      .reduceMotion(ReduceMotion.System)
                  : undefined
              }
            >
              <ThreadRow
                thread={item}
                onPress={(thread) => router.push(`/chat/${thread.threadId}`)}
              />
            </Animated.View>
          )}
          refreshControl={
            // ThemedRefreshControl, not a bare one: `tintColor` is iOS-only, so
            // the hand-rolled version pulled down a stock BLUE spinner on
            // Android in a monochrome app. The shared one sets `colors` too.
            <ThemedRefreshControl refreshing={refreshing} onRefresh={refresh} />
          }
          contentContainerStyle={styles.list}
          testID="inbox-list"
        />
      )}
    </View>
  );
}

// `_c`, not `c`: useThemedStyles requires the palette parameter, and this sheet
// happens to use none of it. The underscore says "deliberately unused" to
// noUnusedParameters rather than the flag saying it for us.
const makeStyles = (_c: Palette) => StyleSheet.create({
  container: {
    flex: 1,
    paddingTop: spacing.md,
  },
  // ⚠️ NO PADDING OF ITS OWN — EmptyState and ErrorState each pad themselves by
  // spacing.xl, and this style used to add a second 24, wrapping a 33-word body
  // to seven lines inside a 48pt-per-side column. Fixed by deleting the padding
  // here rather than by passing EmptyState's `gutter="none"`, because ErrorState
  // has no such prop and half the states would have stayed broken.
  // The `gap` went with it: both primitives own an internal gap: spacing.md, and
  // this one only ever applied to a single child.
  centered: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  chipsRow: {
    paddingBottom: spacing.sm,
  },
  // One list rhythm across both inbox faces. No paddingTop: the day header
  // supplies spacing.lg above the first group, and a container pad would double
  // it.
  list: {
    paddingBottom: spacing.xl,
  },
  // The row skeleton moved to ThreadRow.tsx, where it shares the real row's
  // styles. This block used to hand-copy them and had drifted in three places
  // at once — a 48pt circle against a 64pt tile, two bars against three lines,
  // and an 8pt gap against the row's 4.
  //
  // What stays is the chip row's reserved height: 44 + the row's own 8, so the
  // list starts at the same y in both phases.
  chipsPlaceholder: {
    height: sizes.touchTarget,
  },
});

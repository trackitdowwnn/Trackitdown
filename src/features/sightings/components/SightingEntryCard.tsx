/**
 * WHAT:  SightingEntryCard — one sighting on the OWNER's timeline, photo
 *        first: the spotter's photo (with "+2" when there are more), then
 *        "Seen near Deansgate", when it was seen ("2h ago · Today, 14:32"),
 *        and where the owner stands with it — "Needs your answer" until they
 *        decide, then "Confirmed" / "Credited" / "Not your car". The whole
 *        card opens the sighting.
 * WHY:   Redesigned 2026-10-09 — the owner found the old card "too busy",
 *        "hard to tell what's new" and off-style: the time, a hand-made tag,
 *        the place, a trailing thumbnail, a row of context pills and the
 *        spotter's row all at one weight, floating on a shadow the house
 *        style keeps for things that float. The sighting page now carries the
 *        detail (what they saw, who spotted it, the decision), so the card
 *        only has to say WHICH sighting this is and WHETHER IT NEEDS YOU.
 *        An undecided sighting used to carry no mark at all.
 *
 *        Flat (cardSurface), the time from the same seen-at rule as the
 *        sighting page (sightingSeenAt), and live — useTimeAgo ticks, and
 *        "Today" uses a held clock (the React Compiler would freeze a
 *        render-time `new Date()`).
 * LINKS: src/features/sightings/components/SightingTimeline.tsx (the rail it
 *          sits on — ENTRY_CARD_FIRST_LINE_Y aligns its dot);
 *        src/features/sightings/lib/sightingVerdict.ts (sightingCardStatus,
 *          sightingSeenAt);
 *        src/features/sightings/screens/SightingDetailScreen.tsx (where a tap
 *          leads).
 */

import { Feather } from '@expo/vector-icons';
import { Camera } from 'lucide-react-native';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { useNow, useTimeAgo } from '@/shared/hooks';
import { formatDateTimeLabel, spokenAgo } from '@/shared/lib';
import {
  cardSurface,
  displayFontScaleCap,
  radii,
  sizes,
  spacing,
  typography,
  usePalette,
  useThemedStyles,
  type Palette,
} from '@/shared/theme';
import { AppImage, StatusPill } from '@/shared/ui';

import { sightingCardStatus, sightingSeenAt } from '../lib/sightingVerdict';
import type { OwnerSighting } from '../types';

/** How often "Today, 14:30" re-checks what today is. */
const CLOCK_TICK_MS = 60_000;
/** The card's vertical margin on the rail. */
const CARD_MARGIN = spacing.lg;
const CARD_PADDING = spacing.md;

/** The centre of the card's first text line, from the top of its row — where
 *  the timeline puts the sighting's dot (optical alignment with the place). */
export const ENTRY_CARD_FIRST_LINE_Y =
  CARD_MARGIN + CARD_PADDING + typography.cardTitle.lineHeight / 2;

export interface SightingEntryCardProps {
  sighting: OwnerSighting;
  /** Signed URLs by storage path; a photo without one yet is an empty box. */
  photoUrls: Record<string, string>;
  /** Its place in the whole list, for screen readers ("Sighting 1 of 4"). */
  position: number;
  count: number;
  onPress: () => void;
}

/** One sighting, photo first — see the header. */
export function SightingEntryCard({
  sighting,
  photoUrls,
  position,
  count,
  onPress,
}: SightingEntryCardProps) {
  const styles = useThemedStyles(makeStyles);
  const palette = usePalette();

  const seenAt = sightingSeenAt(sighting);
  const ago = useTimeAgo(seenAt);
  const now = useNow(CLOCK_TICK_MS);
  let date: string | null = null;
  try {
    date = formatDateTimeLabel(seenAt, now);
  } catch {
    // An unparseable timestamp costs the date, never the card.
  }

  // Honest location line (DOMAIN: shown honestly, never papered over). The
  // dashed connector into this card says the same thing decoratively; THIS
  // label is the accessible truth of it.
  const place = sighting.locationUnavailable
    ? 'Location couldn’t be captured'
    : sighting.areaLabel
      ? `Seen near ${sighting.areaLabel}`
      : 'Captured location';
  const status = sightingCardStatus(sighting.status);

  // The in-app photo leads: it is the evidence of the moment (ADR-0003).
  const lead = sighting.photos.find((photo) => photo.source === 'live') ?? sighting.photos[0];
  const leadUrl = lead ? photoUrls[lead.path] : undefined;
  const more = sighting.photos.length - 1;

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${place}, ${spokenAgo(ago)}${status ? `, ${status.label}` : ''}. Sighting ${position} of ${count}. Opens details.`}
      style={({ pressed }) => [styles.card, pressed && styles.cardPressed]}
      testID={`timeline-entry-${sighting.id}`}
    >
      <View style={styles.thumb} testID={`timeline-entry-thumb-${sighting.id}`}>
        {leadUrl ? (
          <AppImage
            uri={leadUrl}
            style={styles.thumbImage}
            testID={`timeline-entry-photo-${sighting.id}`}
          />
        ) : lead ? null : (
          // No photos at all: a quiet frame mark, not a broken image.
          <Camera size={sizes.icon} color={palette.borderStrong} />
        )}
        {more > 0 ? (
          <View style={styles.more}>
            <Text style={styles.moreText} maxFontSizeMultiplier={displayFontScaleCap}>
              +{more}
            </Text>
          </View>
        ) : null}
      </View>

      <View style={styles.body}>
        <Text style={styles.place} numberOfLines={2}>
          {place}
        </Text>
        <Text style={styles.when} numberOfLines={1}>
          {date ? `${ago} · ${date}` : ago}
        </Text>
        <View style={styles.statusLine}>
          {status ? (
            <StatusPill
              label={status.label}
              tone={status.tone}
              testID={`timeline-entry-status-${sighting.id}`}
            />
          ) : (
            <View />
          )}
          <Feather name="chevron-right" size={sizes.iconSm} color={palette.textSecondary} />
        </View>
      </View>
    </Pressable>
  );
}

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    // Flat: a resting card is a hairline, not a shadow (surfaces.ts).
    card: {
      ...cardSurface(c),
      flex: 1,
      flexDirection: 'row',
      alignItems: 'flex-start',
      gap: spacing.md,
      marginVertical: CARD_MARGIN,
      padding: CARD_PADDING,
    },
    cardPressed: {
      backgroundColor: c.surfaceSubtle,
    },
    // surfaceSubtle behind the photo: never a page-coloured hole while the
    // signed URL is on its way.
    thumb: {
      width: sizes.timelineThumb,
      height: sizes.timelineThumb,
      borderRadius: radii.md,
      overflow: 'hidden',
      backgroundColor: c.surfaceSubtle,
      alignItems: 'center',
      justifyContent: 'center',
    },
    thumbImage: {
      width: sizes.timelineThumb,
      height: sizes.timelineThumb,
    },
    // Chrome ON the photo: the media tokens, like PhotoPager's counter.
    more: {
      position: 'absolute',
      right: spacing.xs,
      bottom: spacing.xs,
      backgroundColor: c.surfaceOverMedia,
      borderRadius: radii.full,
      paddingHorizontal: spacing.sm,
    },
    moreText: {
      ...typography.caption,
      color: c.textOnMedia,
    },
    body: {
      flex: 1,
      gap: spacing.xs,
    },
    // The place leads: it is what tells one sighting from another.
    place: {
      ...typography.cardTitle,
      color: c.textPrimary,
    },
    when: {
      ...typography.caption,
      color: c.textSecondary,
    },
    statusLine: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: spacing.sm,
      marginTop: spacing.xs,
    },
  });

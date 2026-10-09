/**
 * WHAT:  SightingEntryCard — one sighting on the OWNER's timeline, photo
 *        first: the spotter's photo (with "+2" when there are more), then
 *        "Seen near Deansgate", when it was seen ("2h ago · 14:32" — the
 *        rail's day stop above already names the day), and where the owner
 *        stands with it — "Needs your answer" until they decide, then
 *        "Confirmed" / "Credited" / "Not your car". The whole card opens the
 *        sighting.
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
 *        rail's order and day stops and the sighting page (sightingSeenAt),
 *        and live (useTimeAgo ticks).
 *
 *        ⚠️ A BARE MARKER AND LABEL, NOT StatusPill (ui review of #146): the
 *        pill fills with `c.surface`, so pressing the card (surfaceSubtle)
 *        flashed a white box around the status — the trap ReportCard records.
 *        "Needs your answer" is a warning RING, not a fill: in greyscale a
 *        filled amber dot and a filled grey one are the same mark, and telling
 *        "waiting on you" from "answered" is the point of the card.
 *
 *        At large text the photo takes its own row (ReportCard's stacking
 *        rule) so the words get the card's width; `useEntryCardFirstLineY`
 *        keeps the rail's dot on the first line at every text size.
 * LINKS: src/features/sightings/components/SightingTimeline.tsx (the rail it
 *          sits on);
 *        src/features/sightings/components/ReportCard.tsx (the marker and
 *          stacking patterns this follows);
 *        src/features/sightings/lib/sightingVerdict.ts (sightingCardStatus,
 *          sightingSeenAt);
 *        src/features/sightings/screens/SightingDetailScreen.tsx (where a tap
 *          leads).
 */

import { Camera } from 'lucide-react-native';
import { Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native';

import { useTimeAgo } from '@/shared/hooks';
import { formatClock, spokenAgo } from '@/shared/lib';
import {
  cardSurface,
  displayFontScaleCap,
  listRowStackFontScale,
  radii,
  sizes,
  spacing,
  typography,
  usePalette,
  useThemedStyles,
  type Palette,
} from '@/shared/theme';
import { AppImage } from '@/shared/ui';

import { sightingCardStatus, sightingSeenAt } from '../lib/sightingVerdict';
import type { OwnerSighting } from '../types';

/** The card's vertical margin on the rail. */
const CARD_MARGIN = spacing.lg;
/** The house card padding (AlertCard, ReportCard, the public timeline card). */
const CARD_PADDING = spacing.lg;

function useStacked(): boolean {
  const { fontScale } = useWindowDimensions();
  return (fontScale ?? 1) > listRowStackFontScale;
}

/**
 * The centre of the card's first line, from the top of its row — where the
 * timeline puts the sighting's dot. A HOOK, not a constant: the line box is
 * `lineHeight × fontScale`, and a constant would ride the dot ever higher as
 * the text grows (ReportCard's useMarkerOffset). Stacked, the photo is the
 * first line, and the dot sits on its centre.
 */
export function useEntryCardFirstLineY(): number {
  const { fontScale } = useWindowDimensions();
  const stacked = useStacked();
  const firstLine = stacked
    ? sizes.timelineThumb
    : typography.cardTitle.lineHeight * (fontScale ?? 1);
  return CARD_MARGIN + CARD_PADDING + firstLine / 2;
}

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
  const { fontScale } = useWindowDimensions();
  const stacked = (fontScale ?? 1) > listRowStackFontScale;

  const seenAt = sightingSeenAt(sighting);
  const ago = useTimeAgo(seenAt);
  let clock: string | null = null;
  try {
    clock = formatClock(seenAt);
  } catch {
    // An unparseable timestamp costs the clock time, never the card.
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
  // The marker sits on the status label's first line, at any text size.
  const markerTop = (typography.label.lineHeight * (fontScale ?? 1) - sizes.progressDot) / 2;

  // The in-app photo leads: it is the evidence of the moment (ADR-0003).
  const lead = sighting.photos.find((photo) => photo.source === 'live') ?? sighting.photos[0];
  const leadUrl = lead ? photoUrls[lead.path] : undefined;
  const more = sighting.photos.length - 1;

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${place}, ${spokenAgo(ago)}${status ? `, ${status.label}` : ''}. Sighting ${position} of ${count}. Opens details.`}
      style={({ pressed }) => [
        styles.card,
        stacked && styles.cardStacked,
        pressed && styles.cardPressed,
      ]}
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
          // No photos at all: a quiet frame mark, not a broken image. (A
          // photo whose link is on its way is just the empty frame.)
          <View testID={`timeline-entry-no-photo-${sighting.id}`}>
            <Camera size={sizes.icon} color={palette.borderStrong} />
          </View>
        )}
        {more > 0 ? (
          <View style={styles.more}>
            <Text style={styles.moreText} maxFontSizeMultiplier={displayFontScaleCap}>
              +{more}
            </Text>
          </View>
        ) : null}
      </View>

      <View style={[styles.body, stacked && styles.bodyStacked]}>
        {/* Two lines beside the photo; all of it once the photo has its own
            row — the place is what tells one sighting from another. */}
        <Text style={styles.place} numberOfLines={stacked ? undefined : 2}>
          {place}
        </Text>
        <Text style={styles.when}>{clock ? `${ago} · ${clock}` : ago}</Text>
        {status ? (
          <View style={styles.status} testID={`timeline-entry-status-${sighting.id}`}>
            <View
              style={[styles.marker, styles[`marker_${status.tone}`], { marginTop: markerTop }]}
            />
            <Text style={[styles.statusLabel, status.tone === 'warning' && styles.statusAsk]}>
              {status.label}
            </Text>
          </View>
        ) : null}
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
    cardStacked: {
      flexDirection: 'column',
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
    // ReportCard's basis fix: in a column, `flex: 1` would size the body to
    // nothing; it takes its content's height and the card's width.
    bodyStacked: {
      flexGrow: 0,
      flexBasis: 'auto',
      alignSelf: 'stretch',
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
    status: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      gap: spacing.xs,
      marginTop: spacing.xs,
    },
    // StatusPill's dot geometry, so a dot means the same thing here as on a
    // post's badge.
    marker: {
      width: sizes.progressDot,
      height: sizes.progressDot,
      borderRadius: radii.full,
    },
    /** Undecided — a RING, so it differs from the answered states in shape,
     *  not only in hue (see the header). */
    marker_warning: {
      borderWidth: sizes.timelineDotStroke,
      borderColor: c.warning,
    },
    /** Confirmed / Credited — the owner's own answer, in ink (DESIGN_SYSTEM:
     *  primary as a settled status; sage stays for payout moments). */
    marker_primary: {
      backgroundColor: c.primary,
    },
    /** Not your car — answered, and closed. */
    marker_neutral: {
      backgroundColor: c.borderStrong,
    },
    statusLabel: {
      ...typography.label,
      color: c.textSecondary,
      // Wraps rather than overflowing the card on a narrow phone.
      flexShrink: 1,
    },
    /** "Needs your answer" — the one status that asks something of the owner
     *  reads in full ink. */
    statusAsk: {
      color: c.textPrimary,
    },
  });

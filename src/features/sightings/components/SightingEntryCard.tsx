/**
 * WHAT:  SightingEntryCard — one sighting on the OWNER's timeline, photo
 *        first: the spotter's photo (with "+2" when there are more), then the
 *        place ("Deansgate, Manchester"), the clock time it was seen ("14:32"
 *        — the rail's day stop above already names the day) with "Saw 2 of 3
 *        marks" when that's known, and where the owner stands with it: an
 *        amber "Needs your answer" tag until they decide, then a quiet
 *        "Confirmed" / "Credited" / "Not your car". A chevron, and the whole
 *        card opens the sighting.
 * WHY:   Redesigned again 2026-10-20 (owner's picks from mockups):
 *        - CLEANER, SAME SHAPE: no "Seen near" on every card (the section is
 *          sightings), no "2h ago" beside the clock (the day stop says the
 *          day), a smaller photo (timelineThumbCompact) so the place keeps a
 *          narrow phone's width, and a chevron — the card had no cue that it
 *          opens.
 *        - "NEEDS YOUR ANSWER" IS THE ONE "NEW" SIGNAL: an amber tag, so the
 *          sightings waiting on the owner are the ones that stand out; there
 *          is no unread data, so no second badge pretends to know more.
 *        - "SAW 2 OF 3 MARKS": the strongest is-it-mine clue, one tap early —
 *          only when the report recorded which marks it asked about
 *          (marksSeenSummary), never a guessed total.
 *        Before that (2026-10-09) the owner had found the card "too busy" and
 *        "hard to tell what's new"; the detail lives on the sighting page,
 *        so the card still never shows context, the note or the spotter.
 *
 *        Flat (cardSurface), the time from the same seen-at rule as the
 *        rail's order and day stops and the sighting page (sightingSeenAt).
 *
 *        ⚠️ THE TAG IS INK ON A SOFT AMBER (warningSubtle), WITH AN AMBER RING
 *        — white on `warning` fails AA, and the ring keeps "waiting on you" a
 *        different SHAPE from "answered" in greyscale. Not StatusPill: that
 *        fills with `c.surface`, which flashed a white box when the card was
 *        pressed (ui review of #146).
 *
 *        At large text the photo takes its own row (ReportCard's stacking
 *        rule) so the words get the card's width; `useEntryCardFirstLineY`
 *        keeps the rail's dot on the first line at every text size.
 * LINKS: src/features/sightings/components/SightingTimeline.tsx (the rail it
 *          sits on);
 *        src/features/sightings/components/ReportCard.tsx (the stacking
 *          pattern this follows);
 *        src/features/sightings/lib/sightingVerdict.ts (sightingCardStatus,
 *          sightingSeenAt); ../lib/markChecklist.ts (marksSeenSummary);
 *        src/features/sightings/screens/SightingDetailScreen.tsx (where a tap
 *          leads).
 */

import { Camera, ChevronRight } from 'lucide-react-native';
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

import { marksSeenSummary } from '../lib/markChecklist';
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
  return CARD_MARGIN + CARD_PADDING + firstLineHeight(stacked, fontScale) / 2;
}

/** The card's first line: the photo when stacked, else the place's first
 *  line at this text size. ONE value for the rail's dot and the chevron, so
 *  the two can never drift apart. */
function firstLineHeight(stacked: boolean, fontScale: number | undefined): number {
  return stacked ? sizes.timelineThumbCompact : typography.cardTitle.lineHeight * (fontScale ?? 1);
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
  const stacked = useStacked();
  // The chevron centred on the card's first line, at any text size.
  const chevronTop = CARD_PADDING + (firstLineHeight(stacked, fontScale) - sizes.iconSm) / 2;

  const seenAt = sightingSeenAt(sighting);
  // Spoken only: on screen the rail's day stop names the day, and the clock
  // the time — but a screen reader hears no day stop.
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
    : (sighting.areaLabel ?? 'Captured location');
  const marks = marksSeenSummary(sighting);
  const marksText = marks
    ? `Saw ${marks.seen} of ${marks.of} ${marks.of === 1 ? 'mark' : 'marks'}`
    : null;
  const status = sightingCardStatus(sighting.status);
  const waiting = status?.tone === 'warning';
  // The tag's ring sits on its label's first line, at any text size.
  const ringTop = (typography.label.lineHeight * (fontScale ?? 1) - sizes.progressDot) / 2;

  // The in-app photo leads: it is the evidence of the moment (ADR-0003).
  const lead = sighting.photos.find((photo) => photo.source === 'live') ?? sighting.photos[0];
  const leadUrl = lead ? photoUrls[lead.path] : undefined;
  const more = sighting.photos.length - 1;

  const spoken = [
    place,
    spokenAgo(ago),
    marksText ? marksText.toLowerCase() : null,
    status ? status.label : null,
  ]
    .filter(Boolean)
    .join(', ');

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${spoken}. Sighting ${position} of ${count}. Opens details.`}
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
        {clock || marksText ? (
          <Text style={styles.when}>{[clock, marksText].filter(Boolean).join(' · ')}</Text>
        ) : null}
        {status && waiting ? (
          // The one status that asks something of the owner: a tag.
          <View style={styles.tag} testID={`timeline-entry-status-${sighting.id}`}>
            <View style={[styles.ring, { marginTop: ringTop }]} />
            <Text style={styles.tagLabel}>{status.label}</Text>
          </View>
        ) : status ? (
          // Answered: a quiet line — settled, nothing to do.
          <Text style={styles.answered} testID={`timeline-entry-status-${sighting.id}`}>
            {status.label}
          </Text>
        ) : null}
      </View>

      {/* The tap cue, on the first line's level at the card's right edge. */}
      <View
        style={[styles.chevron, { top: chevronTop }]}
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        testID={`timeline-entry-chevron-${sighting.id}`}
      >
        <ChevronRight size={sizes.iconSm} color={palette.textSecondary} />
      </View>
    </Pressable>
  );
}

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    // Flat: a resting card is a hairline, not a shadow (surfaces.ts). Room on
    // the right for the chevron, which sits over the card's corner.
    card: {
      ...cardSurface(c),
      flex: 1,
      flexDirection: 'row',
      alignItems: 'flex-start',
      gap: spacing.md,
      marginVertical: CARD_MARGIN,
      padding: CARD_PADDING,
      paddingRight: CARD_PADDING + sizes.iconSm + spacing.xs,
    },
    // Stacked, the chevron sits beside the photo's row, so the words below
    // take the card's full width.
    cardStacked: {
      flexDirection: 'column',
      paddingRight: CARD_PADDING,
    },
    cardPressed: {
      backgroundColor: c.surfaceSubtle,
    },
    // surfaceSubtle behind the photo: never a page-coloured hole while the
    // signed URL is on its way.
    thumb: {
      width: sizes.timelineThumbCompact,
      height: sizes.timelineThumbCompact,
      borderRadius: radii.md,
      overflow: 'hidden',
      backgroundColor: c.surfaceSubtle,
      alignItems: 'center',
      justifyContent: 'center',
    },
    thumbImage: {
      width: sizes.timelineThumbCompact,
      height: sizes.timelineThumbCompact,
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
    // "Needs your answer": ink on a soft amber, an amber ring before it (see
    // the header). Hugs its words; wraps rather than overflowing.
    tag: {
      alignSelf: 'flex-start',
      flexDirection: 'row',
      alignItems: 'flex-start',
      gap: spacing.xs,
      marginTop: spacing.xs,
      paddingHorizontal: spacing.sm,
      paddingVertical: spacing.xs,
      borderRadius: radii.sm,
      backgroundColor: c.warningSubtle,
      maxWidth: '100%',
    },
    // StatusPill's dot geometry, drawn as a ring.
    ring: {
      width: sizes.progressDot,
      height: sizes.progressDot,
      borderRadius: radii.full,
      borderWidth: sizes.timelineDotStroke,
      borderColor: c.warning,
    },
    tagLabel: {
      ...typography.label,
      color: c.textPrimary,
      flexShrink: 1,
    },
    answered: {
      ...typography.caption,
      color: c.textSecondary,
      marginTop: spacing.xs,
    },
    // Top-right; its `top` is set per render, centred on the first line.
    chevron: {
      position: 'absolute',
      right: CARD_PADDING,
    },
  });

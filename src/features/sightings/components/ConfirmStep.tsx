/**
 * WHAT:  ConfirmStep — the report flow's last step, "Check and send": the
 *        GOV.UK check-answers pattern inside a step. Labelled sections, in
 *        order:
 *          - "You're reporting": the car, from the listing (not editable);
 *          - "Photos": the real shots, tap one to see it full screen;
 *          - "Where and when": the captured point (read-only, on purpose);
 *          - "What you saw": every answer as a labelled row, and the note.
 *        Photos and What you saw each carry an Edit link that jumps to that
 *        step and comes back (the wizard's `editStep` spur: "Done" returns,
 *        Back cancels). The privacy line sits above the button as the step's
 *        footerNote (REPORT_PRIVACY_LINE).
 * WHY:   Redesigned 2026-10-02 after research (GOV.UK check answers, NN/g
 *        error prevention and recognition over recall, Apple HIG, survey
 *        confidentiality studies):
 *          - Real photos and a real map, not counts: people spot a wrong or
 *            blurry shot when they SEE it.
 *          - The car's identity on top: "wrong car" is the mistake that
 *            matters most, and the last chance to notice it is here.
 *          - Edit per section, landing back here: fixing one thing never
 *            means walking the whole flow again.
 *          - NO Edit on Where and when: the captured point is the evidence
 *            (SAFETY, below), so the section says why instead.
 *          - One short, true sentence about who sees what. A long assurance
 *            reads as a warning.
 *          - No "Are you sure?" dialog: this screen IS the confirmation.
 *          - No SafetyNotice banner: the flow carries it once, on the sheet
 *            before it opens (DOMAIN.md).
 * LINKS: src/shared/wizard/ReviewStep.tsx (the visual language mirrored);
 *        src/features/sightings/lib/contextLabels.ts (contextReviewRows);
 *        src/features/sightings/lib/areaLabel.ts (isApproximateFix);
 *        src/features/sightings/lib/reportSeed.ts (reportedCar);
 *        docs/SECURITY_AND_TRUST.md §1 (what the owner sees);
 *        docs/decisions/ADR-0003-gallery-supplementary-evidence.md.
 */

import { Feather } from '@expo/vector-icons';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { useTimeAgo } from '@/shared/hooks';
import {
  cardSurface,
  opacity,
  radii,
  sizes,
  spacing,
  typography,
  usePalette,
  useThemedStyles,
  type Palette,
} from '@/shared/theme';
import { AppImage, type EvidencePhoto, PhotoPreviewModal, PlateChip } from '@/shared/ui';
import { AppMap, AppMapMarker } from '@/shared/ui/AppMap';
import type { WizardStepProps } from '@/shared/wizard';

import { firstLocatedPhoto, isApproximateFix } from '../lib/areaLabel';
import { contextReviewRows } from '../lib/contextLabels';
import { MAX_SIGHTING_PHOTOS, type ReportedCar, type ReportSightingAnswers } from '../types';

type StepProps = WizardStepProps<ReportSightingAnswers>;

/**
 * The line above "Send report" (the step's footerNote). Strictly true: the
 * owner sees the photos, the exact point and the spotter's FIRST NAME with
 * their reputation (SECURITY_AND_TRUST §1); the public sees only that a
 * sighting happened, when, and the district, so "only the owner sees this
 * report" would overclaim. Pinned word for word in reportSightingFlow.test.
 */
export const REPORT_PRIVACY_LINE =
  'Only the owner sees your photos and the exact spot. They’ll see your first name, not your contact details.';

/** "5m ago" → "5 minutes ago" for screen readers: VoiceOver reads a bare
 *  "5m" as five metres, which beside a map and "Approximate location" means
 *  the wrong thing. */
function spokenAgo(ago: string): string {
  return ago
    .replace(/^([0-9]+)m ago$/, (_, n) => `${n} ${n === '1' ? 'minute' : 'minutes'} ago`)
    .replace(/^([0-9]+)h ago$/, (_, n) => `${n} ${n === '1' ? 'hour' : 'hours'} ago`)
    .replace(/^([0-9]+)d ago$/, (_, n) => `${n} ${n === '1' ? 'day' : 'days'} ago`)
    .replace(/^([0-9]+)w ago$/, (_, n) => `${n} ${n === '1' ? 'week' : 'weeks'} ago`);
}

/** "Photo taken 5m ago", spoken in full. Nothing when there's no photo. */
function TakenLine({ ago }: { ago: string | null }) {
  const styles = useThemedStyles(makeStyles);
  if (!ago) return null;
  return (
    <Text style={styles.meta} accessibilityLabel={`Photo taken ${spokenAgo(ago)}`}>
      Photo taken {ago}
    </Text>
  );
}

/** ~0.6-mile span: enough to place the pin without implying precision. */
const CONFIRM_DELTA = 0.008;

/** An underlined text action, as ReviewStep's: a 44pt box, not just the word. */
function EditLink({
  text = 'Edit',
  accessibilityLabel,
  onPress,
  disabled,
}: {
  text?: string;
  accessibilityLabel: string;
  onPress: () => void;
  disabled: boolean;
}) {
  const styles = useThemedStyles(makeStyles);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ disabled }}
      disabled={disabled}
      hitSlop={spacing.sm}
      onPress={onPress}
      style={({ pressed }) => [styles.edit, pressed ? styles.editPressed : null]}
    >
      <Text style={[styles.editLink, disabled ? styles.editLinkDisabled : null]}>{text}</Text>
    </Pressable>
  );
}

/** A titled section: its header row (title + optional action), then content.
 *  Sections after the first open with a hairline, ReviewStep's rhythm. */
function ReviewSection({
  title,
  first = false,
  action,
  children,
  testID,
}: {
  title: string;
  first?: boolean;
  action?: React.ReactNode;
  children: React.ReactNode;
  testID?: string;
}) {
  const styles = useThemedStyles(makeStyles);
  return (
    <View style={[styles.section, first ? styles.sectionFirst : null]} testID={testID}>
      <View style={styles.sectionHead}>
        <Text accessibilityRole="header" style={styles.sectionTitle}>
          {title}
        </Text>
        {action}
      </View>
      {children}
    </View>
  );
}

/** The listing's photo across the top (the owner's call, 2026-10-02: "is it
 *  the same car?" is answered by LOOKING), then the plate and "Blue BMW 3
 *  Series" on one line, plate first. The name wraps under the plate when the
 *  line runs out. No photo, or one that fails to load: just the line. */
function ReportedCarCard({ car }: { car: ReportedCar }) {
  const styles = useThemedStyles(makeStyles);
  const name = [car.colour, car.make, car.model].filter(Boolean).join(' ') || 'This car';
  // A dead URL (a deleted or moved listing photo) would otherwise leave a
  // screen-wide grey slab where the car should be. The URL that failed, not a
  // flag, so a different photo would still get its chance.
  const [failedUri, setFailedUri] = useState<string | null>(null);
  const photoUrl = car.photoUrl;
  return (
    // Not one grouped accessible element: PlateChip keeps its own spelled-out
    // label and long-press copy.
    <View style={styles.car} testID="reported-car">
      {photoUrl && photoUrl !== failedUri ? (
        <AppImage
          uri={photoUrl}
          style={styles.carPhoto}
          onError={() => setFailedUri(photoUrl)}
          testID="reported-car-photo"
        />
      ) : null}
      <View style={styles.carText} testID="reported-car-line">
        {car.plate ? <PlateChip plate={car.plate} onPress={null} /> : null}
        <Text style={styles.carName}>{name}</Text>
      </View>
    </View>
  );
}

/** The spotter's photos, always three columns so one shot never balloons to
 *  the full width; a tap opens it full screen. */
function PhotoTiles({
  photos,
  busy,
  onOpen,
}: {
  photos: EvidencePhoto[];
  busy: boolean;
  onOpen: (index: number) => void;
}) {
  const styles = useThemedStyles(makeStyles);
  const palette = usePalette();
  const spacers = Math.max(0, MAX_SIGHTING_PHOTOS - photos.length);
  return (
    <View style={styles.photos}>
      {photos.map((photo, index) => {
        const fromLibrary = photo.source === 'gallery';
        return (
          <Pressable
            key={photo.uri}
            accessibilityRole="imagebutton"
            accessibilityLabel={`Photo ${index + 1} of ${photos.length}${fromLibrary ? ', from your library' : ''}`}
            accessibilityHint="Opens the photo full screen"
            accessibilityState={{ disabled: busy }}
            disabled={busy}
            onPress={() => onOpen(index)}
            style={({ pressed }) => [styles.photoCell, pressed ? styles.photoPressed : null]}
          >
            <AppImage uri={photo.uri} style={styles.photo} />
            {/* Provenance shown honestly: a library photo is never presented
                as a live capture (ADR-0003). */}
            {fromLibrary ? (
              <View style={styles.badge}>
                {/* textOnMedia, not textOnPrimary: this badge sits ON the
                    photo, so it must stay white in both schemes — textOnPrimary
                    flips to near-black in dark and would vanish on a dark shot. */}
                <Feather name="image" size={sizes.iconSm} color={palette.textOnMedia} />
                <Text style={styles.badgeText} numberOfLines={1}>
                  Library
                </Text>
              </View>
            ) : null}
          </Pressable>
        );
      })}
      {Array.from({ length: spacers }, (_, index) => (
        <View
          key={`spacer-${index}`}
          style={styles.photoCell}
          importantForAccessibility="no"
          accessibilityElementsHidden
        />
      ))}
    </View>
  );
}

/** The captured point and time. Read-only, and it says why. */
function WhereAndWhen({
  areaLabel,
  located,
  takenAgo,
}: {
  areaLabel?: string;
  located: EvidencePhoto | null;
  takenAgo: string | null;
}) {
  const styles = useThemedStyles(makeStyles);
  if (!located) {
    return (
      <View style={styles.whereTextAlone}>
        <Text style={styles.place}>No location on this report — your photos still help.</Text>
        <TakenLine ago={takenAgo} />
      </View>
    );
  }
  return (
    <View>
      {/* SAFETY: display only — the CAPTURED point is the evidence. There is
          deliberately no way to move this pin or pick a location. Hidden from
          screen readers: the lines under it say the same thing in words. */}
      <View
        style={styles.map}
        pointerEvents="none"
        importantForAccessibility="no-hide-descendants"
        accessibilityElementsHidden
        testID="confirm-map"
      >
        <AppMap
          interactive={false}
          region={{
            latitude: located.lat as number,
            longitude: located.lng as number,
            latitudeDelta: CONFIRM_DELTA,
            longitudeDelta: CONFIRM_DELTA,
          }}
          animateDurationMs={0}
          onRegionChangeStart={() => {}}
          onRegionChangeComplete={() => {}}
        >
          <AppMapMarker
            coordinate={{ latitude: located.lat as number, longitude: located.lng as number }}
            anchor={{ x: 0.5, y: 0.5 }}
          >
            <View style={styles.pin} />
          </AppMapMarker>
        </AppMap>
      </View>
      <View style={styles.whereText}>
        <Text style={styles.place}>
          {areaLabel ? `Near ${areaLabel}` : 'At the spot you took the photo'}
        </Text>
        {isApproximateFix(located) ? <Text style={styles.meta}>Approximate location</Text> : null}
        <TakenLine ago={takenAgo} />
        <Text style={styles.meta}>
          This comes from where you took the photo, so the owner can trust it.
        </Text>
      </View>
    </View>
  );
}

/** The report flow's "Check and send" step. */
export function ConfirmStep({ answers, editStep, busy = false }: StepProps) {
  const styles = useThemedStyles(makeStyles);
  const photos = answers.photos ?? [];
  const located = firstLocatedPhoto(photos);
  // When it was SEEN: the photo the map shows (a located photo is always a
  // live one), else the first live shot. A library photo's timestamp is when
  // it was added, not when it was taken.
  const timePhoto = located ?? photos.find((photo) => photo.source !== 'gallery') ?? photos[0];
  // The hook needs a timestamp every render; with no photo (unreachable: the
  // schema requires one) the line is simply left out, never invented.
  const ago = useTimeAgo(timePhoto?.capturedAt ?? 0);
  const takenAgo = timePhoto ? ago : null;
  const rows = contextReviewRows(answers);
  const [previewIndex, setPreviewIndex] = useState<number | null>(null);
  const car = answers.reportedCar;

  return (
    <View style={styles.stack}>
      {car ? (
        <ReviewSection title="You’re reporting" first testID="confirm-car">
          <ReportedCarCard car={car} />
        </ReviewSection>
      ) : null}

      <ReviewSection
        title="Photos"
        first={!car}
        action={
          editStep ? (
            <EditLink
              accessibilityLabel="Edit photos"
              onPress={() => editStep('photos')}
              disabled={busy}
            />
          ) : null
        }
      >
        <PhotoTiles photos={photos} busy={busy} onOpen={setPreviewIndex} />
      </ReviewSection>

      <ReviewSection title="Where and when">
        <WhereAndWhen areaLabel={answers.areaLabel} located={located} takenAgo={takenAgo} />
      </ReviewSection>

      <ReviewSection
        title="What you saw"
        action={
          editStep && rows.length > 0 ? (
            <EditLink
              accessibilityLabel="Edit what you saw"
              onPress={() => editStep('context')}
              disabled={busy}
            />
          ) : null
        }
      >
        {rows.length > 0 ? (
          <View>
            {rows.map((row, index) => (
              <View
                key={row.key}
                style={[styles.row, index < rows.length - 1 ? styles.rowRuled : null]}
              >
                <Text style={styles.rowLabel}>{row.label}</Text>
                <Text style={styles.rowValue}>{row.value}</Text>
              </View>
            ))}
          </View>
        ) : (
          <View style={styles.emptyRow}>
            <Text style={styles.rowValueQuiet}>Nothing added</Text>
            {editStep ? (
              <EditLink
                text="Add"
                accessibilityLabel="Add what you saw"
                onPress={() => editStep('context')}
                disabled={busy}
              />
            ) : null}
          </View>
        )}
      </ReviewSection>

      <PhotoPreviewModal
        uri={previewIndex === null ? null : (photos[previewIndex]?.uri ?? null)}
        label={previewIndex === null ? undefined : `Photo ${previewIndex + 1} of ${photos.length}`}
        onClose={() => setPreviewIndex(null)}
      />
    </View>
  );
}

const makeStyles = (c: Palette) => StyleSheet.create({
  // ReviewStep's section rhythm, tightened from xxl to xl: this is a speed
  // flow. A full report runs to about three screens on a small phone since
  // the car photo became a hero (the owner's call), so keep it no longer.
  stack: {
    gap: spacing.xl,
  },
  section: {
    gap: spacing.md,
    paddingTop: spacing.xl,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: c.border,
  },
  sectionFirst: {
    paddingTop: 0,
    borderTopWidth: 0,
  },
  // At least a touch target tall, so a section with an Edit link and one
  // without line their titles up the same.
  sectionHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.lg,
    minHeight: sizes.touchTarget,
  },
  sectionTitle: {
    ...typography.heading,
    color: c.textPrimary,
    flexShrink: 1,
  },
  // ReviewStep's Edit control: the 44pt minimum as a real box, underlined so
  // it reads as tappable in the monochrome scheme, and the underline comes
  // off (not a fade) while it's inert.
  edit: {
    minHeight: sizes.touchTarget,
    minWidth: sizes.touchTarget,
    alignItems: 'flex-end',
    justifyContent: 'center',
  },
  editPressed: {
    opacity: opacity.pressed,
  },
  editLink: {
    ...typography.label,
    color: c.primary,
    textDecorationLine: 'underline',
  },
  editLinkDisabled: {
    color: c.textSecondary,
    textDecorationLine: 'none',
  },
  // overflow hidden so the photo takes the card's top corners.
  car: {
    ...cardSurface(c),
    overflow: 'hidden',
  },
  // Full width at the 4:3 every car photo in the app uses (VehicleCard):
  // cars are landscape subjects. Not MediaIdentityCard's tall 4:5 hero, which
  // would push the rest of a speed flow's review a screen further down.
  // (AppImage supplies the surfaceSubtle placeholder.)
  carPhoto: {
    width: '100%',
    aspectRatio: sizes.reportedCarPhotoAspect,
  },
  // One line: plate, then name. Wraps (name under plate) on a narrow phone
  // or at large text rather than squeezing the name to nothing. When there's
  // a plate, the 26pt PlateChip sets the first line's height (it pins itself
  // to flex-start) and the 22pt name centres against it; don't "fix" the
  // centring in the chip.
  carText: {
    padding: spacing.lg,
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    columnGap: spacing.sm,
    rowGap: spacing.xs,
  },
  // includeFontPadding off: text beside a chip (DESIGN_SYSTEM.md Typography,
  // the Android includeFontPadding rule). Satoshi's Android font box is padded
  // unevenly and sat the name off the plate's centre.
  carName: {
    ...typography.cardTitle,
    color: c.textPrimary,
    flexShrink: 1,
    includeFontPadding: false,
  },
  photos: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  photoCell: {
    flex: 1,
  },
  photoPressed: {
    opacity: opacity.pressed,
  },
  photo: {
    width: '100%',
    aspectRatio: sizes.reviewPhotoAspect,
    borderRadius: radii.md,
    backgroundColor: c.surfaceSubtle,
  },
  badge: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    // mediaScrim + textOnMedia, NOT overlay/textOnPrimary: this badge is
    // chrome sitting ON the photo. `overlay` now means "a scrim over the PAGE"
    // and deepens on dark; a photo is as bright in either theme, so its own
    // chrome must not move at all.
    backgroundColor: c.mediaScrim,
    borderTopRightRadius: radii.sm,
    borderBottomLeftRadius: radii.md,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
  },
  badgeText: {
    ...typography.caption,
    color: c.textOnMedia,
  },
  map: {
    height: sizes.mapConfirmPreview,
    borderRadius: radii.lg,
    overflow: 'hidden',
    backgroundColor: c.surfaceSubtle,
  },
  pin: {
    width: sizes.mapPinConfirm,
    height: sizes.mapPinConfirm,
    borderRadius: radii.full,
    backgroundColor: c.primary,
    borderWidth: sizes.mapPinRing,
    borderColor: c.surface,
  },
  whereText: {
    gap: spacing.xs,
    marginTop: spacing.sm,
  },
  // No map above: the section's own gap is the spacing, as in every section.
  whereTextAlone: {
    gap: spacing.xs,
  },
  place: {
    ...typography.body,
    color: c.textPrimary,
  },
  meta: {
    ...typography.caption,
    color: c.textSecondary,
  },
  // ReviewStep's row: a caption label over a body value, hairline between.
  row: {
    gap: spacing.xs,
    paddingVertical: spacing.sm,
  },
  rowRuled: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: c.border,
  },
  rowLabel: {
    ...typography.caption,
    color: c.textSecondary,
  },
  rowValue: {
    ...typography.body,
    color: c.textPrimary,
  },
  emptyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.lg,
  },
  // Shrinks (and wraps) before it pushes the Add link off the row.
  rowValueQuiet: {
    ...typography.body,
    color: c.textSecondary,
    flexShrink: 1,
  },
});

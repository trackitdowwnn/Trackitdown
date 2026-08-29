/**
 * WHAT:  PlateChip — a UK registration rendered in plate styling: heavy
 *        (Satoshi Black) uppercase on a surfaceSubtle chip (the design
 *        system's one sanctioned ALL-CAPS moment). Compact since 2026-07-23
 *        (14pt, no letter spacing) so it sits quietly beside titles.
 * WHY:   Plates are the app's core identifier and must be instantly
 *        recognisable everywhere they appear (cards, post detail, sightings,
 *        chat). Screen readers get the plate spelled character by character
 *        ("A B 1 2, C D E") — read as a word it's meaningless.
 *
 *        LONG-PRESS COPIES (2026-08-08). The plate is the one string a user
 *        needs OUT of this app and into another — a message, a 101 call, an
 *        insurer's form — and retyping it off the screen is exactly how a
 *        character gets transposed. Tap is NOT the gesture: the chip usually
 *        sits inside a card whose tap already means "open this listing", so
 *        such callers must forward that tap through `onPress` (see the prop).
 * LINKS: docs/DESIGN_SYSTEM.md (Core components: PlateChip; Typography);
 *        src/shared/theme (typography.plate); src/shared/lib/haptics.ts.
 *
 * Usage:
 *   <PlateChip plate="AB12 CDE" onPress={null} />        // standalone
 *   <PlateChip plate="AB12 CDE" onPress={openListing} /> // inside a card
 */

import * as Clipboard from 'expo-clipboard';
import { Copy } from 'lucide-react-native';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';

import { lightHaptic } from '../lib/haptics';
import { radii, spacing, typography, usePalette, useThemedStyles, type Palette } from '../theme';
import { useOptionalToast } from './Toast';

export interface PlateChipProps {
  /** Registration as stored ("AB12 CDE" or "ab12cde" — rendered uppercase). */
  plate: string;
  /**
   * The enclosing tappable's own press, forwarded — or an EXPLICIT `null` when
   * nothing tappable encloses this chip.
   *
   * Required, and required to be explicit, on purpose. Long-press makes the chip
   * the touch responder, and a responder with no `onPress` still SWALLOWS the
   * tap: a chip dropped inside a card without this silently turns its own ~80x24
   * strip into a dead zone. That is invisible in review and invisible at
   * runtime — it just quietly stops working. It was ALSO got wrong twice the
   * first time this prop existed as optional (the plate-scan candidate picker
   * and the choose-a-car-to-report row both lost their taps), which is the
   * evidence that an optional prop is the wrong shape here.
   *
   * So the type makes the decision unskippable: every call site states which
   * case it is, and a new one cannot compile until its author has thought about
   * it. `null` = standalone (PostDetailBody, the summary step, a single scan
   * result); a handler = "I am inside something tappable, here is its press".
   */
  onPress: (() => void) | null;
  /**
   * Render for a chip sitting ON A PHOTOGRAPH.
   *
   * ⚠️ The default fill is `surfaceSubtle`, which is #EEEEEE in light and
   * #2A2A2A in dark — it tracks the PAGE. Over a photo that is exactly the flip
   * DESIGN_SYSTEM.md forbids for photo chrome: a photograph is as bright in
   * dark mode as in light, so the chip beside `textOnMedia` text turned from a
   * light chip into a charcoal one while the text stayed white. This swaps to
   * the theme-invariant media tokens, which were minted for this.
   */
  onMedia?: boolean;
}

/**
 * Android 13+ (SDK 33) pops its OWN "Copied." confirmation whenever an app
 * writes to the clipboard. Ours then lands on top of it — two dark pills
 * overlapping, observed on a Galaxy A15 running Android 16. The platform's
 * confirmation is the convention there and it is the one users already read,
 * so we say nothing and let it speak. iOS shows no such thing, so on iOS our
 * toast is the ONLY feedback beyond the haptic and must stay.
 */
const SYSTEM_CONFIRMS_CLIPBOARD = Platform.OS === 'android' && Number(Platform.Version) >= 33;

/** "AB12 CDE" → "A B 1 2, C D E" so screen readers spell, not pronounce. */
/**
 * The chip's drawn height at 1× — its own padding plus one line of `plate`.
 *
 * ⚠️ DERIVED HERE, beside the styles it is derived FROM, so it cannot drift.
 * A row that puts a chip on a line with plain text needs to reserve this much
 * whether or not the chip is there, or the row changes height by role — which
 * is what made owner conversations resettle when the inbox loaded. Callers
 * multiply by `fontScale`, since the chip grows with the type inside it.
 */
export const PLATE_CHIP_HEIGHT = typography.plate.lineHeight + spacing.xs * 2;

export function spellPlate(plate: string): string {
  return plate
    .trim()
    .toUpperCase()
    .split(/\s+/)
    .map((group) => group.split('').join(' '))
    .join(', ');
}

/** UK registration in plate styling, spelled out for screen readers.
 *
 *  LONG-PRESS COPIES. The plate is the one string a user needs OUT of this app
 *  and into another — a message to the owner, a 101 report, an insurer's form —
 *  and until now the only way to get it was to retype it from the screen, which
 *  is exactly how a character gets transposed. Long-press (not tap) because the
 *  chip sits inside cards whose own tap already means "open this listing"; the
 *  gesture must not steal that. */
export function PlateChip({ plate, onPress, onMedia = false }: PlateChipProps) {
  const styles = useThemedStyles(makeStyles);
  const palette = usePalette();
  // Optional: this primitive renders in seven components, most of them tested
  // without a ToastProvider. No provider → the copy still happens, silently.
  const toast = useOptionalToast();

  const copy = async () => {
    try {
      await Clipboard.setStringAsync(plate.toUpperCase());
    } catch {
      // Clipboard is best-effort; a failure is not worth an error toast on a
      // gesture the user may not have meant to make.
      return;
    }
    // The haptic fires on BOTH platforms — it is the confirmation you feel
    // without looking, which is the whole point beside a car.
    lightHaptic();
    if (!SYSTEM_CONFIRMS_CLIPBOARD) {
      toast?.show('Plate copied');
    }
  };

  // Inside a card (onPress given), the CARD is the accessible node — it carries
  // the combined label and its own button role, and a second button announced
  // within it is noise, not an affordance. So the role and hint are claimed only
  // when this chip stands alone. The label and the copy action stay in both
  // cases: the label is what the chip has always announced, and the action is
  // how a screen-reader user reaches a gesture they cannot perform.
  const standalone = onPress === null;

  return (
    <Pressable
      accessible
      accessibilityRole={standalone ? 'button' : undefined}
      accessibilityLabel={`Plate ${spellPlate(plate)}`}
      accessibilityHint={standalone ? 'Copies the plate' : undefined}
      // Long-press is a mouse-and-finger gesture; a screen-reader user reaches
      // the same thing through the actions rotor instead.
      accessibilityActions={COPY_ACTIONS}
      onAccessibilityAction={(event) => {
        if (event.nativeEvent.actionName === 'copy') {
          void copy();
        }
      }}
      // Standalone, the tap IS the copy and the icon advertises it. Inside a
      // card the tap still belongs to the card — copying there stays on the
      // long-press, and no icon is drawn, because an icon promising a copy on
      // a chip whose tap opens a listing would be a lie.
      onPress={onPress ?? (() => void copy())}
      onLongPress={() => void copy()}
      // The drawn chip is ~26pt tall (spacing.xs top+bottom + an 18pt plate
      // line), well under the 44pt rule — and sizes.ts's house note is exactly
      // this: "Drawn size only — pad the pressable up to touchTarget". Padding
      // the chip itself would break the tight optical fit beside titles, so the
      // target grows instead. Overlap into an enclosing card is harmless: the
      // card's press is the same handler this forwards.
      hitSlop={spacing.md}
      // Its OWN pressed state, because it can no longer borrow its parent's:
      // becoming the touch responder means an enclosing card's onPressIn no
      // longer fires when the press lands on the plate, so without this the
      // chip was the one control in the app that navigated with no feedback
      // at all. surfaceSubtlePressed is the token minted for chip fills.
      style={({ pressed }) => [
        styles.chip,
        onMedia && styles.chipOnMedia,
        pressed && (onMedia ? styles.chipOnMediaPressed : styles.chipPressed),
      ]}
    >
      <View style={styles.chipInner}>
        <Text style={[styles.plate, onMedia && styles.plateOnMedia]}>{plate.toUpperCase()}</Text>
        {standalone ? (
          // Decorative: the Pressable above is one accessible node and its
          // label already names the plate, so the icon must not be announced
          // as a second thing to read.
          <Copy
            size={COPY_ICON_SIZE}
            color={onMedia ? palette.textOnMedia : palette.textSecondary}
            accessibilityElementsHidden
            importantForAccessibility="no"
          />
        ) : null}
      </View>
    </Pressable>
  );
}

/** Sits beside 14pt plate text — `iconSm` (18) would out-weigh the glyphs. */
const COPY_ICON_SIZE = 14;

const COPY_ACTIONS = [{ name: 'copy', label: 'Copy plate' }];

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    chip: {
      alignSelf: 'flex-start',
      backgroundColor: c.surfaceSubtle,
      borderRadius: radii.sm,
      paddingHorizontal: spacing.sm,
      paddingVertical: spacing.xs,
    },
    chipPressed: {
      backgroundColor: c.surfaceSubtlePressed,
    },
    // Theme-INVARIANT: identical in both schemes, because the photograph under
    // it is too. See the onMedia prop.
    //
    // ⚠️ THE HAIRLINE IS THE CHIP. On a surfaceOverMedia strip the fill matches
    // its background exactly, so the radius and padding draw nothing and the
    // plate collapses into bold white text inline with the meta line — losing
    // the treatment DESIGN_SYSTEM defines it BY. Same reasoning the map pill
    // records: "the edge is what makes it a pill rather than floating text."
    chipOnMedia: {
      backgroundColor: c.surfaceOverMedia,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: c.textOnMedia,
    },
    chipOnMediaPressed: {
      backgroundColor: c.surfaceOverMediaPressed,
    },
    plateOnMedia: {
      color: c.textOnMedia,
    },
    // Row wrapper rather than styling the Pressable itself: the chip's
    // alignSelf:'flex-start' is what keeps it hugging its text inside centred and
    // left-aligned parents alike, and turning the Pressable into a flex row would
    // fight that.
    chipInner: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.xs,
    },
    plate: {
      ...typography.plate,
      color: c.textPrimary,
      // Android's asymmetric font-box padding throws the chip off optical
      // centre beside titles — strip it (matches the detail page's chips).
      includeFontPadding: false,
    },
  });

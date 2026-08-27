/**
 * WHAT:  AlertCard — one alert on the list: its zone as a thumbnail, its name,
 *        what it watches, whether it is paused, a pause switch, and a "⋯" that
 *        opens the rest.
 * WHY:   ⚠️ THIS REPLACES A CARD WITH THREE CONTROLS IN IT. The old row carried
 *        a switch plus two ghost Buttons, "Edit" and "Delete", styled
 *        identically — so the destructive action looked exactly like the safe
 *        one, and nothing else in the app looked like this. Now the CARD is the
 *        edit affordance, the switch stays inline because pausing is the
 *        frequent action, and everything rarer moves behind one "⋯".
 *
 *        ⚠️ THE THUMBNAIL IS THE POINT OF THE REDESIGN. Five alerts used to
 *        read as five identical grey text blocks distinguished only by a
 *        ·-joined caption. An alert IS a place. See AlertZoneThumb for why it
 *        degrades to a drawn glyph rather than depending on a map rendering.
 *
 *        ⚠️ THE CARD IS A PLAIN VIEW WITH THREE SEPARATE ELEMENTS IN IT, and
 *        it took two goes to get there. Wrapping the whole card in a Pressable
 *        made it `accessible`, and iOS GROUPS an accessible element's children
 *        — so the nested Switch and "⋯" were unreachable to VoiceOver: pause
 *        and delete worked on Android and did not exist on iOS. Moving them to
 *        custom `accessibilityActions` fixed VoiceOver and TalkBack and nobody
 *        else, because Voice Control and Full Keyboard Access navigate the
 *        TREE, and a tree containing one element gives them nothing to name or
 *        tab to. Three real, separately-labelled elements is the only shape
 *        that serves all four.
 *
 *        ⚠️ AND IT STACKS ABOVE listRowStackFontScale. The text block sits
 *        between a 72pt tile and a controls column, and `flex: 1` is basis-0,
 *        so at 200% the name renders a few characters and an ellipsis. Past
 *        the threshold the controls drop to their own row — see `leadStacked`
 *        for the Yoga trap that fix walked into on its first attempt.
 * LINKS: ./AlertZoneThumb.tsx; ./AlertActionsSheet.tsx;
 *        ../screens/AlertsScreen.tsx; ../lib/alertName.ts (summariseAlert).
 */

import { MoreHorizontal } from 'lucide-react-native';
import { Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native';

import {
  listRowStackFontScale,
  opacity,
  radii,
  sizes,
  spacing,
  typography,
  usePalette,
  useThemedStyles,
  type Palette,
} from '@/shared/theme';
import { AppSwitch } from '@/shared/ui';

import { summariseAlert } from '../lib/alertName';
import type { Alert } from '../types';

import { AlertZoneThumb } from './AlertZoneThumb';

export interface AlertCardProps {
  alert: Alert;
  /** Pressing the card — the primary action, editing it. */
  onPress: () => void;
  onToggle: (enabled: boolean) => void;
  /** Opens the "⋯" sheet. */
  onMore: () => void;
}

export function AlertCard({ alert, onPress, onToggle, onMore }: AlertCardProps) {
  const styles = useThemedStyles(makeStyles);
  const palette = usePalette();
  const { fontScale } = useWindowDimensions();
  const stacked = (fontScale ?? 1) > listRowStackFontScale;


  return (
    <View style={[styles.card, stacked && styles.cardStacked]} testID={`alert-row-${alert.id}`}>
      {/* The card is a plain View and THIS is the pressable — see the header
          for why the three controls are three separate elements. */}
      <Pressable
        onPress={onPress}
        accessibilityRole="button"
        // The name alone is not enough: "Home" tells a screen reader nothing
        // about what it does. The summary is the sentence sighted users get,
        // and "Paused" is appended because an explicit label overrides the
        // child text — without it the one word of STATUS never reaches anyone.
        accessibilityLabel={`${alert.name}. ${summariseAlert(alert)}${
          alert.enabled ? '' : '. Paused'
        }`}
        accessibilityHint="Opens this alert to edit it"
        style={({ pressed }) => [
          styles.lead,
          stacked && styles.leadStacked,
          pressed && styles.leadPressed,
        ]}
        testID={`alert-open-${alert.id}`}
      >
        <AlertZoneThumb
          latitude={alert.latitude}
          longitude={alert.longitude}
          radiusMiles={alert.radiusMiles}
          dimmed={!alert.enabled}
          testID={`alert-thumb-${alert.id}`}
        />

        <View style={styles.main}>
          <Text style={[styles.name, !alert.enabled && styles.namePaused]} numberOfLines={1}>
            {alert.name}
          </Text>
          <Text style={styles.summary} numberOfLines={2}>
            {summariseAlert(alert)}
          </Text>
          {!alert.enabled ? (
            <Text style={styles.paused} testID={`alert-paused-${alert.id}`}>
              Paused
            </Text>
          ) : null}
        </View>
      </Pressable>

      <View style={[styles.controls, stacked && styles.controlsStacked]}>
        {/* ⚠️ THE BOX IS THE TARGET, AND IT HAS TO BE A PRESSABLE TO BE ONE. A
            plain View with minHeight buys layout height and captures nothing,
            so the 13pt band around the ~31pt iOS switch fell through to
            whatever was behind it. AppSwitch stays interactive underneath, so
            dragging still works and a direct hit is handled by the switch —
            the deepest responder wins, so neither fires twice. */}
        <Pressable
          onPress={() => onToggle(!alert.enabled)}
          accessibilityRole="switch"
          accessibilityLabel={`${alert.name} alerts`}
          accessibilityState={{ checked: alert.enabled }}
          style={styles.switchHit}
          testID={`alert-toggle-${alert.id}`}
        >
          {/* Hidden so the pair reads as ONE switch: the box above carries the
              role, the label and the state. */}
          <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
            <AppSwitch value={alert.enabled} onValueChange={onToggle} />
          </View>
        </Pressable>
        <Pressable
          onPress={onMore}
          accessibilityRole="button"
          accessibilityLabel={`More options for ${alert.name}`}
          style={({ pressed }) => [styles.more, pressed && styles.morePressed]}
          testID={`alert-more-${alert.id}`}
        >
          <MoreHorizontal size={sizes.icon} color={palette.textSecondary} />
        </Pressable>
      </View>
    </View>
  );
}

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    // ⚠️ NO SHADOW, and a hairline instead. Every Airbnb pass on this app has
    // shipped cards flat (settings, legal, payouts, spotter story, bug report),
    // and the hairline is what separates the card from the page — which matters
    // most in dark, where `surface` on `background` is #1E1E1E on #141414.
    // NOTE: DESIGN_SYSTEM's Card entry still specifies a soft shadow; code and
    // doc disagree across five screens now, and that is a doc decision, not one
    // to settle silently here.
    card: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.md,
      padding: spacing.lg,
      borderRadius: radii.lg,
      backgroundColor: c.surface,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: c.border,
    },
    // Past the threshold the controls take their own row, so the name and
    // summary get the card's full width instead of ~127pt of it.
    cardStacked: {
      flexDirection: 'column',
      alignItems: 'stretch',
    },
    // The thumbnail and the text always travel together, at both scales.
    lead: {
      flex: 1,
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.md,
    },
    // ⚠️ NEUTRALISE THE BASIS WHEN THE CARD IS A COLUMN. `flex: 1` is
    // `flexBasis: 0`, which works while the card's main axis is its definite
    // WIDTH — but `cardStacked` makes the main axis its auto HEIGHT, where
    // there is no free space to distribute and a basis-0 child resolves to
    // ZERO. The thumbnail and the text would then overflow the card's bottom
    // edge, at exactly the font scale this stacking exists to serve. The same
    // trap alertSteps.tsx and DESIGN_SYSTEM both record for the map step.
    leadStacked: {
      flexGrow: 0,
      flexBasis: 'auto',
    },
    leadPressed: {
      backgroundColor: c.surfaceSubtle,
      borderRadius: radii.md,
    },
    main: { flex: 1, gap: spacing.xs },
    name: { ...typography.cardTitle, color: c.textPrimary },
    namePaused: { color: c.textSecondary },
    summary: { ...typography.caption, color: c.textSecondary },
    // ⚠️ `label` (14 Medium), NOT StatusPill and NOT another `caption`.
    //
    // Another caption is what it used to be — typographically identical to the
    // summary directly above it, so the row's one piece of STATUS read as a
    // third line of metadata.
    //
    // StatusPill was the obvious fix and is wrong here: its badge fills with
    // `c.surface` (StatusBadge.tsx), which is exactly the colour of this card,
    // so it would silently render as a bare dot and label — looking acceptable
    // by accident rather than by design. A surface-aware pill is a shared/ui
    // change, not an alerts change. Medium weight against the Regular summary
    // is enough separation for one word, and DESIGN_SYSTEM's rule is satisfied
    // either way: the status is a WORD, never a colour alone.
    paused: { ...typography.label, color: c.textSecondary },
    controls: { alignItems: 'center', gap: spacing.xs },
    controlsStacked: {
      flexDirection: 'row',
      justifyContent: 'flex-end',
      alignItems: 'center',
      gap: spacing.sm,
    },
    switchHit: {
      minWidth: sizes.touchTarget,
      minHeight: sizes.touchTarget,
      alignItems: 'center',
      justifyContent: 'center',
    },
    more: {
      width: sizes.touchTarget,
      height: sizes.touchTarget,
      alignItems: 'center',
      justifyContent: 'center',
      borderRadius: radii.full,
    },
    morePressed: { opacity: opacity.pressed },
  });

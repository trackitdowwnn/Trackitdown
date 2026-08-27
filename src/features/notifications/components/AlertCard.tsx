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
 *        ⚠️ ONE ACCESSIBILITY ELEMENT, WITH ACTIONS — not three nested
 *        touchables. A Pressable is `accessible` by default and iOS GROUPS its
 *        children into a single selectable component, so a nested Switch and a
 *        nested button are simply unreachable to VoiceOver: pause and delete
 *        would work on Android and not exist on iOS. The card therefore
 *        announces itself once, carries `checked` for the pause state, and
 *        exposes "Pause"/"Resume" and "More options" as screen-reader ACTIONS —
 *        the same answer ListRow gives its `trailing` slot and DESIGN_SYSTEM
 *        gives PlateChip's "Copy plate".
 *
 *        ⚠️ AND IT STACKS ABOVE listRowStackFontScale. Two fixed-width
 *        neighbours (a 72pt tile and ~95pt of controls) leave the text block
 *        about 127pt on a 390pt phone; `flex: 1` is basis-0, so at 200% the
 *        name renders four characters and an ellipsis. Past the threshold the
 *        controls drop to their own row — the trap ListRow.tsx and
 *        BugDisclosurePanel already document.
 * LINKS: ./AlertZoneThumb.tsx; ./AlertActionsSheet.tsx;
 *        ../screens/AlertsScreen.tsx; ../lib/alertName.ts (summariseAlert).
 */

import { MoreHorizontal } from 'lucide-react-native';
import { Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native';

import { milesToMetres } from '@/shared/lib/distance';
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

  const pauseLabel = alert.enabled ? 'Pause' : 'Resume';

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      // The name alone is not enough: "Home" tells a screen reader nothing
      // about what it does. The summary is the same sentence sighted users get.
      accessibilityLabel={`${alert.name}. ${summariseAlert(alert)}`}
      accessibilityHint="Opens this alert to edit it"
      // `checked` is how the pause state reaches a screen reader now that the
      // switch itself is inside the grouped element.
      accessibilityState={{ checked: alert.enabled }}
      accessibilityActions={[
        { name: 'pause', label: `${pauseLabel} alerts` },
        { name: 'more', label: 'More options' },
      ]}
      onAccessibilityAction={(event) => {
        if (event.nativeEvent.actionName === 'pause') onToggle(!alert.enabled);
        if (event.nativeEvent.actionName === 'more') onMore();
      }}
      style={({ pressed }) => [
        styles.card,
        stacked && styles.cardStacked,
        pressed && styles.cardPressed,
      ]}
      testID={`alert-row-${alert.id}`}
    >
      <View style={styles.lead}>
        <AlertZoneThumb
          latitude={alert.latitude}
          longitude={alert.longitude}
          radiusMiles={alert.radiusMiles}
          radiusMetres={milesToMetres(alert.radiusMiles)}
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
      </View>

      {/* ⚠️ HIDDEN FROM THE A11Y TREE, DELIBERATELY. iOS has already folded
          these into the card above; leaving them "visible" to the tree would
          promise focus stops that do not exist. The card's accessibilityActions
          are how a screen reader reaches both. */}
      <View
        style={[styles.controls, stacked && styles.controlsStacked]}
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
      >
        {/* The switch is ~31pt tall on iOS — under the 44 floor — and a near
            miss would otherwise land on the card and silently open the editor.
            The box is the target. */}
        <View style={styles.switchHit}>
          <AppSwitch value={alert.enabled} onValueChange={onToggle} />
        </View>
        <Pressable
          onPress={onMore}
          style={({ pressed }) => [styles.more, pressed && styles.morePressed]}
          testID={`alert-more-${alert.id}`}
        >
          <MoreHorizontal size={sizes.icon} color={palette.textSecondary} />
        </Pressable>
      </View>
    </Pressable>
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
    cardPressed: {
      backgroundColor: c.surfaceSubtle,
    },
    // The thumbnail and the text always travel together, at both scales.
    lead: {
      flex: 1,
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.md,
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
      minHeight: sizes.touchTarget,
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

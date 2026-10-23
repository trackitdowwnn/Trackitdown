/**
 * WHAT:  ListRowGroup — a titled group of ListRows with hairline dividers
 *        between them. The grouping primitive every settings-shaped screen
 *        needs.
 * WHY:   Lifted verbatim out of ProfileScreen, which had been the app's only
 *        settings surface and kept this private. A second consumer (the
 *        Settings screen) made it two features needing the same thing, which
 *        is ARCHITECTURE.md's bar for `shared/`.
 *
 *        ⚠️ NAMED ListRowGroup, NOT Section, on purpose. Two other local
 *        `Section` components already exist with DIFFERENT grammar —
 *        AreaInsightsScreen's has no dividers, PostStatsScreen's has a top
 *        border and a `first` prop. A third thing called `Section` in shared/
 *        would read as the one they should all collapse into, and they should
 *        not: they are three different layouts that happen to share a word.
 *        The name says what it takes.
 * LINKS: src/shared/ui/ListRow.tsx (what it groups);
 *        src/features/profile/screens/ProfileScreen.tsx,
 *        src/features/profile/screens/SettingsScreen.tsx (the two consumers).
 *
 * Usage:
 *   <ListRowGroup title="Appearance">
 *     <ListRow title="System" selected={pref === 'system'} onPress={…} />
 *     <ListRow title="Light" selected={pref === 'light'} onPress={…} />
 *   </ListRowGroup>
 */

import { TriangleAlert } from 'lucide-react-native';
import { Children, Fragment, type ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import {
  radii,
  sizes,
  spacing,
  typography,
  usePalette,
  useThemedStyles,
  type Palette,
} from '@/shared/theme';

export interface ListRowGroupProps {
  title: string;
  children: ReactNode;
  /**
   * Recedes the title to a caption and drops the dividers — for groups that
   * are present but not part of the page's rhythm (the __DEV__ tools).
   */
  quiet?: boolean;
  /**
   * `danger` marks a group of irreversible or account-ending actions: a red
   * title led by a warning icon, and the rows inside a thin red outline card
   * (GitHub's danger-zone pattern). Owner, 2026-10-23: the plain heading
   * "doesn't read as a danger zone". Profile's Danger zone is the one use —
   * keep it rare, or it stops meaning anything. `quiet` wins if both are set.
   */
  tone?: 'default' | 'danger';
  testID?: string;
}

export function ListRowGroup({
  title,
  children,
  quiet = false,
  tone = 'default',
  testID,
}: ListRowGroupProps) {
  const styles = useThemedStyles(makeStyles);
  const palette = usePalette();
  const danger = tone === 'danger' && !quiet;
  // ⚠️ Children.toArray DROPS null and false, which is what keeps the divider
  // count right when a row is conditional — `{cond ? <ListRow/> : null}` in the
  // middle of a group must not leave a hairline with nothing under it. The
  // Payouts row on the profile is exactly this case.
  const rows = Children.toArray(children);

  return (
    <View style={styles.group} testID={testID}>
      {/* accessibilityRole="header" — absent from the local version this was
          lifted from, present on both the OTHER local Sections. A screen
          reader should be able to jump between groups. */}
      {danger ? (
        // testID on the row: lucide icons don't forward one.
        <View style={styles.dangerTitleRow} testID="list-row-group-danger-title">
          {/* Decorative: the words carry the meaning, the icon the alarm. */}
          <TriangleAlert
            size={sizes.iconSm}
            color={palette.danger}
            accessible={false}
            importantForAccessibility="no"
          />
          <Text style={[styles.title, styles.titleDanger]} accessibilityRole="header">
            {title}
          </Text>
        </View>
      ) : (
        <Text style={quiet ? styles.titleQuiet : styles.title} accessibilityRole="header">
          {title}
        </Text>
      )}
      <View
        style={danger ? styles.dangerCard : undefined}
        testID={danger ? 'list-row-group-danger-card' : undefined}
      >
        {rows.map((row, index) => (
          <Fragment key={index}>
            {index > 0 && !quiet ? (
              // testID on a decorative rule, deliberately: the divider COUNT
              // is the component's only real logic (a conditional row must not
              // leave an orphan hairline) and counting them by style is
              // brittle enough that the test was wrong twice before this.
              <View style={styles.divider} testID="list-row-group-divider" />
            ) : null}
            {row}
          </Fragment>
        ))}
      </View>
    </View>
  );
}

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    group: {
      gap: spacing.sm,
    },
    // Heading-scale ink titles carry the page rhythm (profile reference §1c);
    // the quiet variant keeps the old label treatment so it recedes.
    title: {
      ...typography.heading,
      color: c.textPrimary,
      paddingHorizontal: spacing.md,
    },
    titleQuiet: {
      ...typography.label,
      color: c.textSecondary,
      paddingHorizontal: spacing.md,
    },
    // The icon takes the title's inset; the title then sits flush beside it.
    dangerTitleRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.sm,
      // In line with the row icons inside the card (1 border + xs + md).
      paddingLeft: spacing.lg,
    },
    titleDanger: {
      color: c.danger,
      paddingHorizontal: 0,
      // A Text in a row won't shrink by default; at large text sizes a longer
      // title must wrap, not run off the screen.
      flexShrink: 1,
    },
    // `danger` on `background`: 5.5:1 light, 6.1:1 dark (DESIGN_SYSTEM). The
    // padding keeps ListRow's pressed pill (radii.md) an even gap clear of the
    // outline on all four sides, so a press never paints over the border.
    dangerCard: {
      borderWidth: 1,
      borderColor: c.danger,
      borderRadius: radii.lg,
      padding: spacing.xs,
    },
    divider: {
      height: StyleSheet.hairlineWidth,
      backgroundColor: c.border,
      // Inset = ListRow's pressed-pill radius (radii.md = 12): the hairline
      // meets the flat edge of the pressed surfaceSubtle pill exactly. If
      // either token moves, revisit both together — and they now live in the
      // same directory, which is most of why this belongs here.
      marginHorizontal: spacing.md,
    },
  });

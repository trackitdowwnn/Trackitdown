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

import { Children, Fragment, type ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { spacing, typography, useThemedStyles, type Palette } from '@/shared/theme';

export interface ListRowGroupProps {
  title: string;
  children: ReactNode;
  /**
   * Recedes the title to a caption and drops the dividers — for groups that
   * are present but not part of the page's rhythm (the __DEV__ tools).
   */
  quiet?: boolean;
  testID?: string;
}

export function ListRowGroup({ title, children, quiet = false, testID }: ListRowGroupProps) {
  const styles = useThemedStyles(makeStyles);
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
      <Text
        style={quiet ? styles.titleQuiet : styles.title}
        accessibilityRole="header"
      >
        {title}
      </Text>
      <View>
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

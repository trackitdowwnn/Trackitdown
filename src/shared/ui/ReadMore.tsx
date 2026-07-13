/**
 * WHAT:  ReadMore — collapsible body text that clamps to `numberOfLines`
 *        (default 4) with a "Show more" / "Show less" toggle, shown ONLY when
 *        the text actually overflows the clamp.
 * WHY:   Owner notes and long descriptions shouldn't dominate the scroll, but
 *        a short note must render plainly with no dangling control. Overflow
 *        is measured from the first (unclamped) layout via onTextLayout, then
 *        the clamp is applied — the toggle appears only if it's earned.
 * LINKS: src/features/vehicles (owner's note); docs/DESIGN_SYSTEM.md (type).
 */

import { useCallback, useState } from 'react';
import type { NativeSyntheticEvent, TextLayoutEventData } from 'react-native';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { colors, sizes, spacing, typography } from '../theme';

export interface ReadMoreProps {
  children: string;
  /** Lines shown while collapsed. Default 4. */
  numberOfLines?: number;
}

export function ReadMore({ children, numberOfLines = 4 }: ReadMoreProps) {
  const [expanded, setExpanded] = useState(false);
  const [overflows, setOverflows] = useState(false);
  const [measured, setMeasured] = useState(false);

  // Measure ONCE from the unclamped first render: if the full text runs past
  // the clamp, a toggle is warranted. After that we stop measuring and apply
  // the clamp (a brief full-text frame before clamping is the standard cost).
  const onTextLayout = useCallback(
    (event: NativeSyntheticEvent<TextLayoutEventData>) => {
      if (!measured) {
        setOverflows(event.nativeEvent.lines.length > numberOfLines);
        setMeasured(true);
      }
    },
    [measured, numberOfLines],
  );

  return (
    <View>
      <Text
        testID="readmore-body"
        style={styles.body}
        onTextLayout={onTextLayout}
        numberOfLines={measured && !expanded ? numberOfLines : undefined}
      >
        {children}
      </Text>
      {overflows ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={expanded ? 'Show less' : 'Show more'}
          onPress={() => setExpanded((value) => !value)}
          hitSlop={{ left: spacing.sm, right: spacing.sm }}
          style={styles.togglePress}
        >
          <Text style={styles.toggle}>{expanded ? 'Show less' : 'Show more'}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  body: {
    ...typography.body,
    color: colors.textPrimary,
  },
  togglePress: {
    marginTop: spacing.xs,
    alignSelf: 'flex-start',
    // A real 44pt touch target for the label-height text.
    minHeight: sizes.touchTarget,
    justifyContent: 'center',
  },
  toggle: {
    ...typography.label,
    color: colors.textPrimary,
    textDecorationLine: 'underline',
  },
});

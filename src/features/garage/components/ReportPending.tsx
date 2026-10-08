/**
 * WHAT:  ReportPending — what the report host shows while it can't yet tell
 *        whether you have cars to choose from: the back control, nothing else
 *        for motion.skeletonGrace, then one quiet line, "Checking your
 *        garage…". `immediate` skips the blank grace.
 * WHY:   Someone with NO cars reaches this whenever the garage answer isn't in
 *        yet (a slow network, a failed warm-up). The old placeholder was "Which
 *        car?" over two car-shaped skeleton rows, which told them, for a beat,
 *        that they had cars (2026-10-07). So nothing here looks like the
 *        answer: no title, no rows. Most answers land inside the grace and go
 *        straight on; only a slow one shows the line. The back control is
 *        there throughout, so there is always a way out.
 *
 *        `immediate` is for a RETRY from the error view: by then the page has
 *        already shown its chrome, so blanking it again would be a flash of
 *        its own (review of #140).
 * LINKS: src/features/garage/screens/StartReportScreen.tsx (the host);
 *        src/features/garage/screens/ReportSavedCarScreen.tsx (the /my-cars
 *          entry, which waits the same way); src/shared/theme/motion.ts.
 */

import { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { motion, spacing, typography, useThemedStyles, type Palette } from '@/shared/theme';
import { Screen } from '@/shared/ui';

import { ReportHeader } from './ReportHeader';

export function ReportPending({ onBack, immediate = false }: { onBack: () => void; immediate?: boolean }) {
  const styles = useThemedStyles(makeStyles);
  // A held timer, not a render-time clock: the React Compiler would freeze it.
  const [graceOver, setGraceOver] = useState(immediate);
  useEffect(() => {
    if (graceOver) {
      return;
    }
    const timer = setTimeout(() => setGraceOver(true), motion.skeletonGrace);
    return () => clearTimeout(timer);
  }, [graceOver]);

  return (
    <Screen>
      <ReportHeader onBack={onBack} />
      <View
        style={styles.body}
        accessible
        // Worded for everyone: we don't know yet whether there are cars.
        accessibilityLabel="Checking your garage"
        accessibilityState={{ busy: true }}
        testID="report-pending"
      >
        {graceOver ? (
          <Text style={styles.line} testID="report-pending-line">
            Checking your garage…
          </Text>
        ) : null}
      </View>
    </Screen>
  );
}

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    body: {
      flex: 1,
      paddingHorizontal: spacing.xl,
      paddingTop: spacing.lg,
    },
    line: {
      ...typography.caption,
      color: c.textSecondary,
    },
  });

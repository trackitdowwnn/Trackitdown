/**
 * WHAT:  "Sent with your report" — the visible list of everything that travels
 *        with a bug report, and the sentence explaining the parts that are not
 *        rows.
 * WHY:   ⚠️ THIS IS THE DESIGN, NOT DECORATION, and it was inline in
 *        ReportBugScreen until the wizard rebuild (2026-08-27) needed it on the
 *        review screen instead. It renders from the SAME readers the payload is
 *        built from, so the screen cannot claim less than it sends. Diagnostic
 *        data is a collection category this app did not previously have and the
 *        privacy policy names the same fields — a visible list is what makes
 *        that bullet honest rather than boilerplate.
 *
 *        ⚠️ EVERY FIELD ADDED TO THE PAYLOAD MUST APPEAR HERE IN THE SAME
 *        CHANGE, including counts. That rule is why this is one component with
 *        one row builder rather than a panel and a payload that resemble each
 *        other.
 *
 *        ⚠️ NEVER CONDITIONED AWAY. The whole panel used to hang on
 *        `lines.length > 0`, so on a handset where none of the device fields
 *        could be read the user was told NOTHING — while their account link
 *        still travelled. The one sentence that is always true was the one that
 *        could vanish. Only the ROWS are conditional.
 * LINKS: ../lib/bugReportFlow.tsx (renders it as the review footer);
 *        ../lib/bugDiagnostics.ts (where the rows come from);
 *        ../api/bugReportApi.ts (what actually gets sent).
 */

import { StyleSheet, Text, View } from 'react-native';

import { radii, spacing, typography, useThemedStyles, type Palette } from '@/shared/theme';

import { labelForArea, type BugArea } from '../lib/bugReportOptions';

export interface BugDisclosurePanelProps {
  /** Device facts, already described by `describeDiagnostics`. */
  lines: { label: string; value: string }[];
  area: BugArea | null;
  /** How many screenshots are attached. */
  shots: number;
  testID?: string;
}

/**
 * The disclosure rows: the device facts, plus anything else that will travel.
 *
 * ⚠️ THIS IS THE PROMISE, so it grows whenever the payload does. Severity and
 * frequency are deliberately absent. On the old single screen that was because
 * they sat as selected cards two inches further up; on the review screen it is
 * because they are ANSWER ROWS directly above this panel. The distinction is
 * actually sharper now: the rows above are what the reporter chose, and this
 * panel is what travels that they did not. The screenshot COUNT is here because
 * an image is the one attachment whose weight is easy to forget, and the
 * breadcrumb line is here because it is the only thing on the list the user did
 * not personally choose.
 */
export function bugDisclosureRows({
  lines,
  area,
  shots,
}: {
  lines: { label: string; value: string }[];
  area: BugArea | null;
  shots: number;
}): { label: string; value: string }[] {
  const rows = [...lines];

  const areaLabel = labelForArea(area);
  if (areaLabel) {
    rows.push({ label: 'Area', value: areaLabel });
  }
  if (shots > 0) {
    rows.push({
      label: 'Screenshots',
      value: shots === 1 ? '1 image' : `${shots} images`,
    });
  }
  rows.push({ label: 'Recent activity', value: 'Step names only' });

  return rows;
}

export function BugDisclosurePanel({ lines, area, shots, testID }: BugDisclosurePanelProps) {
  const styles = useThemedStyles(makeStyles);

  return (
    <View style={styles.panel} testID={testID ?? 'report-bug-diagnostics'}>
      <Text style={styles.title} accessibilityRole="header">
        Sent with your report
      </Text>
      {bugDisclosureRows({ lines, area, shots }).map((line) => (
        <View
          key={line.label}
          style={styles.row}
          // Joined so VoiceOver reads "App version: 1.0.0" as ONE item;
          // unwrapped, a two-Text row is announced as two fragments and the
          // pairing is lost.
          accessible
          accessibilityLabel={`${line.label}: ${line.value}`}
        >
          <Text style={styles.label}>{line.label}</Text>
          <Text style={styles.value}>{line.value}</Text>
        </View>
      ))}
      {/* "nothing from the rest of the app" rather than "nothing about the cars
          you've looked at": naming the browsing history raises the very worry
          the sentence exists to settle. */}
      <Text style={styles.note}>
        Your account, so we can reply. A list of what the app was doing — the names of the steps
        only, never what they were about. Nothing else from the rest of the app.
      </Text>
    </View>
  );
}

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    panel: {
      backgroundColor: c.surfaceSubtle,
      borderRadius: radii.md,
      padding: spacing.lg,
      gap: spacing.xs,
    },
    title: {
      ...typography.label,
      color: c.textPrimary,
      marginBottom: spacing.xs,
    },
    row: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      gap: spacing.md,
    },
    label: {
      ...typography.caption,
      color: c.textSecondary,
    },
    value: {
      ...typography.caption,
      color: c.textPrimary,
      // Shrinks rather than pushing the label off — the label is the half that
      // makes the value mean anything.
      flexShrink: 1,
      textAlign: 'right',
    },
    note: {
      ...typography.caption,
      color: c.textSecondary,
      marginTop: spacing.sm,
    },
  });

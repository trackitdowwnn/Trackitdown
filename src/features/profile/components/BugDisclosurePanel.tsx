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
 *        still travelled. Two rows are now unconditional for exactly that
 *        reason — "Your account" and "Recent activity" — so the panel always
 *        has something true to say even when every device field reads null.
 *
 *        ⚠️ THE CLOSING PARAGRAPH IS GONE (owner request, 2026-08-27). It read
 *        "Your account, so we can reply. A list of what the app was doing — the
 *        names of the steps only, never what they were about. Nothing else from
 *        the rest of the app." Its two load-bearing claims did NOT go with it:
 *        the account is now the first row, and the trail is still described as
 *        "Step names only". What was lost is the reassurance about what is NOT
 *        collected, which no row can carry. If a reader ever wonders whether
 *        the app sends their browsing history, that sentence is where the
 *        answer used to be.
 * LINKS: ../lib/bugReportFlow.tsx (renders it as the review footer);
 *        ../lib/bugDiagnostics.ts (where the rows come from);
 *        ../api/bugReportApi.ts (what actually gets sent).
 */

import { StyleSheet, Text, useWindowDimensions, View } from 'react-native';

import {
  listRowStackFontScale,
  radii,
  spacing,
  typography,
  useThemedStyles,
  type Palette,
} from '@/shared/theme';

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
 * frequency are deliberately absent, and so are the two free-text answers —
 * because all four are ANSWER ROWS directly above this panel on the review
 * screen. The division is: the rows above are what the reporter chose or typed,
 * and this panel is what travels that they did not.
 *
 * ⚠️ THAT DIVISION IS ONLY SAFE WHILE BOTH HALVES ARE COMPLETE. `expected` was
 * in NEITHER for one commit — no `reviewValue` covered it and no row here did —
 * so a free-text field left the device unshown. `bugReportFlow.test.tsx` pins
 * it: it searches the step rows AND `bugDisclosureRows` for every key of
 * BugReportAnswers, keyed by a `Record<keyof BugReportAnswers, string>`, so a
 * new answer that appears in neither half is a compile error and a failure.
 *
 * The screenshot COUNT is here because
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
  // ⚠️ THE ACCOUNT ROW REPLACES A PARAGRAPH, and it is not decoration. The
  // panel used to end with a sentence beginning "Your account, so we can
  // reply"; the owner asked for that paragraph to go (2026-08-27) and NOTHING
  // else on this list mentions identity — the device facts, the area, the
  // screenshots and the trail are all about the report, not the reporter. The
  // operator's email now carries the reporter's address and user id, so the one
  // thing that must not become invisible is precisely this. A row says it in
  // four words instead of three lines.
  const rows = [{ label: 'Your account', value: 'So we can reply' }, ...lines];

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

/**
 * The panel itself — the rows above plus the one sentence that is always true.
 *
 * Rendered as the review screen's footer, i.e. the last thing above "Send
 * report", which is where "this is what you are about to send" belongs.
 */
export function BugDisclosurePanel({ lines, area, shots, testID }: BugDisclosurePanelProps) {
  const styles = useThemedStyles(makeStyles);
  // ⚠️ STACKS ABOVE listRowStackFontScale. The flex rule below keeps the value
  // whole while both halves still fit on a line, but there is a scale past
  // which they simply do not: at 200% "Recent activity" and "Step names only"
  // cannot share a row on a 390pt phone whichever half yields. Side by side is
  // right while it fits; past the threshold the pair has to become two lines —
  // the same call ListRow.tsx makes at the same threshold, so a reader at 200%
  // meets one layout across the app rather than two.
  const { fontScale } = useWindowDimensions();
  const stacked = (fontScale ?? 1) > listRowStackFontScale;

  return (
    <View style={styles.panel} testID={testID ?? 'report-bug-diagnostics'}>
      <Text style={styles.title} accessibilityRole="header">
        Sent with your report
      </Text>
      {bugDisclosureRows({ lines, area, shots }).map((line) => (
        <View
          key={line.label}
          style={[styles.row, stacked && styles.rowStacked]}
          // Joined so VoiceOver reads "App version: 1.0.0" as ONE item;
          // unwrapped, a two-Text row is announced as two fragments and the
          // pairing is lost.
          accessible
          accessibilityLabel={`${line.label}: ${line.value}`}
        >
          <Text style={styles.label}>{line.label}</Text>
          <Text style={stacked ? styles.valueStacked : styles.value}>{line.value}</Text>
        </View>
      ))}
    </View>
  );
}

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    // radii.lg — this is a CARD, and DESIGN_SYSTEM scopes lg to cards.
    //
    // ⚠️ `surface` + A HAIRLINE, NOT `surfaceSubtle`, which is what the
    // extraction reverted it to for one commit. surfaceSubtle sits BELOW
    // surface in light and ABOVE it in dark, so built with it this un-pressable
    // panel became the most-raised thing on the dark screen, brighter than the
    // tappable rows above it. The page underneath is `background` on the review
    // screen exactly as it was on the old form (WizardScreen.tsx:330), so the
    // relationship the original chose still holds. The hairline is what keeps
    // this a PANEL rather than a card: it never changes colour, has no icon and
    // has no press state.
    panel: {
      backgroundColor: c.surface,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: c.border,
      borderRadius: radii.lg,
      padding: spacing.lg,
      // ⚠️ spacing.sm, NOT xs. At 4pt this panel reintroduced exactly the
      // density ReviewStep.tsx:20 removed from the rows directly above it —
      // "an app whose sections breathe at 24/32" reading as a settings list —
      // on the same screen, inches apart.
      gap: spacing.sm,
    },
    // The same token ReviewStep gives its group headings — though NOT, as this
    // comment first claimed, "sitting among group headings": ReviewStep renders
    // those only when a flow has more than one phase, and this flow declares
    // one, so on the screen it actually appears this is the sole subhead under
    // the headline. `label` made the one element that IS the promise the
    // quietest thing on the screen; `heading` outranks its own `body` rows and
    // still yields to the wizard's `display`.
    //
    // spacing.sm on top of the panel's own spacing.sm gap = 16 to the first
    // row, matching what ReviewStep gives a group title. At spacing.xs it was
    // 12 against an 8pt row rhythm — 4pt of difference is not an introduction.
    title: {
      ...typography.heading,
      color: c.textPrimary,
      marginBottom: spacing.sm,
    },
    row: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      // ⚠️ `baseline`, and `flex-start` was the near-miss. `stretch` renders
      // correctly here only because RN draws Text from the top of its box,
      // which stops being true the moment a value wraps — but `flex-start`
      // fixes the wrap and introduces a stagger, because RN centres text in its
      // line box and these two differ: a 13/18 caption's optical centre lands
      // at 9, a 16/24 body's at 12. Three points out, repeated down six rows,
      // widening with font scale. Baselines are what should agree.
      alignItems: 'baseline',
      gap: spacing.md,
    },
    rowStacked: {
      flexDirection: 'column',
      alignItems: 'flex-start',
      gap: spacing.xs,
    },
    // ⚠️ THE LABEL YIELDS, NOT THE VALUE — `flex: 1` here and NO flex property
    // on the value, and the extraction had these exactly the wrong way round
    // for one commit. flexShrink is PROPORTIONAL, weighted by base width:
    // whichever string is longer surrenders more of itself, and the longer one
    // is virtually always the VALUE ("iPhone 14 Pro Max · iOS 18.2.1" against
    // "Device"), so the thing being disclosed was the thing being crushed.
    // Setting the value at `body` (16) against a `caption` label (13) widens
    // that gap rather than closing it. ListRow gets this right and this copies
    // it: the label takes the flex, the value keeps Yoga's default flexShrink
    // of 0 and wraps on its own terms.
    label: {
      ...typography.caption,
      color: c.textSecondary,
      flex: 1,
    },
    // `body`, pairing with a `caption` label — the same TYPE pairing ReviewStep
    // gives its answer rows, so the disclosed value is the larger half in both
    // lists. Not the same geometry: ReviewStep stacks its pair left-aligned,
    // this one runs label and value across the row. That is deliberate — these
    // are short spec pairs ("Device — iPhone 14"), not question and answer —
    // but it is a different shape, not a matching one.
    value: {
      ...typography.body,
      color: c.textPrimary,
      textAlign: 'right',
    },
    valueStacked: {
      ...typography.body,
      color: c.textPrimary,
    },
  });

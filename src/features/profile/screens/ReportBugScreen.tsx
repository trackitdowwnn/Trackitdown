/**
 * WHAT:  "Report a bug" — a free-text box, a visible list of exactly what
 *        travels with it, and a send button. Pushed from Profile → Support &
 *        legal.
 * WHY:   There was no way to tell us something is broken. The only support
 *        affordance is a mailto: to a placeholder address.
 *
 *        ⚠️ THE "SENT WITH YOUR REPORT" LIST IS THE DESIGN, not decoration. It
 *        renders from the same `readBugDiagnostics()` the payload is built from,
 *        so the screen cannot claim less than it sends. Diagnostic data is a
 *        collection category this app did not previously have, and the privacy
 *        policy names these same four fields — a visible list is what makes
 *        that bullet honest rather than boilerplate.
 *
 *        The hint under the box asks for no plate and no address. It is a
 *        request, not a filter: there is no way to stop someone typing one, and
 *        the honest response is to ask, keep the text out of the logs, and hold
 *        it where only the operator can read it. Nothing in this app moderates
 *        free text and this screen does not pretend otherwise.
 *
 *        No screenshot attach, no log attach, no route capture. The reasons are
 *        in the migration header; the short version is that all three bypass
 *        every redaction rule the app has.
 * LINKS: ../api/bugReportApi.ts; ../lib/bugDiagnostics.ts;
 *        src/app/report-bug.tsx (the route);
 *        src/features/sightings/screens/SightingDisputeScreen.tsx (the
 *          free-text-and-submit screen this mirrors).
 */

import { useRouter } from 'expo-router';
import { ChevronLeft } from 'lucide-react-native';
import { useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { sizes, spacing, typography, usePalette, useThemedStyles, type Palette } from '@/shared/theme';
import { Button, Screen, TextField, useToast } from '@/shared/ui';

import { BUG_REPORT_MAX_LENGTH, BugReportError, submitBugReport } from '../api/bugReportApi';
import { describeDiagnostics, readBugDiagnostics } from '../lib/bugDiagnostics';

export function ReportBugScreen() {
  const styles = useThemedStyles(makeStyles);
  const palette = usePalette();
  const router = useRouter();
  const toast = useToast();

  const [message, setMessage] = useState('');
  const [sending, setSending] = useState(false);

  // Read once. Nothing here changes while the screen is open, and re-reading on
  // every keystroke would be work for no answer.
  const diagnostics = useMemo(() => readBugDiagnostics(), []);
  const lines = useMemo(() => describeDiagnostics(diagnostics), [diagnostics]);

  const canSend = message.trim().length > 0 && !sending;

  const send = async () => {
    if (!canSend) return;
    setSending(true);
    try {
      await submitBugReport(message, diagnostics);
      toast.show('Thanks — we’ll take a look.');
      if (router.canGoBack()) {
        router.back();
      } else {
        router.replace('/(tabs)/profile');
      }
    } catch (error) {
      toast.show(error instanceof BugReportError ? error.message : 'We couldn’t send this. Please try again.', 'error');
      // Stays on screen with the text intact: losing what someone just wrote
      // about a bug is its own bug.
      setSending(false);
    }
  };

  return (
    <Screen scroll contentContainerStyle={styles.scroll} keyboardAware>
      <View style={styles.headerRow}>
        {/* Frozen while sending, because the success path pops: a back tap
            mid-flight would pop a SECOND screen out from under whoever is
            there when the promise resolves. The field is muted at that point
            anyway, so a still chevron reads as consistent. */}
        <Pressable
          onPress={() => (router.canGoBack() ? router.back() : router.replace('/(tabs)/profile'))}
          disabled={sending}
          accessibilityRole="button"
          accessibilityState={{ disabled: sending }}
          accessibilityLabel="Back"
          style={styles.back}
          testID="report-bug-back"
        >
          <ChevronLeft size={sizes.icon} color={palette.textPrimary} />
        </Pressable>
        <Text style={styles.title} accessibilityRole="header">
          Report a bug
        </Text>
      </View>

      <TextField
        label="What went wrong?"
        variant="multiline"
        value={message}
        onChangeText={setMessage}
        maxLength={BUG_REPORT_MAX_LENGTH}
        helperText="Please don’t include a number plate or an address — we don’t need them to fix this."
        disabled={sending}
        testID="report-bug-message"
      />

      {/* ⚠️ NEVER CONDITIONED AWAY. The whole panel used to hang on
          `lines.length > 0`, so on a handset where none of the four fields
          could be read the user was told NOTHING — while their account link
          still travelled. The one sentence that is always true was the one
          that could vanish. Only the ROWS are conditional now.

          Rows are `accessible` with a joined label so VoiceOver reads
          "App version: 1.0.0" as one item; unwrapped, a two-Text row is
          announced as two fragments and the pairing is lost. */}
      <View style={styles.diagnostics} testID="report-bug-diagnostics">
        <Text style={styles.diagnosticsTitle} accessibilityRole="header">
          Sent with your report
        </Text>
        {lines.map((line) => (
          <View
            key={line.label}
            style={styles.diagnosticsRow}
            accessible
            accessibilityLabel={`${line.label}: ${line.value}`}
          >
            <Text style={styles.diagnosticsLabel}>{line.label}</Text>
            <Text style={styles.diagnosticsValue}>{line.value}</Text>
          </View>
        ))}
        {/* "nothing from the rest of the app" rather than "nothing about the
            cars you've looked at": naming the browsing history raises the very
            worry the sentence exists to settle. */}
        <Text style={styles.diagnosticsNote}>
          Your account, so we can reply. Nothing else — no screenshots, and nothing from the rest of
          the app.
        </Text>
      </View>

      {/* `disabled` is emptiness ONLY. Passing `!canSend` made the button
          disabled AND loading at once, which dims it under its own spinner and
          announces "dimmed, busy" — Button treats loading as busy-not-
          unavailable and already blocks the press on either. */}
      <Button
        label="Send report"
        onPress={() => void send()}
        disabled={message.trim().length === 0}
        loading={sending}
      />
    </Screen>
  );
}

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    scroll: {
      padding: spacing.xl,
      gap: spacing.lg,
    },
    headerRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.xs,
    },
    back: {
      width: sizes.touchTarget,
      height: sizes.touchTarget,
      alignItems: 'center',
      justifyContent: 'center',
      marginLeft: -(sizes.touchTarget - sizes.icon) / 2,
    },
    title: {
      ...typography.title,
      color: c.textPrimary,
      flexShrink: 1,
    },
    // A quiet panel rather than a card: this is a disclosure, not an object the
    // reader is meant to act on. The extra bottom margin (16 from the scroll
    // gap + 8 here) stops "here is what we send" from reading as one block with
    // "Send" — it is the last thing weighed before committing, not a caption
    // on the button.
    diagnostics: {
      gap: spacing.sm,
      paddingTop: spacing.md,
      marginBottom: spacing.sm,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: c.border,
    },
    diagnosticsTitle: {
      ...typography.label,
      color: c.textPrimary,
    },
    diagnosticsRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      // Stated, not inherited: `stretch` renders correctly here only because RN
      // draws Text from the top of its box, which stops being true the moment a
      // value wraps.
      alignItems: 'flex-start',
      gap: spacing.lg,
    },
    // ⚠️ THE LABEL YIELDS, NOT THE VALUE. flexShrink defaults to 0, so without
    // this the label took all the width it wanted and the value — the thing
    // actually being disclosed — absorbed the entire squeeze. At 200% text
    // "App version" left about half the row and "iPhone 14 Pro Max · iOS 18.2.1"
    // funnelled into a narrow right-hand column, breaking one fact across four
    // lines with a dangling "·". ListRow has the same precedence: the title
    // block flexes, the value holds its line.
    diagnosticsLabel: {
      ...typography.caption,
      color: c.textSecondary,
      flexShrink: 1,
    },
    diagnosticsValue: {
      ...typography.caption,
      color: c.textPrimary,
      flexShrink: 1,
      textAlign: 'right',
    },
    diagnosticsNote: {
      ...typography.caption,
      color: c.textSecondary,
    },
  });

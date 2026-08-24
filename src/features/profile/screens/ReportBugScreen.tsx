/**
 * WHAT:  "Report a bug" — what went wrong, where in the app, how bad, how
 *        often, what they expected, optional screenshots, and a visible list of
 *        exactly what travels with it. Pushed from Profile → Support & legal.
 * WHY:   There was no way to tell us something is broken. The only support
 *        affordance is a mailto: to a placeholder address.
 *
 *        ⚠️ THE "SENT WITH YOUR REPORT" LIST IS THE DESIGN, not decoration. It
 *        renders from the same readers the payload is built from, so the screen
 *        cannot claim less than it sends. Diagnostic data is a collection
 *        category this app did not previously have, and the privacy policy
 *        names the same fields — a visible list is what makes that bullet
 *        honest rather than boilerplate. Every field ADDED to the payload must
 *        appear here in the same change, including the counts.
 *
 *        The hint under the box asks for no plate and no address. It is a
 *        request, not a filter: there is no way to stop someone typing one, and
 *        the honest response is to ask, keep the text out of the logs, and hold
 *        it where only the operator can read it. Nothing in this app moderates
 *        free text and this screen does not pretend otherwise.
 *
 *        ⚠️ SCREENSHOTS (added 2026-08-24, owner request). The warning above
 *        the picker is load-bearing, not garnish: no redaction helper can reach
 *        inside a PNG, so the ONLY controls are that the user chose the image,
 *        can tap it to see it full-screen, was told in plain words what it
 *        might contain, and can remove it. Never add an automatic capture path
 *        — the whole justification collapses the moment the user did not choose
 *        the picture. See ../api/bugScreenshotUpload.ts.
 *
 *        Still no log payloads and no route: the breadcrumb trail is event
 *        NAMES only, and "where in the app" is a closed vocabulary that cannot
 *        hold an id. See ../lib/bugBreadcrumbs.ts and ../lib/lastArea.ts.
 * LINKS: ../api/bugReportApi.ts; ../api/bugScreenshotUpload.ts;
 *        ../lib/bugDiagnostics.ts; ../lib/bugReportOptions.ts;
 *        src/app/report-bug.tsx (the route);
 *        src/features/sightings/screens/SightingDisputeScreen.tsx (the
 *          free-text-and-submit screen this mirrors).
 */

import { useRouter } from 'expo-router';
import * as ImagePicker from 'expo-image-picker';
import { ChevronLeft, Plus, X } from 'lucide-react-native';
import { useCallback, useMemo, useState } from 'react';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';

import { useSession } from '@/features/auth';
import {
  radii,
  sizes,
  spacing,
  typography,
  usePalette,
  useThemedStyles,
  type Palette,
} from '@/shared/theme';
import {
  Button,
  ChoiceChips,
  PhotoPreviewModal,
  Screen,
  SelectField,
  TextField,
  useToast,
  type PickedPhoto,
} from '@/shared/ui';

import {
  BUG_REPORT_MAX_LENGTH,
  BugReportError,
  readBugReportQuota,
  submitBugReport,
} from '../api/bugReportApi';
import { MAX_BUG_SCREENSHOTS, uploadBugScreenshots } from '../api/bugScreenshotUpload';
import { readBreadcrumbs } from '../lib/bugBreadcrumbs';
import { describeDiagnostics, readBugDiagnostics } from '../lib/bugDiagnostics';
import {
  BUG_AREAS,
  BUG_FREQUENCIES,
  BUG_SEVERITIES,
  labelForArea,
  type BugArea,
  type BugFrequency,
  type BugSeverity,
} from '../lib/bugReportOptions';
import { readLastArea } from '../lib/lastArea';

export function ReportBugScreen() {
  const styles = useThemedStyles(makeStyles);
  const palette = usePalette();
  const router = useRouter();
  const toast = useToast();
  const session = useSession();

  const [message, setMessage] = useState('');
  const [expected, setExpected] = useState('');
  // Pre-filled from the last tab visited — a tab NAME, never a route. Reading
  // it in the initialiser rather than an effect means the picker is never
  // briefly empty and then filled, which reads as the app changing its mind.
  const [area, setArea] = useState<BugArea | null>(() => readLastArea());
  const [severity, setSeverity] = useState<BugSeverity | null>(null);
  const [frequency, setFrequency] = useState<BugFrequency | null>(null);
  const [shots, setShots] = useState<PickedPhoto[]>([]);
  const [previewUri, setPreviewUri] = useState<string | null>(null);
  const [sending, setSending] = useState(false);

  // Read once. Nothing here changes while the screen is open, and re-reading on
  // every keystroke would be work for no answer.
  const diagnostics = useMemo(() => readBugDiagnostics(), []);
  const lines = useMemo(() => describeDiagnostics(diagnostics), [diagnostics]);

  const canSend = message.trim().length > 0 && !sending;

  const addScreenshots = useCallback(async () => {
    const remaining = MAX_BUG_SCREENSHOTS - shots.length;
    if (remaining <= 0) return;

    // ⚠️ exif: false, and the re-encode at upload strips the rest. The picker
    // flag governs what we are HANDED; the file on disk keeps its own tags, so
    // both are needed. A user attaching a bug report will sometimes pick a
    // photograph, and a photograph taken at home carries that home's GPS.
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      exif: false,
      allowsMultipleSelection: true,
      selectionLimit: remaining,
      quality: 1,
    });
    if (result.canceled) return;

    setShots((current) =>
      [
        ...current,
        ...result.assets.map((asset) => ({
          uri: asset.uri,
          width: asset.width,
          height: asset.height,
        })),
      ].slice(0, MAX_BUG_SCREENSHOTS),
    );
  }, [shots.length]);

  const send = async () => {
    if (!canSend) return;
    setSending(true);
    try {
      // Advisory only — the RPC still enforces. Asked BEFORE uploading so a
      // rate-limited reporter is not made to wait for three images first.
      const remaining = await readBugReportQuota();
      if (remaining === 0) {
        throw new BugReportError(
          'You’ve sent a few reports already. Please try again in an hour.',
          'RATE_LIMITED',
        );
      }

      // ⚠️ NO SILENT DROP. Written first as
      // `shots.length > 0 && userId ? upload(...) : []`, which on a missing
      // session sent the report with NO screenshots while the panel above still
      // listed them — the screen claiming MORE than the payload carried, which
      // is the same failure as claiming less and just as bad. A report is
      // signed-in only anyway; if the session is gone, say so.
      const userId = session.status === 'signedIn' ? session.userId : null;
      if (!userId) {
        throw new BugReportError('Please sign in to send a report.', 'NOT_AUTHENTICATED');
      }
      const screenshotPaths = await uploadBugScreenshots(userId, shots);

      await submitBugReport(message, diagnostics, {
        area,
        severity,
        frequency,
        expected: expected.trim() ? expected : null,
        breadcrumbs: readBreadcrumbs(),
        screenshotPaths,
      });
      toast.show('Thanks — we’ll take a look.');
      if (router.canGoBack()) {
        router.back();
      } else {
        router.replace('/(tabs)/profile');
      }
    } catch (error) {
      toast.show(
        error instanceof BugReportError ? error.message : 'We couldn’t send this. Please try again.',
        'error',
      );
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

      {/* Everything below is optional, and the heading says so once rather than
          each field repeating "(optional)" — four optional tags in a column
          reads as a form that does not know what it wants. */}
      <Text style={styles.sectionTitle} accessibilityRole="header">
        A few details, if you have them
      </Text>

      <SelectField
        label="Where in the app?"
        options={BUG_AREAS}
        value={area}
        onChange={setArea}
        disabled={sending}
        screenTitle="Where in the app?"
      />

      <View style={styles.field}>
        <Text style={styles.fieldLabel} nativeID="bug-severity-label">
          How much did it get in your way?
        </Text>
        <ChoiceChips
          options={BUG_SEVERITIES}
          value={severity}
          onSelect={setSeverity}
          testID="report-bug-severity"
        />
      </View>

      <View style={styles.field}>
        <Text style={styles.fieldLabel} nativeID="bug-frequency-label">
          How often does it happen?
        </Text>
        <ChoiceChips
          options={BUG_FREQUENCIES}
          value={frequency}
          onSelect={setFrequency}
          testID="report-bug-frequency"
        />
      </View>

      <TextField
        label="What did you expect instead?"
        variant="multiline"
        value={expected}
        onChangeText={setExpected}
        maxLength={BUG_REPORT_MAX_LENGTH}
        disabled={sending}
        testID="report-bug-expected"
      />

      <View style={styles.field}>
        <Text style={styles.fieldLabel} accessibilityRole="header">
          Screenshots
        </Text>
        {/* ⚠️ THE WARNING IS THE MITIGATION. Nothing in this codebase can
            redact the inside of an image, so the user checking it IS the
            control — which is why the thumbnails are tappable and the sentence
            is specific about what to look for rather than a vague "be
            careful". */}
        <Text style={styles.warning}>
          A screenshot can show an address or a number plate. Tap one to check it before you send.
        </Text>
        <View style={styles.shotRow}>
          {shots.map((shot, index) => (
            <View key={shot.uri} style={styles.shotWrap}>
              <Pressable
                onPress={() => setPreviewUri(shot.uri)}
                accessibilityRole="imagebutton"
                accessibilityLabel={`Screenshot ${index + 1} of ${shots.length}. Opens full screen.`}
                style={styles.shot}
                testID={`report-bug-shot-${index}`}
              >
                <Image source={{ uri: shot.uri }} style={styles.shotImage} resizeMode="cover" />
              </Pressable>
              <Pressable
                onPress={() => setShots((current) => current.filter((c) => c.uri !== shot.uri))}
                disabled={sending}
                accessibilityRole="button"
                accessibilityLabel={`Remove screenshot ${index + 1}`}
                style={styles.shotRemove}
                testID={`report-bug-shot-remove-${index}`}
              >
                <X size={sizes.iconSm} color={palette.textOnMedia} />
              </Pressable>
            </View>
          ))}
          {shots.length < MAX_BUG_SCREENSHOTS ? (
            <Pressable
              onPress={() => void addScreenshots()}
              disabled={sending}
              accessibilityRole="button"
              accessibilityLabel="Add a screenshot"
              style={styles.shotAdd}
              testID="report-bug-shot-add"
            >
              <Plus size={sizes.icon} color={palette.textSecondary} />
            </Pressable>
          ) : null}
        </View>
      </View>

      {/* ⚠️ NEVER CONDITIONED AWAY. The whole panel used to hang on
          `lines.length > 0`, so on a handset where none of the fields could be
          read the user was told NOTHING — while their account link still
          travelled. The one sentence that is always true was the one that could
          vanish. Only the ROWS are conditional now.

          Rows are `accessible` with a joined label so VoiceOver reads
          "App version: 1.0.0" as one item; unwrapped, a two-Text row is
          announced as two fragments and the pairing is lost. */}
      <View style={styles.diagnostics} testID="report-bug-diagnostics">
        <Text style={styles.diagnosticsTitle} accessibilityRole="header">
          Sent with your report
        </Text>
        {summaryRows({ lines, area, shots: shots.length }).map((line) => (
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
          Your account, so we can reply. A list of what the app was doing — the names of the steps
          only, never what they were about. Nothing else from the rest of the app.
        </Text>
      </View>

      <Button
        label="Send report"
        onPress={() => void send()}
        disabled={message.trim().length === 0}
        loading={sending}
      />

      <PhotoPreviewModal uri={previewUri} onClose={() => setPreviewUri(null)} />
    </Screen>
  );
}

/**
 * The disclosure rows: the device facts, plus anything else that will travel.
 *
 * ⚠️ THIS IS THE PROMISE, so it grows whenever the payload does. Severity and
 * frequency are deliberately absent: they are visible as selected chips two
 * inches up the same screen, and repeating them here would pad the list without
 * telling anyone anything they cannot already see. The screenshot COUNT is
 * here because an image is the one attachment whose weight is easy to forget,
 * and the breadcrumb line is here because it is the only thing on the list the
 * user did not personally choose.
 */
function summaryRows({
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
    sectionTitle: {
      ...typography.label,
      color: c.textPrimary,
    },
    field: {
      gap: spacing.sm,
    },
    fieldLabel: {
      ...typography.caption,
      color: c.textSecondary,
    },
    // Not an error colour: nothing has gone wrong. This is a caution the reader
    // should act on, and painting it red would make every report with an image
    // feel like a mistake in progress.
    warning: {
      ...typography.caption,
      color: c.textSecondary,
    },
    shotRow: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: spacing.sm,
    },
    shotWrap: {
      position: 'relative',
    },
    shot: {
      width: sizes.featureThumb,
      height: sizes.featureThumb,
      borderRadius: radii.md,
      overflow: 'hidden',
      backgroundColor: c.surfaceSubtle,
    },
    shotImage: {
      width: '100%',
      height: '100%',
    },
    // Opaque chrome over an unknown image — surfaceOverMedia is the token for
    // anything CARRYING content over a photo; mediaScrim is for gradients
    // behind chrome and does not clear contrast for a glyph.
    shotRemove: {
      position: 'absolute',
      top: -spacing.xs,
      right: -spacing.xs,
      width: sizes.iconSm * 2,
      height: sizes.iconSm * 2,
      borderRadius: sizes.iconSm,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: c.surfaceOverMedia,
    },
    shotAdd: {
      width: sizes.featureThumb,
      height: sizes.featureThumb,
      borderRadius: radii.md,
      alignItems: 'center',
      justifyContent: 'center',
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: c.border,
      backgroundColor: c.surfaceSubtle,
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

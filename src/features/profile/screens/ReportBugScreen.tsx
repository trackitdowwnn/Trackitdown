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
  CardSelect,
  PhotoPreviewModal,
  Screen,
  SelectField,
  StickyActionBar,
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
    <Screen
      scroll
      contentContainerStyle={styles.scroll}
      keyboardAware
      footer={
        <StickyActionBar testID="report-bug-footer">
          {/* `disabled` is emptiness ONLY. Passing `!canSend` made the button
              disabled AND loading at once, which dims it under its own spinner
              and announces "dimmed, busy" — Button treats loading as
              busy-not-unavailable and already blocks the press on either. */}
          <Button
            label="Send report"
            onPress={() => void send()}
            disabled={message.trim().length === 0}
            loading={sending}
          />
        </StickyActionBar>
      }
    >
      {/* Chrome only — no title competing with the headline below. The
          reference puts the screen's name in the CONTENT at display size and
          leaves the bar to hold the way out. */}
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
      </View>

      <View style={styles.intro}>
        <Text style={styles.title} accessibilityRole="header">
          Report a bug
        </Text>
        {/* Flat on purpose. "Help us make Trackitdown better" asks someone who
            has just hit a broken screen to feel warm about doing us a favour;
            this just says what happens next. */}
        <Text style={styles.subtitle}>
          Tell us what went wrong and we’ll take a look.
        </Text>
      </View>

      {/* ⚠️ THE ONLY REQUIRED QUESTION, so it gets the same heading the
          optional ones do. It had none — it lived as a floating label, which
          rests at body size and shrinks to caption once you type — so the one
          answer we actually need was quieter than the five we can do without. */}
      <View style={styles.firstSection}>
        <Text style={styles.sectionTitle} accessibilityRole="header">
          What went wrong?
        </Text>
        <TextField
          label="Tell us what happened"
          variant="multiline"
          value={message}
          onChangeText={setMessage}
          maxLength={BUG_REPORT_MAX_LENGTH}
          helperText="Please don’t include a number plate or an address — we don’t need them to fix this."
          disabled={sending}
          testID="report-bug-message"
        />
      </View>

      {/* ⚠️ A BAND OVER EVERYTHING BELOW, not a title for the next question.
          At `heading` inside a `section` it was structurally identical to the
          four question headings that follow, so it read as belonging to "Where
          in the app?" alone and the other four were never told they were
          optional. `sectionTitle` (20/26) is the token that exists to band a
          scrolling column, and the extra air separates it from what it covers.

          Said once rather than four "(optional)" tags in a column, which reads
          as a form that does not know what it wants. */}
      <Text style={styles.bandTitle} accessibilityRole="header">
        A few details, if you have them
      </Text>

      <View style={styles.section}>
        <SelectField
          label="Where in the app?"
          options={BUG_AREAS}
          value={area}
          onChange={setArea}
          disabled={sending}
          screenTitle="Where in the app?"
        />
      </View>

      {/* ⚠️ CardSelect, not ChoiceChips. Chips are right for an answer of one
          or two words; these three each need a sentence before they mean
          anything, and "Annoying" as a bare pill next to "I lost money or
          data" reads as two options of equal weight when they are anything
          but. CardSelect is the house component for exactly this — icon,
          title, one calm line — and it indicates selection by border colour at
          a constant width, so nothing reflows on tap. */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle} accessibilityRole="header">
          How much did it get in your way?
        </Text>
        <CardSelect
          options={BUG_SEVERITIES}
          value={severity}
          onSelect={setSeverity}
        />
      </View>

      {/* Same rows, no icons and no descriptions — the three answers explain
          themselves in two words. Sharing CardSelect's anatomy keeps the two
          questions reading as siblings; giving these a padded line of
          explanation each would be words for the sake of symmetry. */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle} accessibilityRole="header">
          How often does it happen?
        </Text>
        <CardSelect
          options={BUG_FREQUENCIES}
          value={frequency}
          onSelect={setFrequency}
        />
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle} accessibilityRole="header">
          What did you expect instead?
        </Text>
        <TextField
          label="In your own words"
          variant="multiline"
          value={expected}
          onChangeText={setExpected}
          maxLength={BUG_REPORT_MAX_LENGTH}
          disabled={sending}
          testID="report-bug-expected"
        />
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle} accessibilityRole="header">
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
                hitSlop={(sizes.touchTarget - sizes.iconSm * 2) / 2}
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
    // ⚠️ NO `gap` HERE ANY MORE. A single even gap is what made this read as
    // a settings list: the headline, six unrelated questions and a disclosure
    // all sat the same distance apart, so nothing grouped and nothing led.
    // Each section owns its own top margin now, and the rhythm is the house
    // one — 32 above a section title, 16 inside it.
    scroll: {
      padding: spacing.xl,
    },
    headerRow: {
      flexDirection: 'row',
      alignItems: 'center',
    },
    back: {
      width: sizes.touchTarget,
      height: sizes.touchTarget,
      alignItems: 'center',
      justifyContent: 'center',
      marginLeft: -(sizes.touchTarget - sizes.icon) / 2,
    },
    // The headline lives in the CONTENT, not the header bar — that move is what
    // gives the screen a top, and it is most of what stops this reading as a
    // settings page.
    //
    // ⚠️ `title` (24/30), NOT `display` (32/38 Black), which is what this was
    // first built with. Every content-level `display` in the app is a QUESTION
    // or a MOMENT — the wizard's step, the permission primer — whereas this is
    // a screen name, which is exactly what DESIGN_SYSTEM scopes `title` to. It
    // was also the loudest type in the app landing on its least celebratory
    // screen, against a register the owner chose as "calm and matter-of-fact",
    // and at fontScale 2 it came to 64/76 — around 150pt of headline plus a
    // sub-line before the first question on a 390×844 phone.
    intro: {
      gap: spacing.sm,
      marginTop: spacing.md,
      marginBottom: spacing.xxl,
    },
    title: {
      ...typography.title,
      color: c.textPrimary,
    },
    subtitle: {
      ...typography.body,
      color: c.textSecondary,
    },
    // The house section rhythm (post-wizard-review REFERENCE_SPEC §2):
    // 32 above the title, 16 between the title and its control.
    section: {
      gap: spacing.lg,
      marginTop: spacing.xxl,
    },
    // The first one sits directly under the intro block, which already spent
    // its own spacing.xxl — no second helping.
    firstSection: {
      gap: spacing.lg,
    },
    // Bands the optional half of the form. Larger than a question heading so it
    // reads as covering them rather than as one of them.
    bandTitle: {
      ...typography.sectionTitle,
      color: c.textPrimary,
      marginTop: spacing.xxl,
    },
    sectionTitle: {
      ...typography.heading,
      color: c.textPrimary,
    },
    // ⚠️ SET AS BODY, NOT AS FINE PRINT. This sentence is the entire control
    // over what a screenshot contains — nothing here can redact the inside of a
    // PNG — and it was 13pt grey, which is the same "most important thing
    // dressed as the least important" mistake the disclosure panel below was
    // just rescued from.
    //
    // Still not `danger`: nothing has gone wrong, and painting it red would
    // make every report carrying an image feel like a mistake in progress.
    warning: {
      ...typography.body,
      color: c.textPrimary,
    },
    shotRow: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: spacing.sm,
    },
    // ⚠️ PADDED SO THE REMOVE BUTTON STAYS INSIDE ITS PARENT. The button used
    // to sit at top/right: -spacing.xs, i.e. OUTSIDE these bounds — and Android
    // delivers no touch (and honours no hitSlop) outside a parent, so the
    // overhanging half was simply dead. PhotoGridPicker already carries this
    // scar: "spacing.sm inset keeps the whole hitSlop inside the tile bounds".
    shotWrap: {
      position: 'relative',
      paddingTop: spacing.sm,
      paddingRight: spacing.sm,
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
    // 36pt of ink with hitSlop taking the TARGET to 44 (DESIGN_SYSTEM's
    // minimum) — the WatchToggle pattern. A visually larger button would
    // swallow the thumbnail it sits on.
    shotRemove: {
      position: 'absolute',
      top: 0,
      right: 0,
      width: sizes.iconSm * 2,
      height: sizes.iconSm * 2,
      borderRadius: radii.full,
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
    // ⚠️ WEIGHT WITHOUT AFFORDANCE — and this REVERSES what stood here before,
    // which read "a quiet panel rather than a card: this is a disclosure, not
    // an object the reader is meant to act on". That was right about affordance
    // and wrong about weight. As a hairline and grey text it was the most
    // important thing on the screen dressed as the least important — literal
    // fine print under a form, in the one place the app makes a promise about
    // what it collects.
    //
    // So it gets a ground and a radius, and deliberately gets NO shadow, NO
    // chevron and NO press state: a card that looks tappable with nothing to
    // tap is its own small lie. It should read as a notice, not a control.
    // ⚠️ `surface` + a hairline, NOT `surfaceSubtle`, and the reason is that
    // surfaceSubtle sits BELOW surface in light (#EEEEEE under #F7F7F7) and
    // ABOVE it in dark (#2A2A2A over #1E1E1E). Built with it, this panel — a
    // notice nobody can press — was the most-raised thing on the dark screen,
    // brighter than the CardSelect rows that actually are tappable. The ladder
    // has to mean the same thing in both palettes.
    //
    // It also stops the app's one collection promise sharing a fill with the
    // empty screenshot tile 32pt above it.
    //
    // The hairline is what keeps it a panel rather than a card: the CardSelect
    // rows share this ground but change border COLOUR when chosen, and this one
    // never changes, has no icon, no radio and no press state.
    diagnostics: {
      gap: spacing.sm,
      marginTop: spacing.xxl,
      padding: spacing.lg,
      borderRadius: radii.lg,
      backgroundColor: c.surface,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: c.border,
    },
    diagnosticsTitle: {
      ...typography.cardTitle,
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
    // ⚠️ THE LABEL YIELDS, NOT THE VALUE — and `flexShrink: 1` on BOTH did not
    // achieve that, which is what stood here and what this comment used to
    // claim was fixed. flexShrink is PROPORTIONAL, weighted by base width: give
    // both rows the same factor and the longer string surrenders more of
    // itself. The longer string is virtually always the value
    // ("iPhone 14 Pro Max · iOS 18.2.1" against "Device"), so the thing being
    // disclosed was still the thing being crushed.
    //
    // ListRow gets it right and this now copies it exactly: the label takes
    // `flex: 1` and the value declares NO flex property at all, so Yoga's
    // default flexShrink of 0 lets it hold its line and wrap on its own terms.
    diagnosticsLabel: {
      ...typography.caption,
      color: c.textSecondary,
      flex: 1,
    },
    diagnosticsValue: {
      ...typography.caption,
      color: c.textPrimary,
      textAlign: 'right',
    },
    diagnosticsNote: {
      ...typography.caption,
      color: c.textSecondary,
    },
  });

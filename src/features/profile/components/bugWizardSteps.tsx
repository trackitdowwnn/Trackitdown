/**
 * WHAT:  The three step bodies of the report-a-bug wizard: what happened,
 *        where and how bad, and screenshots.
 * WHY:   The wizard framework renders the chrome — headline, progress, footer,
 *        slide — so a step body is only its inputs. Split out of the old
 *        single-screen form (2026-08-27) rather than rewritten: the copy, the
 *        component choices and the warnings below all carry their original
 *        reasoning, because none of it was about being on one screen.
 *
 *        ⚠️ GROUPED, NOT ONE QUESTION PER SCREEN. The framework's other four
 *        flows ask one thing at a time, and this one deliberately does not.
 *        Those flows serve someone motivated — posting a car, claiming a
 *        bounty — whereas a bug report is altruistic and filed by someone
 *        already annoyed that something broke. Six screens to report a typo is
 *        how you get no bug reports. Three grouped steps, and only the first
 *        asks for anything.
 * LINKS: ../lib/bugReportFlow.tsx (the flow that orders these);
 *        ../lib/bugReportOptions.ts (the closed vocabularies).
 */

import * as ImagePicker from 'expo-image-picker';
import { Plus, X } from 'lucide-react-native';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import {
  opacity,
  radii,
  sizes,
  spacing,
  typography,
  usePalette,
  useThemedStyles,
  type Palette,
} from '@/shared/theme';
import {
  AppImage,
  CardSelect,
  PhotoPreviewModal,
  SelectField,
  TextField,
  useToast,
} from '@/shared/ui';
import type { WizardStepProps } from '@/shared/wizard';

import { BUG_REPORT_MAX_LENGTH } from '../api/bugReportApi';
import { MAX_BUG_SCREENSHOTS } from '../api/bugScreenshotUpload';
import { describeMessageProgress } from '../lib/bugMessageRules';
import { BUG_AREAS, BUG_FREQUENCIES, BUG_SEVERITIES } from '../lib/bugReportOptions';
import type { BugReportAnswers } from '../lib/bugReportAnswers';

/** Step 1 — the only required question, and the one they came to answer. */
export function BugWhatHappenedStep({ answers, setAnswers }: WizardStepProps<BugReportAnswers>) {
  const styles = useThemedStyles(makeStyles);
  const message = answers.message ?? '';
  const counter = describeMessageProgress(message);

  return (
    <View style={styles.body}>
      {/* ⚠️ NO no-plate/no-address HELPER LINE ANY MORE (owner request,
          2026-08-27). It read "Please don't include a number plate or an
          address — we don't need them to fix this", and it was a REQUEST, not a
          filter: nothing in this app moderates free text, so asking was the
          only control that existed over what someone types here. Removing it
          does not change what is collected, logged or stored — the message is
          still kept out of the logs (bugReportApi logs a fixed reason code
          only) and still visible in full on the review screen before it is
          sent. It does mean nobody is asked any more, so if a reporter pastes a
          plate it now arrives unremarked. Recorded here rather than deleted
          silently, because the next person to read this file will wonder. */}
      <TextField
        label="Tell us what happened"
        variant="multiline"
        value={message}
        onChangeText={(next) => setAnswers({ message: next })}
        maxLength={BUG_REPORT_MAX_LENGTH}
        counter={counter}
        // The count again, as a hint — announced once on focus rather than
        // re-read on every keystroke, and it is also the only place a screen
        // reader is told about the minimum at all.
        accessibilityHint={counter}
        testID="report-bug-message"
      />

      {/* Second on the SAME step, not a screen of its own. "What did you
          expect?" is the same thought as "what happened" — separating them
          makes someone describe one incident twice, a screen apart.

          ⚠️ THE QUESTION IS THE FIELD'S OWN LABEL, not a header above it. This
          had both for a while — a grey `label` header AND the field's grey
          floating label — which is two quiet labels for one box, and the
          header's accessibilityRole duplicated the field's accessible name into
          the screen-reader output. Everywhere else in this flow the rule is:
          controls WITH a label slot use it, controls without one (CardSelect)
          get a header. This control has one. */}
      <TextField
        label="What did you expect instead? (optional)"
        variant="multiline"
        value={answers.expected ?? ''}
        onChangeText={(expected) => setAnswers({ expected })}
        maxLength={BUG_REPORT_MAX_LENGTH}
        testID="report-bug-expected"
      />
    </View>
  );
}

/** Step 2 — triage. All three optional; area usually arrives pre-filled. */
export function BugContextStep({ answers, setAnswers }: WizardStepProps<BugReportAnswers>) {
  const styles = useThemedStyles(makeStyles);

  return (
    <View style={styles.body}>
      <SelectField
        label="Where in the app?"
        options={BUG_AREAS}
        value={answers.area ?? null}
        onChange={(area) => setAnswers({ area })}
        screenTitle="Where in the app?"
      />

      {/* ⚠️ CardSelect, not ChoiceChips. Chips are right for an answer of one
          or two words; these three each need a sentence before they mean
          anything, and "Annoying" as a bare pill next to "I lost money or data"
          reads as two options of equal weight when they are anything but.
          CardSelect indicates selection by border colour at a constant width,
          so nothing reflows on tap. */}
      <View style={styles.question}>
        <Text style={styles.label} accessibilityRole="header">
          How much did it get in your way?
        </Text>
        <CardSelect
          // The question again, because the header above is reachable by
          // heading navigation but never announced with the control.
          accessibilityLabel="How much did it get in your way?"
          options={BUG_SEVERITIES}
          value={answers.severity ?? null}
          onSelect={(severity) => setAnswers({ severity })}
        />
      </View>

      {/* Same rows, no icons and no descriptions — these three explain
          themselves in two words. Sharing CardSelect's anatomy keeps the two
          questions reading as siblings; a padded line of explanation each would
          be words for the sake of symmetry. */}
      <View style={styles.question}>
        <Text style={styles.label} accessibilityRole="header">
          How often does it happen?
        </Text>
        <CardSelect
          accessibilityLabel="How often does it happen?"
          options={BUG_FREQUENCIES}
          value={answers.frequency ?? null}
          onSelect={(frequency) => setAnswers({ frequency })}
        />
      </View>
    </View>
  );
}

/** Step 3 — screenshots, and the warning that is the only control there is. */
export function BugScreenshotsStep({ answers, setAnswers }: WizardStepProps<BugReportAnswers>) {
  const styles = useThemedStyles(makeStyles);
  const palette = usePalette();
  const toast = useToast();
  const [previewUri, setPreviewUri] = useState<string | null>(null);
  const shots = answers.shots ?? [];
  const previewIndex = shots.findIndex((shot) => shot.uri === previewUri);
  const previewLabel =
    previewIndex >= 0 ? `Screenshot ${previewIndex + 1} of ${shots.length}` : undefined;

  const addScreenshots = async () => {
    const remaining = MAX_BUG_SCREENSHOTS - shots.length;
    if (remaining <= 0) return;

    // ⚠️ exif: false, and the re-encode at upload strips the rest. The picker
    // flag governs what we are HANDED; the file on disk keeps its own tags, so
    // both are needed. A user attaching a bug report will sometimes pick a
    // photograph, and a photograph taken at home carries that home's GPS.
    // Caught, because this is fired as `void addScreenshots()` from a Pressable
    // — an unguarded rejection is an unhandled promise AND a button that looks
    // dead, on the step's only affordance.
    let result: ImagePicker.ImagePickerResult;
    try {
      result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        exif: false,
        allowsMultipleSelection: true,
        selectionLimit: remaining,
        quality: 1,
      });
    } catch {
      toast.show('We couldn’t open your photos.');
      return;
    }
    if (result.canceled) return;

    setAnswers({
      shots: [
        ...shots,
        ...result.assets.map((asset) => ({
          uri: asset.uri,
          width: asset.width,
          height: asset.height,
        })),
      ].slice(0, MAX_BUG_SCREENSHOTS),
    });
  };

  return (
    <View style={styles.body}>
      {/* ⚠️ THE WARNING IS THE MITIGATION. Nothing in this codebase can redact
          the inside of an image, so the user checking it IS the control — which
          is why the thumbnails are tappable and the sentence is specific about
          what to look for rather than a vague "be careful". NEVER add an
          automatic capture path: the whole justification collapses the moment
          the user did not choose the picture. */}
      <Text style={styles.warning}>
        A screenshot can show an address or a number plate. Tap one to check it before you send.
      </Text>

      <View style={styles.shotRow}>
        {/* ⚠️ KEYED AND REMOVED BY INDEX, NOT BY URI. Two picker rounds on
            Android can hand back the same content:// for the same image, and
            with a uri key that is a duplicate React key AND a remove that drops
            BOTH copies — one tap withdrawing a picture the user meant to keep. */}
        {shots.map((shot, index) => (
          <View key={`${shot.uri}-${index}`} style={styles.shotWrap}>
            <Pressable
              onPress={() => setPreviewUri(shot.uri)}
              accessibilityRole="imagebutton"
              accessibilityLabel={`Screenshot ${index + 1} of ${shots.length}. Opens full screen.`}
              style={({ pressed }) => [styles.shot, pressed ? styles.shotPressed : null]}
              testID={`report-bug-shot-${index}`}
            >
              {/* ⚠️ `contain`, NOT `cover`, and it only works because the tile
                  is PORTRAIT — see sizes.screenshotThumbAspect, which carries
                  the arithmetic. Cropping is not allowed here: the user is
                  being asked to spot an address or a plate, and `cover` cut
                  exactly the top and bottom of the frame where headers and
                  bottom sheets live. */}
              {/* AppImage, not RN's Image: it brings the app's surfaceSubtle
                  backdrop while decoding and the motion.fast fade, so a tile
                  reads as loading rather than as a broken picture. */}
              <AppImage uri={shot.uri} contentFit="contain" style={styles.shotImage} />
            </Pressable>
            <Pressable
              onPress={() => {
                // Clear a preview of the very image being withdrawn — left
                // alone, the modal keeps showing full-bleed the picture the
                // user just decided not to send.
                if (previewUri === shot.uri) setPreviewUri(null);
                setAnswers({ shots: shots.filter((_, at) => at !== index) });
              }}
              accessibilityRole="button"
              accessibilityLabel={`Remove screenshot ${index + 1}`}
              // ⚠️ THE SLOP MUST NOT EXCEED THE INSET. On Android, hitSlop
              // outside the parent's bounds is DEAD — the touch never reaches
              // this view — so the (44 − 28)/2 = 8 of slop below is only real
              // because `shotRemove` sits spacing.sm (8) in from the tile edge.
              // Change either number and a quarter of this button silently
              // stops responding, on the one control that removes a picture the
              // user may have decided they should not send.
              hitSlop={(sizes.touchTarget - sizes.circleButtonSm) / 2}
              style={styles.shotRemove}
              // Indexed, like the tile above it. Unindexed, three attached
              // screenshots gave three buttons the same id and every
              // getByTestId threw — so the one destructive control in a
              // privacy-sensitive flow was untestable.
              testID={`report-bug-shot-remove-${index}`}
            >
              <X size={sizes.iconSm} color={palette.textOnMedia} />
            </Pressable>
          </View>
        ))}
        {shots.length < MAX_BUG_SCREENSHOTS ? (
          <Pressable
            onPress={() => void addScreenshots()}
            accessibilityRole="button"
            accessibilityLabel="Add a screenshot"
            style={({ pressed }) => [styles.shotAdd, pressed ? styles.shotPressed : null]}
            testID="report-bug-shot-add"
          >
            <Plus size={sizes.icon} color={palette.textSecondary} />
          </Pressable>
        ) : null}
      </View>

      <PhotoPreviewModal
        uri={previewUri}
        // Named, so the full-screen view a screen reader lands on says which
        // screenshot it is rather than nothing at all.
        label={previewLabel}
        onClose={() => setPreviewUri(null)}
      />
    </View>
  );
}

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    // spacing.xxl between questions — the app's real rhythm (32 above a
    // section, 8 from a label to its control). At one even spacing.lg the
    // "What did you expect instead?" label sat exactly as far from the field it
    // labels as from the field above it, so nothing grouped; on step 2 it was
    // worse than that, because CardSelect's own cards sit 12 apart and a 16pt
    // heading below them read as belonging to the group it was introducing.
    body: {
      gap: spacing.xxl,
    },
    // A question and its control are ONE child of `body`, so the 32 above
    // separates questions and the 8 inside binds a label to what it labels.
    question: {
      gap: spacing.sm,
    },
    // ⚠️ `label`, NOT `heading`. At 18 Bold these sub-questions were louder
    // than the SelectField beside them on the same step AND only 2pt off the
    // 16 Bold titles of the CardSelect options inside them — simultaneously
    // shouting at their sibling and blurring into their own children. `label`
    // in secondary ink sits BELOW the SelectField rather than competing with
    // it, which is the claim that holds: it does NOT "match" that field's
    // label, whose resting state is `body` at 16 and whose floated state is
    // `caption` at 13 (SelectField.tsx). Nothing here makes three questions one
    // typographic grammar; this only stops one of them shouting.
    label: {
      ...typography.label,
      color: c.textSecondary,
    },
    // ⚠️ PRIMARY INK, NOT SECONDARY, and the extraction greyed it for one
    // commit. This sentence is the entire control over what a screenshot
    // contains — nothing in this codebase can redact the inside of a PNG — so
    // setting it as fine print is the same "most important thing dressed as the
    // least important" mistake the disclosure panel was rescued from.
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
    shotWrap: {
      width: sizes.screenshotThumb,
      aspectRatio: sizes.screenshotThumbAspect,
    },
    shot: {
      width: '100%',
      height: '100%',
      borderRadius: radii.lg,
      overflow: 'hidden',
      backgroundColor: c.surfaceSubtle,
    },
    shotImage: {
      width: '100%',
      height: '100%',
    },
    // Every other tappable surface in the flow answers a touch; these two were
    // the exception, including the add tile that is the step's only affordance.
    shotPressed: {
      opacity: opacity.pressed,
    },
    // `circleButtonSm` (28), whose own doc comment names "future photo-corner
    // buttons" — this is that button. At iconSm*2 (36) on an 88pt tile the
    // 44pt target covered the whole top-right quadrant of the picture, so a
    // quarter of the thing the user was told to inspect was a destructive
    // control painted over the preview.
    // ⚠️ A HAIRLINE EDGE, because this button no longer always sits on a photo.
    // `surfaceOverMedia` is the right fill ON media, which under `cover` it
    // always was — but a contained portrait screenshot puts the top-right
    // corner on the tile's own `surfaceSubtle` fill, and in dark that is
    // #222222 on #2A2A2A: 1.12:1. The one destructive control in a
    // privacy-sensitive flow disappeared. Same fix DESIGN_SYSTEM prescribes for
    // the onMedia PlateChip and the map pill — when the fill can match its
    // ground, the edge is what makes it a control.
    shotRemove: {
      position: 'absolute',
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: c.textOnMedia,
      // spacing.sm, matching the hitSlop above it — see the ⚠️ at the call
      // site. At spacing.xs the slop overhung the tile by 4 on two sides and
      // Android dropped those touches.
      top: spacing.sm,
      right: spacing.sm,
      width: sizes.circleButtonSm,
      height: sizes.circleButtonSm,
      borderRadius: sizes.circleButtonSm / 2,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: c.surfaceOverMedia,
    },
    // ⚠️ `borderStrong` AND A FILL, not a `border` hairline. In dark, `border`
    // is #333 on a #141414 page — 1.5:1, which the palette table labels
    // "decorative" — so with no screenshots attached this step was one sentence
    // and an invisible square, and the square is the step's only affordance.
    // Exactly the failure DESIGN_SYSTEM records for the map pill. Dashed and
    // filled, matching PhotoGridPicker's add tile.
    shotAdd: {
      width: sizes.screenshotThumb,
      aspectRatio: sizes.screenshotThumbAspect,
      borderRadius: radii.lg,
      borderWidth: 1,
      borderStyle: 'dashed',
      borderColor: c.borderStrong,
      backgroundColor: c.surfaceSubtle,
      alignItems: 'center',
      justifyContent: 'center',
    },
  });

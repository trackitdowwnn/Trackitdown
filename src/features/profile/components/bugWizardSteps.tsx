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
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';

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
  CardSelect,
  PhotoPreviewModal,
  SelectField,
  TextField,
  type PickedPhoto,
} from '@/shared/ui';
import type { WizardStepProps } from '@/shared/wizard';

import { BUG_REPORT_MAX_LENGTH } from '../api/bugReportApi';
import { MAX_BUG_SCREENSHOTS } from '../api/bugScreenshotUpload';
import { BUG_AREAS, BUG_FREQUENCIES, BUG_SEVERITIES } from '../lib/bugReportOptions';
import type { BugReportAnswers } from '../lib/bugReportAnswers';

/** Step 1 — the only required question, and the one they came to answer. */
export function BugWhatHappenedStep({ answers, setAnswers }: WizardStepProps<BugReportAnswers>) {
  const styles = useThemedStyles(makeStyles);

  return (
    <View style={styles.body}>
      <TextField
        label="Tell us what happened"
        variant="multiline"
        value={answers.message ?? ''}
        onChangeText={(message) => setAnswers({ message })}
        maxLength={BUG_REPORT_MAX_LENGTH}
        // ⚠️ A REQUEST, NOT A FILTER. There is no way to stop someone typing a
        // plate, and the honest response is to ask, keep the text out of the
        // logs, and hold it where only the operator can read it. Nothing in
        // this app moderates free text and this screen does not pretend to.
        helperText="Please don’t include a number plate or an address — we don’t need them to fix this."
        testID="report-bug-message"
      />

      {/* Second on the SAME step, not a screen of its own. "What did you
          expect?" is the same thought as "what happened" — separating them
          makes someone describe one incident twice, a screen apart. */}
      <Text style={styles.label} accessibilityRole="header">
        What did you expect instead?
      </Text>
      <TextField
        label="In your own words (optional)"
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
      <Text style={styles.label} accessibilityRole="header">
        How much did it get in your way?
      </Text>
      <CardSelect
        options={BUG_SEVERITIES}
        value={answers.severity ?? null}
        onSelect={(severity) => setAnswers({ severity })}
      />

      {/* Same rows, no icons and no descriptions — these three explain
          themselves in two words. Sharing CardSelect's anatomy keeps the two
          questions reading as siblings; a padded line of explanation each would
          be words for the sake of symmetry. */}
      <Text style={styles.label} accessibilityRole="header">
        How often does it happen?
      </Text>
      <CardSelect
        options={BUG_FREQUENCIES}
        value={answers.frequency ?? null}
        onSelect={(frequency) => setAnswers({ frequency })}
      />
    </View>
  );
}

/** Step 3 — screenshots, and the warning that is the only control there is. */
export function BugScreenshotsStep({ answers, setAnswers }: WizardStepProps<BugReportAnswers>) {
  const styles = useThemedStyles(makeStyles);
  const palette = usePalette();
  const [previewUri, setPreviewUri] = useState<string | null>(null);
  const shots = answers.shots ?? [];

  const addScreenshots = async () => {
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

    setAnswers({
      shots: [
        ...shots,
        ...result.assets.map((asset) => ({
          uri: asset.uri,
          width: asset.width,
          height: asset.height,
        })),
      ].slice(0, MAX_BUG_SCREENSHOTS) as PickedPhoto[],
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
              onPress={() => setAnswers({ shots: shots.filter((c) => c.uri !== shot.uri) })}
              accessibilityRole="button"
              accessibilityLabel={`Remove screenshot ${index + 1}`}
              hitSlop={(sizes.touchTarget - sizes.iconSm * 2) / 2}
              style={styles.shotRemove}
              testID="report-bug-shot-remove"
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
            style={styles.shotAdd}
            testID="report-bug-shot-add"
          >
            <Plus size={sizes.icon} color={palette.textSecondary} />
          </Pressable>
        ) : null}
      </View>

      <PhotoPreviewModal uri={previewUri} onClose={() => setPreviewUri(null)} />
    </View>
  );
}

const SHOT = sizes.touchTarget * 2;

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    body: {
      gap: spacing.lg,
    },
    label: {
      ...typography.heading,
      color: c.textPrimary,
    },
    warning: {
      ...typography.body,
      color: c.textSecondary,
    },
    shotRow: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: spacing.sm,
    },
    shotWrap: {
      width: SHOT,
      height: SHOT,
    },
    shot: {
      width: '100%',
      height: '100%',
      borderRadius: radii.md,
      overflow: 'hidden',
      backgroundColor: c.surfaceSubtle,
    },
    shotImage: {
      width: '100%',
      height: '100%',
    },
    shotRemove: {
      position: 'absolute',
      top: spacing.xs,
      right: spacing.xs,
      width: sizes.iconSm * 2,
      height: sizes.iconSm * 2,
      borderRadius: sizes.iconSm,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: c.surfaceOverMedia,
    },
    shotAdd: {
      width: SHOT,
      height: SHOT,
      borderRadius: radii.md,
      borderWidth: 1,
      borderColor: c.border,
      alignItems: 'center',
      justifyContent: 'center',
    },
  });

/**
 * WHAT:  The owner's sighting page's pinned bottom bar — the decision, by
 *        state:
 *        - not yet decided: "Is this your car?" with [Not my car] and
 *          [Yes, it's my car];
 *        - said not mine: "You said this isn't your car." with [Actually, it
 *          is] and [Message {name}];
 *        - confirmed / credited: [Message {name}].
 * WHY:   The decision is the reason the owner is here, and it used to be two
 *        quiet buttons at the very bottom of a long page ("Mark helpful",
 *        "Not my car"), under everything else (2026-10-08). Pinned, it never
 *        scrolls away, and it asks the actual question.
 *
 *        THE TWO ANSWERS ARE NOT EQUAL, and the bar says so in weight: "Yes"
 *        credits the spotter and CANNOT be undone (the screen confirms it
 *        first); "Not my car" moves nothing and can be taken back — which is
 *        what the "Actually, it is" state is. Both are about the CAR, never
 *        the person: they answered a description in good faith.
 *
 *        ⚠️ THE SPINNER GOES ON THE ANSWER THAT WAS GIVEN (review of #145):
 *        a shared "deciding" flag put it on "Yes" while "Not my car" was the
 *        one being sent — which read as the irreversible answer going out.
 *        At large text the pair stacks, primary first, rather than wrapping
 *        each label onto three lines in a bar that is always on screen.
 * LINKS: src/features/sightings/screens/SightingDetailScreen.tsx (owns the
 *          calls and the confirm); src/shared/ui/StickyActionBar.tsx.
 */

import { StyleSheet, Text, useWindowDimensions, View } from 'react-native';

import {
  listRowStackFontScale,
  spacing,
  typography,
  useThemedStyles,
  type Palette,
} from '@/shared/theme';
import { Button, StickyActionBar } from '@/shared/ui';

import type { OwnerSighting } from '../types';

export interface SightingDecisionBarProps {
  status: OwnerSighting['status'];
  spotterName: string;
  /** "Yes" — the screen confirms before it calls anything. */
  onYes: () => void;
  onNotMine: () => void;
  onMessage: () => void;
  /** Which answer is being sent, if any. */
  pending: 'yes' | 'not_mine' | null;
  messaging: boolean;
}

/** The decision, pinned — see the header. */
export function SightingDecisionBar({
  status,
  spotterName,
  onYes,
  onNotMine,
  onMessage,
  pending,
  messaging,
}: SightingDecisionBarProps) {
  const styles = useThemedStyles(makeStyles);
  const { fontScale } = useWindowDimensions();
  const stacked = (fontScale ?? 1) > listRowStackFontScale;
  const busy = pending !== null;

  if (status === 'unverified') {
    const yes = (
      <Button
        label="Yes, it’s my car"
        loading={pending === 'yes'}
        disabled={busy && pending !== 'yes'}
        onPress={onYes}
      />
    );
    const no = (
      <Button
        label="Not my car"
        variant="secondary"
        loading={pending === 'not_mine'}
        disabled={busy && pending !== 'not_mine'}
        onPress={onNotMine}
      />
    );
    return (
      <StickyActionBar testID="sighting-decision-bar">
        <Text style={styles.prompt} accessibilityRole="header">
          Is this your car?
        </Text>
        {stacked ? (
          <View style={styles.stack}>
            {yes}
            {no}
          </View>
        ) : (
          <View style={styles.pair}>
            <View style={styles.half}>{no}</View>
            <View style={styles.half}>{yes}</View>
          </View>
        )}
      </StickyActionBar>
    );
  }

  if (status === 'not_mine') {
    // Both secondary: after "not mine" there is nothing to push the owner
    // towards — the state stays calm.
    const change = (
      <Button
        label="Actually, it is"
        variant="secondary"
        loading={pending === 'yes'}
        disabled={messaging}
        onPress={onYes}
      />
    );
    const message = (
      <Button
        label={`Message ${spotterName}`}
        variant="secondary"
        loading={messaging}
        disabled={busy}
        onPress={onMessage}
      />
    );
    return (
      <StickyActionBar testID="sighting-decision-bar">
        <Text style={styles.prompt} accessibilityRole="header">
          You said this isn’t your car.
        </Text>
        {stacked ? (
          <View style={styles.stack}>
            {change}
            {message}
          </View>
        ) : (
          <View style={styles.pair}>
            <View style={styles.half}>{change}</View>
            <View style={styles.half}>{message}</View>
          </View>
        )}
      </StickyActionBar>
    );
  }

  return (
    <StickyActionBar testID="sighting-decision-bar">
      <Button label={`Message ${spotterName}`} loading={messaging} onPress={onMessage} />
    </StickyActionBar>
  );
}

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    prompt: {
      ...typography.cardTitle,
      color: c.textPrimary,
      marginBottom: spacing.md,
    },
    pair: {
      flexDirection: 'row',
      gap: spacing.md,
    },
    half: {
      flex: 1,
    },
    stack: {
      gap: spacing.md,
    },
  });

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
 * LINKS: src/features/sightings/screens/SightingDetailScreen.tsx (owns the
 *          calls and the confirm); src/shared/ui/StickyActionBar.tsx.
 */

import { StyleSheet, Text, View } from 'react-native';

import { spacing, typography, useThemedStyles, type Palette } from '@/shared/theme';
import { Button, StickyActionBar } from '@/shared/ui';

import type { OwnerSighting } from '../types';

export interface SightingDecisionBarProps {
  status: OwnerSighting['status'];
  spotterName: string;
  /** "Yes" — the screen confirms before it calls anything. */
  onYes: () => void;
  onNotMine: () => void;
  onMessage: () => void;
  deciding: boolean;
  messaging: boolean;
}

/** The decision, pinned — see the header. */
export function SightingDecisionBar({
  status,
  spotterName,
  onYes,
  onNotMine,
  onMessage,
  deciding,
  messaging,
}: SightingDecisionBarProps) {
  const styles = useThemedStyles(makeStyles);

  if (status === 'unverified') {
    return (
      <StickyActionBar testID="sighting-decision-bar">
        <Text style={styles.prompt} accessibilityRole="header">
          Is this your car?
        </Text>
        <View style={styles.pair}>
          <View style={styles.half}>
            <Button
              label="Not my car"
              variant="secondary"
              disabled={deciding}
              onPress={onNotMine}
            />
          </View>
          <View style={styles.half}>
            <Button label="Yes, it’s my car" loading={deciding} onPress={onYes} />
          </View>
        </View>
      </StickyActionBar>
    );
  }

  if (status === 'not_mine') {
    return (
      <StickyActionBar testID="sighting-decision-bar">
        <Text style={styles.prompt}>You said this isn’t your car.</Text>
        <View style={styles.pair}>
          <View style={styles.half}>
            <Button
              label="Actually, it is"
              variant="secondary"
              loading={deciding}
              onPress={onYes}
            />
          </View>
          <View style={styles.half}>
            <Button label={`Message ${spotterName}`} loading={messaging} onPress={onMessage} />
          </View>
        </View>
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
      marginBottom: spacing.sm,
    },
    pair: {
      flexDirection: 'row',
      gap: spacing.sm,
    },
    half: {
      flex: 1,
    },
  });

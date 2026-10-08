/**
 * WHAT:  ChooseCarStage — "Which car?": one row per saved car (square
 *        thumbnail, name, plate), tap = report that car; a final "It's a
 *        different car" row for a blank report. Or, when the garage failed to
 *        load, a retry with "Report a car from scratch" one tap away.
 *        Presentational: the host decides when it shows and what a tap does.
 * WHY:   Redesigned 2026-07-29 against Airbnb's listing-picker anatomy: when
 *        a host must choose one of their listings for an action, they get
 *        tap-to-advance ROWS, not the management surface's photo cards — the
 *        card treatment is for browsing what you own; a picker is a question.
 *        Ours is asked at the worst moment of someone's week, so: zero
 *        decoration, no buttons, no confirm step — the row IS the choice.
 *
 *        Since 2026-10-07 it is a STAGE of the report host rather than its own
 *        route: it used to navigate onward (a second full-screen transition
 *        after the first). Shown only when there ARE cars to offer — the host
 *        never draws "Which car?" for someone who may have none.
 * LINKS: src/features/garage/screens/StartReportScreen.tsx (the host);
 *        src/features/garage/components/GarageCard.tsx (the management-surface
 *          card this deliberately does NOT reuse).
 */

import { Car, ChevronRight } from 'lucide-react-native';
import { useCallback } from 'react';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';

import { radii, sizes, spacing, typography, usePalette, useThemedStyles, type Palette } from '@/shared/theme';
import { AppImage, Button, ErrorState, PlateChip, Screen, spellPlate } from '@/shared/ui';

import { vehicleDisplayName } from '../lib/vehicleAnswers';
import type { SavedVehicle } from '../types';
import { ReportHeader } from './ReportHeader';

/** Square picker thumbnail (the reference's ~56–64pt), radius md. */
const THUMB_SIZE = 64;

export type ChooseCarStageProps =
  | {
      mode: 'cars';
      vehicles: SavedVehicle[];
      onChoose: (vehicle: SavedVehicle) => void;
      onDifferent: () => void;
      onBack: () => void;
    }
  | {
      mode: 'error';
      onRetry: () => void;
      onDifferent: () => void;
      onBack: () => void;
    };

/** One car, one tap. The row is the choice — no buttons, no confirm. */
function ChooseCarRow({ vehicle, onPress }: { vehicle: SavedVehicle; onPress: () => void }) {
  const styles = useThemedStyles(makeStyles);
  const palette = usePalette();
  const cover = vehicle.photos[0]?.url;
  const name = vehicleDisplayName(vehicle);
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={
        // spellPlate: a reader must never attempt "AB12 CDE" as a word.
        `Report ${name}${vehicle.plate ? `, plate ${spellPlate(vehicle.plate)},` : ''} stolen`
      }
      style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
      testID={`choose-car-${vehicle.id}`}
    >
      {cover ? (
        <AppImage uri={cover} recyclingKey={vehicle.id} style={styles.thumb} />
      ) : (
        <View style={[styles.thumb, styles.thumbEmpty]}>
          <Car size={sizes.iconSm} color={palette.textSecondary} />
        </View>
      )}
      <View style={styles.rowBody}>
        <Text style={styles.rowName} numberOfLines={1}>
          {name}
        </Text>
        {vehicle.plate ? (
          <View style={styles.plateRow}>
            {/* The row's press, forwarded: the chip is the touch responder
                (long-press copies), so without this the plate would swallow
                the tap that reports this car — on the panic-moment path. */}
            <PlateChip plate={vehicle.plate} onPress={onPress} />
          </View>
        ) : null}
      </View>
      <ChevronRight size={sizes.icon} color={palette.textSecondary} />
    </Pressable>
  );
}

export function ChooseCarStage(props: ChooseCarStageProps) {
  const styles = useThemedStyles(makeStyles);
  const palette = usePalette();
  const { onDifferent, onBack } = props;
  const onChoose = props.mode === 'cars' ? props.onChoose : undefined;

  const renderRow = useCallback(
    ({ item }: { item: SavedVehicle }) => (
      <ChooseCarRow vehicle={item} onPress={() => onChoose?.(item)} />
    ),
    [onChoose],
  );

  return (
    <Screen>
      <ReportHeader title="Which car?" onBack={onBack} />

      {props.mode === 'error' ? (
        <View style={styles.stateBlock}>
          {/* A failed load must never block the report. Retry is offered, but
              carrying on from scratch is always one tap away. */}
          <ErrorState body="We couldn't load your cars." onRetry={props.onRetry} />
          <Button label="Report a car from scratch" variant="ghost" onPress={onDifferent} />
        </View>
      ) : (
        <FlatList
          data={props.vehicles}
          renderItem={renderRow}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.listContent}
          ListFooterComponent={
            // Always present, never buried: someone whose stolen car simply
            // isn't in the garage must not have to work out how to proceed.
            // The same row anatomy as the cars — it is the same kind of
            // answer, just without a saved car behind it.
            <Pressable
              onPress={onDifferent}
              accessibilityRole="button"
              accessibilityLabel="It's a different car — report from scratch"
              style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
              testID="choose-car-different"
            >
              <View style={[styles.thumb, styles.thumbEmpty]}>
                <Car size={sizes.iconSm} color={palette.textSecondary} />
              </View>
              <View style={styles.rowBody}>
                <Text style={styles.rowName}>It&apos;s a different car</Text>
                <Text style={styles.rowMeta}>Report from scratch</Text>
              </View>
              <ChevronRight size={sizes.icon} color={palette.textSecondary} />
            </Pressable>
          }
        />
      )}
    </Screen>
  );
}

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    stateBlock: {
      paddingHorizontal: spacing.xl,
      paddingTop: spacing.xl,
      gap: spacing.md,
    },
    listContent: {
      paddingHorizontal: spacing.xl,
      paddingVertical: spacing.md,
    },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.lg,
      paddingVertical: spacing.md,
      // Rounded press feedback without a border — rows separate by rhythm,
      // not rules (the app has no divider-line convention on lists).
      borderRadius: radii.md,
    },
    rowPressed: {
      backgroundColor: c.surfaceSubtle,
    },
    thumb: {
      width: THUMB_SIZE,
      height: THUMB_SIZE,
      borderRadius: radii.md,
      overflow: 'hidden',
    },
    thumbEmpty: {
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: c.surfaceSubtle,
    },
    rowBody: {
      flex: 1,
      gap: spacing.xs,
    },
    rowName: {
      ...typography.cardTitle,
      color: c.textPrimary,
    },
    rowMeta: {
      ...typography.caption,
      color: c.textSecondary,
    },
    plateRow: {
      flexDirection: 'row',
    },
  });

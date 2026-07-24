/**
 * WHAT:  DistinctiveFeaturesField — the post-a-car "distinctive marks" input: a
 *        vertical list of evidence cards (photo thumbnail + its description +
 *        edit/remove) with an "Add a feature" tile, plus a full-screen editor
 *        (pick a photo, write what it shows, Add/Save). Owners add 0–8.
 * WHY:   A photo + a description together let a spotter CONFIRM a car vs a
 *        lookalike — the words give the photo meaning, so the editor requires
 *        BOTH before it can add (isCompleteDraft). This is the OWNER's own car,
 *        so gallery upload is offered alongside the camera — the sightings
 *        camera-only evidence rule (docs/DOMAIN.md, ADR-0003) is a DIFFERENT
 *        context and deliberately does NOT apply here. The editor is a
 *        full-screen Modal (an opaque `fade` window — no transparent slide that
 *        would bleed the wizard through). Ordering/validation live in the pure
 *        distinctiveFeatures model; this file is the UI shell.
 * LINKS: src/features/vehicles/post/lib/distinctiveFeatures.ts (model + schema);
 *        src/features/vehicles/post/components/postSteps.tsx (DistinctiveMarksStep);
 *        src/shared/ui/{AppImage,TextField,Button}.tsx; docs/DESIGN_SYSTEM.md.
 */

import { Feather } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { useState } from 'react';
import { KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import Animated, { FadeIn, ReduceMotion } from 'react-native-reanimated';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

import { useAndroidKeyboardHeight } from '@/shared/hooks';
import { colors, motion, radii, sizes, spacing, typography } from '@/shared/theme';
import { AppImage, Button, TextField } from '@/shared/ui';
import type { PickedPhoto } from '@/shared/ui';

import {
  DESCRIPTION_MAX,
  DESCRIPTION_MIN,
  addFeature,
  canAddMore,
  isCompleteDraft,
  removeFeatureAt,
  updateFeatureAt,
  type DistinctiveFeature,
} from '../lib/distinctiveFeatures';

/** Evidence thumbnail + preview aspect — matches VehicleCard's photo ratio. */
const PHOTO_ASPECT = 4 / 3;

export interface DistinctiveFeaturesFieldProps {
  value: DistinctiveFeature[];
  onChange: (list: DistinctiveFeature[]) => void;
}

/** One added pair: thumbnail + description + edit/remove. */
function FeatureCard({
  feature,
  onEdit,
  onRemove,
}: {
  feature: DistinctiveFeature;
  onEdit: () => void;
  onRemove: () => void;
}) {
  return (
    <Animated.View
      style={styles.card}
      // Gentle fade as a card is added (or the list mounts); reduce-motion instant.
      entering={FadeIn.duration(motion.fast).reduceMotion(ReduceMotion.System)}
    >
      <AppImage
        uri={feature.photo.uri}
        style={styles.thumb}
        accessibilityLabel={`Photo: ${feature.description}`}
      />
      <Text style={styles.cardDesc} numberOfLines={2}>
        {feature.description}
      </Text>
      <View style={styles.cardActions}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Edit ${feature.description}`}
          hitSlop={spacing.sm}
          onPress={onEdit}
          style={({ pressed }) => [styles.iconButton, pressed && styles.iconButtonPressed]}
        >
          <Feather name="edit-2" size={sizes.iconSm} color={colors.textSecondary} />
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Remove ${feature.description}`}
          hitSlop={spacing.sm}
          onPress={onRemove}
          style={({ pressed }) => [styles.iconButton, pressed && styles.iconButtonPressed]}
        >
          <Feather name="trash-2" size={sizes.iconSm} color={colors.danger} />
        </Pressable>
      </View>
    </Animated.View>
  );
}

/** The dashed "Add a feature" tile (Airbnb add-pattern). */
function AddTile({ onPress }: { onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Add a feature"
      onPress={onPress}
      style={({ pressed }) => [styles.addTile, pressed && styles.addTilePressed]}
    >
      <Feather name="plus" size={sizes.iconSm} color={colors.primary} />
      <Text style={styles.addLabel}>Add a feature</Text>
    </Pressable>
  );
}

export function DistinctiveFeaturesField({ value, onChange }: DistinctiveFeaturesFieldProps) {
  const [editorOpen, setEditorOpen] = useState(false);
  // null = adding a new pair; a number = editing that index.
  const [editingIndex, setEditingIndex] = useState<number | null>(null);

  const openAdd = () => {
    setEditingIndex(null);
    setEditorOpen(true);
  };
  const openEdit = (index: number) => {
    setEditingIndex(index);
    setEditorOpen(true);
  };

  const handleSave = (feature: DistinctiveFeature) => {
    onChange(
      editingIndex == null
        ? addFeature(value, feature)
        : updateFeatureAt(value, editingIndex, feature),
    );
    setEditorOpen(false);
  };

  return (
    <View style={styles.stack}>
      {value.map((feature, index) => (
        <FeatureCard
          key={`${feature.photo.uri}-${index}`}
          feature={feature}
          onEdit={() => openEdit(index)}
          onRemove={() => onChange(removeFeatureAt(value, index))}
        />
      ))}
      {canAddMore(value) ? <AddTile onPress={openAdd} /> : null}

      <FeatureEditor
        visible={editorOpen}
        initial={editingIndex != null ? (value[editingIndex] ?? null) : null}
        onCancel={() => setEditorOpen(false)}
        onSave={handleSave}
      />
    </View>
  );
}

/** Full-screen add/edit editor: pick a photo, write what it shows, Add/Save. */
function FeatureEditor({
  visible,
  initial,
  onCancel,
  onSave,
}: {
  visible: boolean;
  initial: DistinctiveFeature | null;
  onCancel: () => void;
  onSave: (feature: DistinctiveFeature) => void;
}) {
  const insets = useSafeAreaInsets();
  const keyboardHeight = useAndroidKeyboardHeight();
  const [photo, setPhoto] = useState<PickedPhoto | null>(initial?.photo ?? null);
  const [description, setDescription] = useState(initial?.description ?? '');

  // Re-seed the draft each time the editor opens (adjust-state-on-prop-change,
  // no effect) so add starts blank and edit starts from the chosen pair.
  const [prevVisible, setPrevVisible] = useState(visible);
  if (visible !== prevVisible) {
    setPrevVisible(visible);
    if (visible) {
      setPhoto(initial?.photo ?? null);
      setDescription(initial?.description ?? '');
    }
  }

  const pickFromGallery = async () => {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsMultipleSelection: false,
      exif: false,
    });
    const asset = result.assets?.[0];
    if (result.canceled || !asset) {
      return;
    }
    setPhoto({ uri: asset.uri, width: asset.width, height: asset.height });
  };

  const takePhoto = async () => {
    const permission = await ImagePicker.requestCameraPermissionsAsync();
    if (!permission.granted) {
      return;
    }
    const result = await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], exif: false });
    const asset = result.assets?.[0];
    if (result.canceled || !asset) {
      return;
    }
    setPhoto({ uri: asset.uri, width: asset.width, height: asset.height });
  };

  const canSave = isCompleteDraft(photo, description);
  const isEdit = initial != null;

  return (
    <Modal
      visible={visible}
      // Opaque `fade` window: no transparent slide that would bleed the wizard
      // through during the transition.
      animationType="fade"
      onRequestClose={onCancel}
    >
      <SafeAreaView style={styles.editor} edges={['top', 'bottom']}>
        <KeyboardAvoidingView
          style={styles.flex}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
          <View style={styles.editorHeader}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Cancel"
              hitSlop={spacing.sm}
              onPress={onCancel}
              style={({ pressed }) => [styles.iconButton, pressed && styles.iconButtonPressed]}
            >
              <Feather name="x" size={sizes.icon} color={colors.textPrimary} />
            </Pressable>
            <Text accessibilityRole="header" style={styles.editorTitle}>
              {isEdit ? 'Edit feature' : 'Add a feature'}
            </Text>
            <View style={styles.iconButton} />
          </View>

          <ScrollView
            contentContainerStyle={styles.editorContent}
            keyboardShouldPersistTaps="handled"
          >
            {photo ? (
              <View style={styles.previewWrap}>
                <AppImage
                  uri={photo.uri}
                  style={styles.previewPhoto}
                  accessibilityLabel={
                    description.trim() ? `Photo: ${description.trim()}` : 'Selected photo'
                  }
                />
                <Button label="Change photo" variant="ghost" onPress={pickFromGallery} />
              </View>
            ) : (
              <View style={styles.pickRow}>
                <Button label="Choose photo" onPress={pickFromGallery} fullWidth={false} />
                <Button label="Take photo" variant="secondary" onPress={takePhoto} fullWidth={false} />
              </View>
            )}

            <TextField
              label="Description"
              variant="multiline"
              placeholder="What is this? e.g. ‘Scratch on rear bumper’"
              value={description}
              onChangeText={setDescription}
              maxLength={DESCRIPTION_MAX}
              helperText={`${DESCRIPTION_MIN}–${DESCRIPTION_MAX} characters — what a spotter would look for.`}
            />
          </ScrollView>

          <View style={[styles.editorFooter, { paddingBottom: insets.bottom + spacing.sm + keyboardHeight }]}>
            <Button
              label={isEdit ? 'Save' : 'Add'}
              onPress={() => photo && onSave({ photo, description })}
              disabled={!canSave}
            />
          </View>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  stack: {
    gap: spacing.lg,
  },
  // A form-field-family row (radii.md + hairline border, like TextField /
  // SelectField), deliberately NOT a floating shadow card — it reads as one of
  // the form's inputs inside the wizard step, not a standalone content card.
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.md,
    backgroundColor: colors.surface,
  },
  thumb: {
    width: sizes.avatarLg,
    height: sizes.avatarLg,
    borderRadius: radii.sm,
    backgroundColor: colors.surfaceSubtle,
  },
  cardDesc: {
    ...typography.body,
    color: colors.textPrimary,
    flex: 1,
  },
  cardActions: {
    flexDirection: 'row',
    gap: spacing.xs,
  },
  iconButton: {
    minWidth: sizes.touchTarget,
    minHeight: sizes.touchTarget,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radii.sm,
  },
  iconButtonPressed: {
    backgroundColor: colors.surfaceSubtle,
  },
  addTile: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    minHeight: sizes.control,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: colors.borderStrong,
    borderRadius: radii.md,
  },
  addTilePressed: {
    backgroundColor: colors.surfaceSubtle,
  },
  addLabel: {
    ...typography.label,
    color: colors.primary,
  },
  // --- Editor ---------------------------------------------------------------
  flex: {
    flex: 1,
  },
  editor: {
    flex: 1,
    backgroundColor: colors.background,
  },
  editorHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  editorTitle: {
    ...typography.heading,
    color: colors.textPrimary,
  },
  editorContent: {
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.md,
    paddingBottom: spacing.xl,
    gap: spacing.xl,
  },
  pickRow: {
    flexDirection: 'row',
    gap: spacing.md,
  },
  previewWrap: {
    gap: spacing.md,
  },
  previewPhoto: {
    width: '100%',
    aspectRatio: PHOTO_ASPECT,
    borderRadius: radii.md,
    backgroundColor: colors.surfaceSubtle,
  },
  editorFooter: {
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.sm,
  },
});

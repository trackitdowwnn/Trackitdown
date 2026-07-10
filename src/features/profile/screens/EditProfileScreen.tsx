/**
 * WHAT:  EditProfileScreen — change first name (required — it's what owners
 *        see next to sightings), display name, and avatar; inline button
 *        loading (not a blocking moment), success Toast, back on save.
 * WHY:   Plain state + zod (house pattern, no form library): two fields
 *        don't justify machinery. Avatar goes through expo-image-picker with
 *        square editing — a grid picker would be the wrong chrome for one
 *        photo — then profileApi resizes, uploads to the user's own storage
 *        folder, and cache-busts the URL. RLS means all writes only ever
 *        touch the user's own row.
 * LINKS: src/features/profile/api/profileApi.ts; docs/DESIGN_SYSTEM.md
 *        (Forms); supabase migration 20260710120000 (grants).
 */

import * as ImagePicker from 'expo-image-picker';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { z } from 'zod';

import { colors, spacing, typography } from '@/shared/theme';
import { Avatar, Button, EmptyState, TextField, useToast } from '@/shared/ui';

import { updateMyProfile, uploadAvatar } from '../api/profileApi';
import { useMyProfile } from '../hooks/useMyProfile';
import type { MyProfile } from '../types';

const editSchema = z.object({
  firstName: z.string().trim().min(1, 'First name is required — it’s what owners see.'),
  displayName: z.string().trim().min(1, 'Display name is required.'),
});

export function EditProfileScreen() {
  const state = useMyProfile();

  if (state.status === 'loading') {
    return <SafeAreaView style={styles.container} />;
  }
  if (state.status !== 'ready') {
    return (
      <SafeAreaView style={styles.container}>
        <EmptyState
          title="Sign in to edit your profile"
          body="Your profile becomes editable once you're signed in."
        />
      </SafeAreaView>
    );
  }
  return <EditForm profile={state.profile} onSaved={state.refresh} />;
}

function EditForm({ profile, onSaved }: { profile: MyProfile; onSaved: () => void }) {
  const router = useRouter();
  const toast = useToast();
  const [firstName, setFirstName] = useState(profile.firstName);
  const [displayName, setDisplayName] = useState(profile.displayName);
  const [pendingAvatarUri, setPendingAvatarUri] = useState<string | null>(null);
  const [errors, setErrors] = useState<{ firstName?: string; displayName?: string }>({});
  const [saving, setSaving] = useState(false);

  const pickAvatar = async () => {
    try {
      const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!permission.granted) {
        toast.show('Allow photo access in Settings to change your photo.', 'error');
        return;
      }
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        allowsEditing: true, // square crop — this becomes a circle everywhere
        aspect: [1, 1],
        quality: 1,
        exif: false,
      });
      if (!result.canceled && result.assets?.[0]) {
        setPendingAvatarUri(result.assets[0].uri);
      }
    } catch {
      toast.show("Couldn't open your photos — try again.", 'error');
    }
  };

  // The two writes are reported honestly: a name save that lands is never
  // called a failure just because the photo upload after it didn't.
  const save = async () => {
    const parsed = editSchema.safeParse({ firstName, displayName });
    if (!parsed.success) {
      const flat = z.flattenError(parsed.error).fieldErrors;
      setErrors({ firstName: flat.firstName?.[0], displayName: flat.displayName?.[0] });
      return;
    }
    setErrors({});
    setSaving(true);
    try {
      await updateMyProfile(profile.id, parsed.data);
    } catch {
      toast.show("Couldn't save — check your connection and try again.", 'error');
      setSaving(false);
      return;
    }
    if (pendingAvatarUri) {
      try {
        await uploadAvatar(profile.id, pendingAvatarUri);
      } catch {
        // Name saved, photo didn't: stay here (pendingAvatarUri kept) so a
        // retry only re-attempts the upload.
        onSaved();
        toast.show("Your name was saved, but the photo didn't upload — try again.", 'error');
        setSaving(false);
        return;
      }
    }
    onSaved();
    toast.show('Profile saved');
    setSaving(false);
    router.back();
  };

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        <Text style={styles.title}>Edit profile</Text>

        <Pressable
          style={styles.avatarRow}
          onPress={() => void pickAvatar()}
          accessibilityRole="button"
          accessibilityLabel="Change photo"
          testID="edit-avatar"
        >
          <Avatar uri={pendingAvatarUri ?? profile.avatarUrl} name={firstName} size="lg" />
          <Text style={styles.avatarHint}>Change photo</Text>
        </Pressable>

        <TextField
          label="First name"
          value={firstName}
          onChangeText={setFirstName}
          error={errors.firstName}
          autoCapitalize="words"
          testID="field-first-name"
        />
        <TextField
          label="Display name"
          value={displayName}
          onChangeText={setDisplayName}
          error={errors.displayName}
          autoCapitalize="words"
          testID="field-display-name"
        />

        <Button
          label={saving ? 'Saving…' : 'Save'}
          onPress={() => void save()}
          disabled={saving}
        />
        <Button label="Cancel" variant="ghost" onPress={() => router.back()} />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  scroll: {
    padding: spacing.xl,
    gap: spacing.lg,
  },
  title: {
    ...typography.title,
    color: colors.textPrimary,
  },
  avatarRow: {
    alignItems: 'center',
    gap: spacing.sm,
  },
  avatarHint: {
    ...typography.label,
    color: colors.primary,
  },
});

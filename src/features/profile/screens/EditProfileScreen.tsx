/**
 * WHAT:  EditProfileScreen — change first name (required — it's what owners
 *        see next to sightings), display name, and avatar (camera chip ON
 *        the photo, per the profile reference spec); inline button loading
 *        (not a blocking moment), success Toast, back on save.
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
import { useRef, useState } from 'react';
import { Linking, Pressable, ScrollView, StyleSheet, Text } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { z } from 'zod';

import { useRequireAuth } from '@/features/auth';
import { colors, spacing, typography } from '@/shared/theme';
import {
  BottomSheet,
  type BottomSheetRef,
  Button,
  EmptyState,
  PermissionPrimer,
  type PermissionPrimerContent,
  TextField,
  useToast,
} from '@/shared/ui';

import { updateMyProfile, uploadAvatar } from '../api/profileApi';
import { AvatarWithBadge } from '../components/AvatarWithBadge';
import { useMyProfile } from '../hooks/useMyProfile';
import type { MyProfile } from '../types';

const editSchema = z.object({
  firstName: z.string().trim().min(1, 'First name is required — it’s what owners see.'),
  displayName: z.string().trim().min(1, 'Display name is required.'),
});

/** Shown ONLY when photo access is OS-blocked (canAskAgain=false) — a
 *  first-time deny is respected silently, never nagged. Reassurance
 *  verified: the picker returns only the chosen image (exif: false). */
const AVATAR_PHOTOS_PRIMER: PermissionPrimerContent = {
  emoji: '🖼️',
  headline: 'Put a face to your name',
  body: 'Pick a photo from your library — only the photo you choose is used, nothing else.',
  allowLabel: 'Allow photo access',
  denied: {
    headline: 'Photo access is off',
    body: 'No problem — everything else here works without it. To change your photo, allow photo access in Settings and come back.',
    secondaryLabel: 'Not now',
  },
};

export function EditProfileScreen() {
  const state = useMyProfile();

  if (state.status === 'loading') {
    return <SafeAreaView style={styles.container} />;
  }
  if (state.status === 'error') {
    // A signed-in member whose fetch blipped: retry — a "Log in" here would be
    // a dead button (the gate sees a member and does nothing).
    return (
      <SafeAreaView style={styles.container}>
        <EmptyState
          title="Couldn't load your profile"
          body="Check your connection and try again."
          actionLabel="Try again"
          onAction={state.refresh}
        />
      </SafeAreaView>
    );
  }
  if (state.status === 'signedOut') {
    return <SignedOutEditState />;
  }
  return <EditForm profile={state.profile} onSaved={state.refresh} />;
}

function SignedOutEditState() {
  const requireAuth = useRequireAuth();
  return (
    <SafeAreaView style={styles.container}>
      <EmptyState
        title="Log in to edit your profile"
        body="Your profile becomes editable once you're logged in."
        actionLabel="Log in"
        // No continuation: on success this screen re-renders as the form.
        onAction={() => requireAuth({ context: 'edit_profile' })}
      />
    </SafeAreaView>
  );
}

function EditForm({ profile, onSaved }: { profile: MyProfile; onSaved: () => void }) {
  const router = useRouter();
  const toast = useToast();
  const [firstName, setFirstName] = useState(profile.firstName);
  const [displayName, setDisplayName] = useState(profile.displayName);
  const [pendingAvatarUri, setPendingAvatarUri] = useState<string | null>(null);
  const [errors, setErrors] = useState<{ firstName?: string; displayName?: string }>({});
  const [saving, setSaving] = useState(false);
  const photoAccessSheetRef = useRef<BottomSheetRef>(null);

  const pickAvatar = async () => {
    try {
      // Check BEFORE requesting: only an ALREADY-blocked state opens the
      // settings sheet. A fresh deny of the OS dialog is an answer given
      // seconds ago — respected silently, never re-prompted or scolded.
      // (On iOS a first-time deny comes back canAskAgain:false, so deciding
      // from the request's response would nag the instant they said no.)
      const existing = await ImagePicker.getMediaLibraryPermissionsAsync();
      if (!existing.granted && !existing.canAskAgain) {
        photoAccessSheetRef.current?.open();
        return;
      }
      const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!permission.granted) {
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
        <Text style={styles.title} accessibilityRole="header">
          Edit profile
        </Text>

        {/* The edit affordance rides ON the photo (reference §3): a camera
            chip, not a text hint — the label still says it for readers. */}
        <Pressable
          style={styles.avatarRow}
          onPress={() => void pickAvatar()}
          accessibilityRole="button"
          accessibilityLabel="Change photo"
          testID="edit-avatar"
        >
          <AvatarWithBadge
            uri={pendingAvatarUri ?? profile.avatarUrl}
            name={firstName}
            size="lg"
            badge="camera"
          />
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

      {/* Blocked photo access: acknowledging primer with the settings path —
          replaces the old dead-end toast. */}
      <BottomSheet ref={photoAccessSheetRef}>
        <PermissionPrimer
          content={AVATAR_PHOTOS_PRIMER}
          variant="denied"
          scroll={false}
          onPrimary={() => {
            photoAccessSheetRef.current?.close();
            Linking.openSettings().catch(() => {
              // Nothing useful to do — the sheet is already closed.
            });
          }}
          onSecondary={() => photoAccessSheetRef.current?.close()}
          testID="photo-access-denied-primer"
        />
      </BottomSheet>
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
  },
});

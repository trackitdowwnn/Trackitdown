/**
 * WHAT:  ProfileScreen — the Profile tab root: identity header, Reputation
 *        v1 card, settings hub, support & legal links, account actions
 *        (sign out, delete account), and a __DEV__-only tools section.
 * WHY:   One calm hub for everything about "me". Auth doesn't exist yet, so
 *        signed-out is a first-class state with a sign-in prompt and a
 *        __DEV__ sample-data preview so every section is reviewable on
 *        device today. Deletion is honest, never guilt-trippy: it explains
 *        the consequences, is blocked with a clear reason while any post has
 *        money in escrow (advisory client check — the delete-account Edge
 *        Function re-checks server-side), and degrades calmly while that
 *        function doesn't exist. The payouts row ships dark behind
 *        PAYOUTS_ENABLED until Phase 3. The dev section closes the
 *        LOGGING.md loop (copy ring buffer) and hosts the tab-bar badge
 *        toggles the old placeholder carried.
 * LINKS: src/features/profile/README.md; api/profileApi.ts;
 *        components/ReputationCard.tsx; config.ts; docs/DESIGN_SYSTEM.md;
 *        docs/SECURITY_AND_TRUST.md §3 (deletion).
 */

import * as Clipboard from 'expo-clipboard';
import { useFocusEffect, useRouter } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import {
  Banknote,
  Bell,
  ChevronRight,
  FileText,
  Info,
  LifeBuoy,
  LogOut,
  MapPin,
  Shield,
  Trash2,
} from 'lucide-react-native';
import { useCallback, useRef, useState } from 'react';
import { Linking, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { colors, sizes, spacing, typography } from '@/shared/theme';
import {
  Avatar,
  Button,
  ConfirmDialog,
  type ConfirmDialogRef,
  EmptyState,
  ListRow,
  useTabBadges,
  useToast,
} from '@/shared/ui';
import { formatRecentLogs } from '@/shared/lib/logger';

import {
  countDeletionBlockingPosts,
  requestAccountDeletion,
  signOut,
} from '../api/profileApi';
import { ReputationCard } from '../components/ReputationCard';
import { TrustedSpotterPill } from '../components/TrustedSpotterPill';
import { LEGAL_URLS, PAYOUTS_ENABLED, SUPPORT_EMAIL } from '../config';
import { useMyProfile } from '../hooks/useMyProfile';
import { DEV_MOCK_PROFILE } from '../lib/devMockProfile';
import { isTrustedSpotter, memberSinceLabel } from '../lib/reputation';
import type { MyProfile } from '../types';

export function ProfileScreen() {
  const state = useMyProfile();
  const [devPreview, setDevPreview] = useState(false);

  // Each useMyProfile instance has its own state, and this screen stays
  // mounted beneath pushed routes (edit-profile) — re-fetch on every
  // re-focus so a save over there is visible here. First focus is the
  // mount fetch; skip the duplicate.
  const firstFocus = useRef(true);
  const { refresh } = state;
  useFocusEffect(
    useCallback(() => {
      if (firstFocus.current) {
        firstFocus.current = false;
        return;
      }
      refresh();
    }, [refresh]),
  );

  if (state.status === 'loading') {
    return <SafeAreaView style={styles.container} edges={['top']} />;
  }

  if (state.status === 'error') {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <EmptyState
          title="Couldn't load your profile"
          body="Check your connection and try again."
          actionLabel="Try again"
          onAction={state.refresh}
        />
      </SafeAreaView>
    );
  }

  if (state.status === 'signedOut' && !devPreview) {
    return <SignedOutState onPreview={() => setDevPreview(true)} />;
  }

  const profile: MyProfile = state.status === 'ready' ? state.profile : DEV_MOCK_PROFILE;
  return <LoadedProfile profile={profile} devPreview={devPreview} />;
}

function SignedOutState({ onPreview }: { onPreview: () => void }) {
  const router = useRouter();
  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <EmptyState
        title="Your profile lives here"
        body="Sign in to see your reputation, settings, and account."
        actionLabel="Go to sign in"
        onAction={() => router.push('/auth')}
      />
      {__DEV__ ? (
        <View style={styles.devPreviewRow}>
          <Button
            label="Preview with sample data (dev)"
            variant="ghost"
            fullWidth={false}
            onPress={onPreview}
          />
        </View>
      ) : null}
    </SafeAreaView>
  );
}

function LoadedProfile({ profile, devPreview }: { profile: MyProfile; devPreview: boolean }) {
  const router = useRouter();
  const toast = useToast();
  const { badges, setBadge } = useTabBadges();
  const signOutRef = useRef<ConfirmDialogRef>(null);
  const deleteConfirmRef = useRef<ConfirmDialogRef>(null);
  const deleteBlockedRef = useRef<ConfirmDialogRef>(null);

  const handleSignOut = async () => {
    if (devPreview) {
      router.replace('/auth'); // sample data — nothing real to sign out of
      return;
    }
    try {
      await signOut();
      router.replace('/auth');
    } catch {
      toast.show("Couldn't sign out — try again.", 'error');
    }
  };

  const startDelete = async () => {
    if (devPreview) {
      toast.show('Sample data — deletion is disabled in preview.', 'error');
      return;
    }
    try {
      const blocking = await countDeletionBlockingPosts(profile.id);
      if (blocking > 0) {
        deleteBlockedRef.current?.open();
      } else {
        deleteConfirmRef.current?.open();
      }
    } catch {
      toast.show("Couldn't check your account right now — try again.", 'error');
    }
  };

  const confirmDelete = async () => {
    try {
      await requestAccountDeletion(); // also clears the local session
      router.replace('/auth');
    } catch {
      // The Edge Function is outlined but not built yet (see migration).
      toast.show('Account deletion is not available in this build yet.', 'error');
    }
  };

  const copyLogs = async () => {
    await Clipboard.setStringAsync(formatRecentLogs());
    toast.show('Recent logs copied');
  };

  const inboxBadge = typeof badges.inbox === 'number' ? badges.inbox : 0;
  const trusted = isTrustedSpotter(profile.counters);

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <ScrollView contentContainerStyle={styles.scroll}>
        <Pressable
          style={styles.header}
          onPress={() => router.push('/edit-profile')}
          accessibilityRole="button"
          accessibilityLabel={`${profile.firstName}${trusted ? ', trusted spotter' : ''}. Edit profile`}
          accessibilityHint="Change your name or photo"
          testID="profile-header"
        >
          <Avatar uri={profile.avatarUrl} name={profile.firstName} size="lg" />
          <View style={styles.identity}>
            <View style={styles.nameRow}>
              <Text style={styles.name}>{profile.firstName}</Text>
              {profile.displayName ? (
                <Text style={styles.displayName}>{profile.displayName}</Text>
              ) : null}
            </View>
            {trusted ? <TrustedSpotterPill /> : null}
            <Text style={styles.since}>{memberSinceLabel(profile.createdAt)}</Text>
          </View>
          <ChevronRight size={sizes.icon} color={colors.textSecondary} />
        </Pressable>

        <Section title="Reputation">
          <ReputationCard counters={profile.counters} createdAt={profile.createdAt} />
        </Section>

        {PAYOUTS_ENABLED ? (
          // TODO(payments): derive the value from stripe_connected_accounts
          // (none → "Set up payouts", payouts_enabled → "Payouts ready",
          // else "Action needed") and deep-link into the payments feature.
          <Section title="Payouts">
            <ListRow icon={Banknote} title="Payouts" value="Set up payouts" disabled />
          </Section>
        ) : null}

        <Section title="Settings">
          {/* Not `disabled` (which dims below readability): "Coming soon" is
              information to read, and a row without onPress is already inert. */}
          <ListRow
            icon={MapPin}
            title="Alert location & radius"
            value="Coming soon"
            testID="row-alert-radius"
          />
          <ListRow icon={Bell} title="Notifications" value="Coming soon" />
          <ListRow
            icon={Info}
            title="How Trackitdown works"
            onPress={() => router.push('/onboarding?revisit=1')}
            testID="row-how-it-works"
          />
        </Section>

        <Section title="Support & legal">
          <ListRow
            icon={Shield}
            title="Safety guidelines"
            onPress={() => void WebBrowser.openBrowserAsync(LEGAL_URLS.safetyGuidelines)}
          />
          <ListRow
            icon={FileText}
            title="Terms"
            onPress={() => void WebBrowser.openBrowserAsync(LEGAL_URLS.terms)}
          />
          <ListRow
            icon={FileText}
            title="Privacy policy"
            onPress={() => void WebBrowser.openBrowserAsync(LEGAL_URLS.privacyPolicy)}
          />
          <ListRow
            icon={LifeBuoy}
            title="Contact support"
            onPress={() => void Linking.openURL(`mailto:${SUPPORT_EMAIL}`)}
          />
        </Section>

        <Section title="Account">
          <ListRow
            icon={LogOut}
            title="Sign out"
            onPress={() => signOutRef.current?.open()}
            testID="row-sign-out"
          />
          <ListRow
            icon={Trash2}
            title="Delete account"
            destructive
            onPress={() => void startDelete()}
            testID="row-delete-account"
          />
        </Section>

        {__DEV__ ? (
          <Section title="Developer" testID="dev-section">
            <ListRow title="Copy recent logs" onPress={() => void copyLogs()} testID="row-copy-logs" />
            <ListRow title="Component sandbox" onPress={() => router.push('/sandbox')} />
            <ListRow
              title={`Inbox badge +1 (now ${inboxBadge})`}
              onPress={() => setBadge('inbox', inboxBadge + 1)}
            />
            <ListRow title="Clear inbox badge" onPress={() => setBadge('inbox', 0)} />
            <ListRow
              title={badges.myCars ? 'Clear My cars dot' : 'Show My cars dot'}
              onPress={() => setBadge('myCars', !badges.myCars)}
            />
          </Section>
        ) : null}
      </ScrollView>

      <ConfirmDialog
        ref={signOutRef}
        title="Sign out?"
        body="You can sign back in any time."
        confirmLabel="Sign out"
        onConfirm={() => void handleSignOut()}
      />
      <ConfirmDialog
        ref={deleteConfirmRef}
        title="Delete your account?"
        body="Your posts will be closed and your data deleted as described in our privacy policy. This can't be undone."
        confirmLabel="Delete account"
        destructive
        onConfirm={() => void confirmDelete()}
      />
      <ConfirmDialog
        ref={deleteBlockedRef}
        title="Can't delete just yet"
        body="You have a post with a bounty still held. Cancel the post or complete its recovery first — then you can delete your account."
        confirmLabel="Got it"
        acknowledge
        onConfirm={() => {}}
      />
    </SafeAreaView>
  );
}

function Section({
  title,
  children,
  testID,
}: {
  title: string;
  children: React.ReactNode;
  testID?: string;
}) {
  return (
    <View style={styles.section} testID={testID}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  scroll: {
    padding: spacing.xl,
    gap: spacing.xl,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.lg,
  },
  identity: {
    flex: 1,
    gap: spacing.xs,
  },
  nameRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: spacing.sm,
    flexWrap: 'wrap',
  },
  name: {
    ...typography.title,
    color: colors.textPrimary,
  },
  displayName: {
    ...typography.body,
    color: colors.textSecondary,
  },
  since: {
    ...typography.caption,
    color: colors.textSecondary,
  },
  section: {
    gap: spacing.xs,
  },
  sectionTitle: {
    ...typography.label,
    color: colors.textSecondary,
    paddingHorizontal: spacing.md,
  },
  devPreviewRow: {
    alignItems: 'center',
    paddingBottom: spacing.xl,
  },
});

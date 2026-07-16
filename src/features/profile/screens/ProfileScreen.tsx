/**
 * WHAT:  ProfileScreen — the Profile tab root, composed to the Airbnb profile
 *        reference (composition B): "Profile" title, the identity HERO card
 *        (avatar + trust badge + counters as a stat column, whole card →
 *        edit), a "Your spotter story" push row, settings groups with
 *        heading-scale titles and hairline dividers, then a quiet ungrouped
 *        bottom cluster — underlined "Log out", muted "Delete account", app
 *        version — and a __DEV__-only tools section.
 * WHY:   One calm hub for everything about "me"; the hero card is the one
 *        deliberately-elevated object on the page (docs/design-refs/profile/
 *        REFERENCE_SPEC.md). Guests browse freely (deferred auth), so
 *        signed-out is a first-class state: a friendly invitation through
 *        the auth gate — never a wall — plus a __DEV__ sample-data preview.
 *        Sign-out and deletion land back in guest mode in place (no auth
 *        screen exists to bounce to). Deletion stays findable-but-quiet on
 *        this root (App Store rule) rather than buried a level deep like the
 *        reference: honest, never guilt-trippy, blocked with a clear reason
 *        while any post has money in escrow (advisory client check — the
 *        delete-account Edge Function re-checks server-side), degrading
 *        calmly while that function doesn't exist. The payouts row ships
 *        dark behind PAYOUTS_ENABLED until Phase 3. The dev section closes
 *        the LOGGING.md loop and hosts the tab-bar badge toggles, kept in
 *        the old quiet-label style so it stays visually out of the way.
 * LINKS: src/features/profile/README.md; api/profileApi.ts;
 *        components/ProfileHeroCard.tsx; screens/SpotterStoryScreen.tsx;
 *        config.ts; docs/design-refs/profile/GAP_ANALYSIS.md;
 *        docs/SECURITY_AND_TRUST.md §3 (deletion).
 */

import * as Clipboard from 'expo-clipboard';
import Constants from 'expo-constants';
import { useFocusEffect, useRouter } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import {
  Banknote,
  Bell,
  FileText,
  Info,
  LifeBuoy,
  MapPin,
  Shield,
  Sparkles,
} from 'lucide-react-native';
import { Children, Fragment, useCallback, useRef, useState } from 'react';
import { Linking, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { colors, spacing, typography } from '@/shared/theme';
import {
  Button,
  ConfirmDialog,
  type ConfirmDialogRef,
  EmptyState,
  ListRow,
  useTabBadges,
  useToast,
} from '@/shared/ui';
import { formatRecentLogs } from '@/shared/lib/logger';
import { useRequireAuth } from '@/features/auth';

import {
  countDeletionBlockingPosts,
  requestAccountDeletion,
  signOut,
} from '../api/profileApi';
import { ProfileHeroCard } from '../components/ProfileHeroCard';
import { LEGAL_URLS } from '@/shared/lib';

import { PAYOUTS_ENABLED, SUPPORT_EMAIL } from '../config';
import { useMyProfile } from '../hooks/useMyProfile';
import { DEV_MOCK_PROFILE } from '../lib/devMockProfile';
import type { MyProfile } from '../types';

export function ProfileScreen() {
  const state = useMyProfile();
  const [devPreview, setDevPreview] = useState(false);

  // Saves elsewhere (EditProfile) already reach this screen via useMyProfile's
  // shared invalidation. This refocus refresh exists ONLY for data that moves
  // server-side while the user is elsewhere (reputation counters); the
  // stale-while-revalidate in useMyProfile keeps the refetch invisible.
  // First focus is the mount fetch; skip the duplicate.
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
  return (
    <LoadedProfile
      profile={profile}
      devPreview={devPreview}
      onExitPreview={() => setDevPreview(false)}
    />
  );
}

function SignedOutState({ onPreview }: { onPreview: () => void }) {
  const requireAuth = useRequireAuth();
  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <EmptyState
        title="Your profile lives here"
        body="Log in to see your reputation, settings, and account."
        actionLabel="Log in"
        // No continuation needed: the tab re-renders signed-in reactively.
        onAction={() => requireAuth({ context: 'tab_profile' })}
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

function LoadedProfile({
  profile,
  devPreview,
  onExitPreview,
}: {
  profile: MyProfile;
  devPreview: boolean;
  onExitPreview: () => void;
}) {
  const router = useRouter();
  const toast = useToast();
  const { badges, setBadge } = useTabBadges();
  const signOutRef = useRef<ConfirmDialogRef>(null);
  const deleteConfirmRef = useRef<ConfirmDialogRef>(null);
  const deleteBlockedRef = useRef<ConfirmDialogRef>(null);

  const handleSignOut = async () => {
    if (devPreview) {
      onExitPreview(); // sample data — nothing real to sign out of
      return;
    }
    try {
      await signOut();
      // Guest mode, in place: the session flip re-renders this tab as the
      // signed-out invitation — no auth wall to land on.
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
      // The session flip lands the user in guest mode on this tab.
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

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <ScrollView contentContainerStyle={styles.scroll}>
        <Text style={styles.screenTitle} accessibilityRole="header">
          Profile
        </Text>

        <ProfileHeroCard profile={profile} onPress={() => router.push('/edit-profile')} />

        {/* The narrative (highlights, badges, next goal) lives one push away —
            the root stays shallow, reference-style. */}
        <ListRow
          icon={Sparkles}
          title="Your spotter story"
          onPress={() => router.push('/spotter-story')}
          testID="row-spotter-story"
        />

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

        {/* The quiet ungrouped bottom cluster (reference §1d): sign-out as
            underlined text (underline = tappable), deletion beside it in the
            muted danger tone — on the ROOT per our App-Store rule, unlike
            the reference's one-level-deep burial — then the version line. */}
        <View style={styles.accountCluster}>
          <Pressable
            onPress={() => signOutRef.current?.open()}
            accessibilityRole="button"
            style={styles.textAction}
            testID="row-sign-out"
          >
            <Text style={styles.textActionLabel}>Log out</Text>
          </Pressable>
          <Pressable
            onPress={() => void startDelete()}
            accessibilityRole="button"
            style={styles.textAction}
            testID="row-delete-account"
          >
            <Text style={[styles.textActionLabel, styles.textActionDestructive]}>
              Delete account
            </Text>
          </Pressable>
          {Constants.expoConfig?.version ? (
            <Text style={styles.version} testID="app-version">
              Version {Constants.expoConfig.version}
            </Text>
          ) : null}
        </View>

        {__DEV__ ? (
          <Section title="Developer" quiet testID="dev-section">
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
        title="Log out?"
        body="You can log back in any time."
        confirmLabel="Log out"
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

/** A titled row group: heading-scale title + hairline dividers BETWEEN rows
 *  (reference §1c) — never above the first or below the last. `quiet` keeps
 *  the old small-grey-label look for the dev section, which must stay
 *  visually out of the way. */
function Section({
  title,
  children,
  quiet = false,
  testID,
}: {
  title: string;
  children: React.ReactNode;
  quiet?: boolean;
  testID?: string;
}) {
  const rows = Children.toArray(children); // toArray already drops null/false
  return (
    <View style={styles.section} testID={testID}>
      <Text style={quiet ? styles.sectionTitleQuiet : styles.sectionTitle}>{title}</Text>
      <View>
        {rows.map((row, index) => (
          <Fragment key={index}>
            {index > 0 && !quiet ? <View style={styles.divider} /> : null}
            {row}
          </Fragment>
        ))}
      </View>
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
  screenTitle: {
    ...typography.title,
    color: colors.textPrimary,
  },
  section: {
    gap: spacing.sm,
  },
  // Heading-scale ink titles carry the page rhythm (reference §1c); the dev
  // section keeps the old quiet label so it recedes.
  sectionTitle: {
    ...typography.heading,
    color: colors.textPrimary,
    paddingHorizontal: spacing.md,
  },
  sectionTitleQuiet: {
    ...typography.label,
    color: colors.textSecondary,
    paddingHorizontal: spacing.md,
  },
  divider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: colors.border,
    // Inset = ListRow's pressed-pill radius (radii.md = 12): the hairline
    // meets the flat edge of the pressed surfaceSubtle pill exactly. If
    // either token moves, revisit both together.
    marginHorizontal: spacing.md,
  },
  accountCluster: {
    gap: spacing.xs,
    paddingHorizontal: spacing.md,
  },
  // Text actions, not icon rows (reference §1d) — but still full 44pt+
  // touch targets via vertical padding.
  textAction: {
    alignSelf: 'flex-start',
    paddingVertical: spacing.md,
  },
  textActionLabel: {
    ...typography.body,
    color: colors.textPrimary,
    textDecorationLine: 'underline', // underline = tappable (DESIGN_SYSTEM)
  },
  textActionDestructive: {
    color: colors.danger,
  },
  version: {
    ...typography.caption,
    color: colors.textSecondary,
  },
  devPreviewRow: {
    alignItems: 'center',
    paddingBottom: spacing.xl,
  },
});

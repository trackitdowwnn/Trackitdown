/**
 * WHAT:  AlertsScreen — the list of a spotter's alerts: name, what it watches,
 *        a pause switch, edit and delete, plus the one-tap route into the
 *        creation wizard.
 * WHY:   Replaces the single-zone settings screen. Both Profile rows land
 *        here, because "Notifications" and "Alert areas" are one thing in a
 *        user's head.
 *
 *        The PER-USER concerns live here rather than on an alert: the OS
 *        permission primer and the notifications-off notice. An alert can't
 *        fix a phone-level block, and asking about it five times would be
 *        absurd — so the list owns it once, and stays honest that a saved
 *        alert won't fire while the OS is muting us.
 * LINKS: ../hooks/useMyAlerts.ts; ../api/alertsApi.ts; ../lib/alertName.ts
 *        (summariseAlert); ./AlertWizardScreen.tsx.
 */

import { useRouter } from 'expo-router';
import { useRef, useState } from 'react';
import { Linking, SafeAreaView, ScrollView, StyleSheet, Text, View } from 'react-native';

import { useDevicePermission } from '@/features/permissions';
import { createLogger } from '@/shared/lib/logger';
import {
  radii,
  spacing,
  typography,
  useThemedStyles,
  type Palette,
} from '@/shared/theme';
import {
  AppSwitch,
  Button,
  ConfirmDialog,
  type ConfirmDialogRef,
  EmptyState,
  ErrorState,
  FullscreenLoader,
  PermissionPrimer,
  type PermissionPrimerContent,
  ThemedRefreshControl,
  useToast,
} from '@/shared/ui';

import { deleteAlert, setAlertEnabled } from '../api/alertsApi';
import { invalidateMyAlerts, useMyAlerts } from '../hooks/useMyAlerts';
import { summariseAlert } from '../lib/alertName';
import { MAX_ALERTS_PER_DAY, MAX_ALERTS_PER_USER, type Alert } from '../types';

const log = createLogger('notifications');

const ALERTS_PRIMER: PermissionPrimerContent = {
  emoji: '🔔',
  headline: 'Know when a car goes missing near you',
  body: "We'll notify you when a car is reported stolen in an area you choose — a few a day at most. You can change or pause your alerts whenever you like.",
  allowLabel: 'Turn on alerts',
  secondaryLabel: 'Not now',
  denied: {
    headline: 'Alerts are switched off for Trackitdown',
    body: "Your phone is blocking notifications from us, so nothing can come through. You can turn them back on in Settings — your alerts are saved either way.",
    secondaryLabel: 'Not now',
  },
};

function AlertRow({
  alert,
  onEdit,
  onToggle,
  onDelete,
}: {
  alert: Alert;
  onEdit: () => void;
  onToggle: (enabled: boolean) => void;
  onDelete: () => void;
}) {
  const styles = useThemedStyles(makeStyles);

  return (
    <View style={styles.row} testID={`alert-row-${alert.id}`}>
      <View style={styles.rowMain}>
        <Text style={[styles.rowName, !alert.enabled && styles.rowNamePaused]} numberOfLines={1}>
          {alert.name}
        </Text>
        <Text style={styles.rowSummary} numberOfLines={2}>
          {summariseAlert(alert)}
        </Text>
        {!alert.enabled ? <Text style={styles.rowPaused}>Paused</Text> : null}
        <View style={styles.rowActions}>
          <Button label="Edit" variant="ghost" fullWidth={false} onPress={onEdit} />
          <Button label="Delete" variant="ghost" fullWidth={false} onPress={onDelete} />
        </View>
      </View>
      {/* Keeps its own label: here the switch IS the interactive element,
          unlike the two sites where a row wraps it. */}
      <AppSwitch
        accessibilityLabel={`${alert.name} alerts`}
        value={alert.enabled}
        onValueChange={onToggle}
      />
    </View>
  );
}

export function AlertsScreen() {
  const styles = useThemedStyles(makeStyles);
  const router = useRouter();
  const toast = useToast();
  const state = useMyAlerts();
  const permission = useDevicePermission('notifications');
  const confirmRef = useRef<ConfirmDialogRef>(null);
  const [pendingDelete, setPendingDelete] = useState<Alert | null>(null);

  const permissionState = permission.status?.state;
  const permissionBlocked = permissionState === 'denied' && permission.status?.canAskAgain === false;
  const permissionGranted = permissionState === 'granted';

  const handlePrimerPrimary = async () => {
    if (permissionBlocked) {
      await Linking.openSettings();
      return;
    }
    const next = await permission.request();
    log.info('push_permission', {
      state: next.state,
      canAskAgain: next.canAskAgain,
      surface: 'alerts_list',
    });
  };

  const toggle = async (alert: Alert, enabled: boolean) => {
    try {
      await setAlertEnabled(alert.id, enabled);
      invalidateMyAlerts();
    } catch {
      toast.show("Couldn't change that — try again.", 'error');
      invalidateMyAlerts(); // re-read the truth; the switch must not lie
    }
  };

  const confirmDelete = async () => {
    if (!pendingDelete) return;
    try {
      await deleteAlert(pendingDelete.id);
      invalidateMyAlerts();
      toast.show('Alert deleted');
    } catch {
      toast.show("Couldn't delete that — try again.", 'error');
    } finally {
      setPendingDelete(null);
    }
  };

  if (state.status === 'loading') {
    return <FullscreenLoader visible message="Loading your alerts" />;
  }
  if (state.status === 'error') {
    return (
      <SafeAreaView style={styles.container}>
        <ErrorState title="We couldn't load your alerts" onRetry={state.refresh} />
      </SafeAreaView>
    );
  }
  if (state.status === 'signedOut') {
    return (
      <SafeAreaView style={styles.container}>
        <EmptyState
          title="Set the areas you watch"
          body="Alerts are tied to your account, so we know where to send them."
        />
      </SafeAreaView>
    );
  }

  const { alerts, pull, refreshing } = state;
  const atCap = alerts.length >= MAX_ALERTS_PER_USER;

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView
        contentContainerStyle={styles.scroll}
        // Alerts change from OFF this screen — a push arrives, an area is
        // edited elsewhere, a paused alert resumes. The list is otherwise only
        // as fresh as the last invalidation, and there was no way to ask.
        //
        // `pull`, not `refresh`: the latter invalidates globally and its failure
        // path swaps the list for an error page. See the hook.
        refreshControl={<ThemedRefreshControl refreshing={refreshing} onRefresh={() => void pull()} />}
      >
        <Text style={styles.title} accessibilityRole="header">
          Alerts
        </Text>

        {/* The permission conversation sits above the list but never replaces
            it — you can manage alerts with notifications off, they just won't
            fire, and the notice below says exactly that. */}
        {permission.status && !permissionGranted ? (
          <View style={styles.primerFrame}>
            <PermissionPrimer
              content={ALERTS_PRIMER}
              variant={permissionBlocked ? 'denied' : 'ask'}
              scroll={false}
              announceAsHeader={false}
              onPrimary={() => void handlePrimerPrimary()}
              testID="alerts-permission-primer"
            />
          </View>
        ) : null}

        {permission.status && !permissionGranted && alerts.length > 0 ? (
          <Text style={styles.notice} testID="alerts-os-off-notice">
            Notifications are off for Trackitdown in your phone&apos;s settings, so these
            won&apos;t come through yet. They&apos;re saved for when you turn them back on.
          </Text>
        ) : null}

        {alerts.length === 0 ? (
          <EmptyState
            title="No alerts yet"
            body="Pick an area — and optionally a kind of car — and we'll tell you when something is reported stolen there."
            actionLabel="Create an alert"
            onAction={() => router.push('/alerts/new')}
          />
        ) : (
          <>
            {alerts.map((alert) => (
              <AlertRow
                key={alert.id}
                alert={alert}
                onEdit={() => router.push(`/alerts/${alert.id}`)}
                onToggle={(enabled) => void toggle(alert, enabled)}
                onDelete={() => {
                  setPendingDelete(alert);
                  confirmRef.current?.open();
                }}
              />
            ))}

            <Button
              label={atCap ? `Limit reached (${MAX_ALERTS_PER_USER})` : 'Create an alert'}
              onPress={() => router.push('/alerts/new')}
              disabled={atCap}
            />
            <Text style={styles.note}>
              {atCap
                ? `You can have up to ${MAX_ALERTS_PER_USER} alerts. Delete one to add another.`
                : `You'll get at most ${MAX_ALERTS_PER_DAY} alerts a day in total, however many you set up.`}
            </Text>
          </>
        )}
      </ScrollView>

      <ConfirmDialog
        ref={confirmRef}
        title="Delete this alert?"
        body="You'll stop getting notifications for it. Your other alerts are unaffected."
        confirmLabel="Delete"
        destructive
        onConfirm={() => void confirmDelete()}
        onDismiss={() => setPendingDelete(null)}
      />
    </SafeAreaView>
  );
}

const makeStyles = (c: Palette) => StyleSheet.create({
  container: { flex: 1, backgroundColor: c.background },
  scroll: { padding: spacing.xl, gap: spacing.lg },
  title: { ...typography.title, color: c.textPrimary },
  primerFrame: {
    backgroundColor: c.surface,
    borderRadius: radii.lg,
    padding: spacing.lg,
  },
  notice: {
    ...typography.caption,
    color: c.textPrimary,
    backgroundColor: c.surfaceSubtle,
    borderRadius: radii.md,
    padding: spacing.lg,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.md,
    backgroundColor: c.surface,
    borderRadius: radii.lg,
    padding: spacing.lg,
  },
  rowMain: { flex: 1, gap: spacing.xs },
  rowName: { ...typography.cardTitle, color: c.textPrimary },
  rowNamePaused: { color: c.textSecondary },
  rowSummary: { ...typography.caption, color: c.textSecondary },
  rowPaused: { ...typography.caption, color: c.textSecondary },
  rowActions: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.xs },
  note: { ...typography.caption, color: c.textSecondary },
});

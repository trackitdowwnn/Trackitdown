/**
 * WHAT:  The four pieces of device metadata a bug report carries, and their
 *        display labels. One function, so the screen and the payload cannot
 *        disagree about what is being sent.
 * WHY:   The report screen SHOWS this list before the user submits, and the
 *        privacy policy names the same four fields. That only stays true if
 *        there is one source — a screen that renders its own summary and an api
 *        module that builds its own payload will drift, and the drift would be
 *        us collecting something we told the user we were not.
 *
 *        ⚠️ THIS IS THE WHOLE OF THE AUTOMATIC DEVICE METADATA — and, since
 *        2026-08-24, NOT the whole of what a report carries. It used to be, and
 *        the sentence saying so had to be corrected the day the form grew:
 *        a report now also carries what the user chose (area, severity,
 *        frequency, what they expected, up to three screenshots) and one more
 *        automatic thing (an event-name breadcrumb trail, ../lib/
 *        bugBreadcrumbs.ts). If you are auditing what leaves the device, this
 *        file is one of three places to read, not the only one.
 *
 *        It is still deliberately not extensible by accident: adding a field
 *        here means adding it to the screen's visible list, the migration's
 *        columns, and the privacy policy's "What we collect". Anything that
 *        identifies a post, a sighting, a thread or a place does not belong in
 *        it at all — see the migration header for why log payloads and the
 *        current route are still refused.
 *
 *        `expo-device` was already a dependency and unused; nothing new is
 *        added for this. There is no build number because that needs
 *        expo-application, which is not a dependency and is not worth adding
 *        for one line of a support row.
 * LINKS: ../api/bugReportApi.ts (sends it);
 *        ../screens/ReportBugScreen.tsx (shows it);
 *        src/features/legal/lib/legalContent.ts (declares it);
 *        supabase/migrations/20260824100000_bug_reports.sql (stores it).
 */

import Constants from 'expo-constants';
import * as Device from 'expo-device';
import { Platform } from 'react-native';

/** The platform values the table's CHECK accepts. Mirrors `pushPlatform()`. */
export type BugReportPlatform = 'ios' | 'android';

export interface BugDiagnostics {
  appVersion: string | null;
  platform: BugReportPlatform | null;
  osVersion: string | null;
  deviceModel: string | null;
}

/**
 * Read the four fields. Every one is nullable and every one is allowed to be
 * null: a missing device model costs a little triage, and inventing a fallback
 * string would put a value in the operator's queue that no device ever had.
 */
export function readBugDiagnostics(): BugDiagnostics {
  return {
    appVersion: Constants.expoConfig?.version ?? null,
    platform: Platform.OS === 'ios' ? 'ios' : Platform.OS === 'android' ? 'android' : null,
    osVersion: Device.osVersion ?? null,
    deviceModel: Device.modelName ?? null,
  };
}

/** One label/value row, for the screen's "Sent with your report" list. */
export interface DiagnosticLine {
  label: string;
  value: string;
}

/**
 * The same four fields as human-readable lines.
 *
 * A field we could not read is simply absent rather than shown as "Unknown":
 * the list is a promise about what is being sent, so it must not list something
 * that is not.
 */
export function describeDiagnostics(diagnostics: BugDiagnostics): DiagnosticLine[] {
  const lines: DiagnosticLine[] = [];

  if (diagnostics.appVersion) {
    lines.push({ label: 'App version', value: diagnostics.appVersion });
  }

  // Model, platform and OS read as one fact about the handset
  // ("iPhone 14 · iOS 18.2"), and any part of it can be missing.
  //
  // ⚠️ THE PLATFORM ALWAYS APPEARS WHEN IT IS KNOWN, even with no OS version.
  // It is sent unconditionally, and folding it into the OS string meant that
  // on a handset whose osVersion would not read, the screen showed
  // "iPhone 14" while `p_platform: 'ios'` went to the server. A list that
  // can say LESS than the payload is the one thing this feature must not do,
  // and the first version of it did exactly that.
  const osLabel = diagnostics.platform === null
    ? null
    : diagnostics.platform === 'ios'
      ? 'iOS'
      : 'Android';

  // ⚠️ THE PARTS ARE BUILT INDEPENDENTLY. Writing this as
  // `osLabel && osVersion ? '<label> <version>' : osLabel` fixed the platform
  // case but recreated the same bug pointing the other way: with an unknown
  // platform and a READABLE osVersion — reachable on web, where Platform.OS is
  // neither ios nor android but expo-device still parses a version out of the
  // user agent — the whole branch collapsed to null and the version vanished
  // from the list while still travelling in the payload. Either half must be
  // able to appear without the other.
  const osPart = [osLabel, diagnostics.osVersion].filter(Boolean).join(' ') || null;

  const device = [diagnostics.deviceModel, osPart].filter(
    (part): part is string => Boolean(part),
  );

  if (device.length > 0) {
    lines.push({ label: 'Device', value: device.join(' · ') });
  }

  return lines;
}

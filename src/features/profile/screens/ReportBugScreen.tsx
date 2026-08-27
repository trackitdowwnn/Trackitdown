/**
 * WHAT:  "Report a bug" — three wizard steps (what happened, where and how bad,
 *        screenshots) then a review screen carrying the visible list of exactly
 *        what travels with the report. Pushed from Profile → Support & legal.
 * WHY:   There was no way to tell us something is broken. The only other
 *        support affordance is a mailto: to a placeholder address.
 *
 *        REBUILT AS A WIZARD 2026-08-27 (owner request), on the shared
 *        framework that already runs four flows. This screen is now only the
 *        HOST: it builds the flow, reads the diagnostics once, and owns the
 *        submit. Everything about chrome, gating, progress and review belongs
 *        to `shared/wizard`.
 *
 *        ⚠️ THE "SENT WITH YOUR REPORT" LIST IS THE DESIGN, not decoration, and
 *        it MOVED to the review screen rather than being dropped. It renders
 *        from the same readers the payload is built from, so the screen cannot
 *        claim less than it sends. Diagnostic data is a collection category this
 *        app did not previously have and the privacy policy names the same
 *        fields — a visible list is what makes that bullet honest. Every field
 *        ADDED to the payload must appear there in the same change, including
 *        the counts. See ../components/BugDisclosurePanel.tsx.
 *
 *        ⚠️ SCREENSHOTS. The warning above the picker is load-bearing, not
 *        garnish: no redaction helper can reach inside a PNG, so the ONLY
 *        controls are that the user chose the image, can tap it to see it full
 *        screen, was told in plain words what it might contain, and can remove
 *        it. Never add an automatic capture path — the whole justification
 *        collapses the moment the user did not choose the picture.
 *
 *        Still no log payloads and no route: the breadcrumb trail is event
 *        NAMES only, and "where in the app" is a closed vocabulary that cannot
 *        hold an id. See ../lib/bugBreadcrumbs.ts and ../lib/lastArea.ts.
 * LINKS: ../lib/bugReportFlow.tsx (the flow); ../api/bugReportApi.ts;
 *        ../api/bugScreenshotUpload.ts; ../lib/bugDiagnostics.ts;
 *        src/app/report-bug.tsx (the route); src/shared/wizard/README.md.
 */

import { useRouter } from 'expo-router';
import { useMemo } from 'react';

import { useSession } from '@/features/auth';
import { useToast } from '@/shared/ui';
import { WizardScreen } from '@/shared/wizard';

import { BugReportError, readBugReportQuota, submitBugReport } from '../api/bugReportApi';
import { uploadBugScreenshots } from '../api/bugScreenshotUpload';
import { readBreadcrumbs } from '../lib/bugBreadcrumbs';
import { describeDiagnostics, readBugDiagnostics } from '../lib/bugDiagnostics';
import type { BugReportAnswers } from '../lib/bugReportAnswers';
import { buildBugReportFlow } from '../lib/bugReportFlow';
import { readLastArea } from '../lib/lastArea';

export function ReportBugScreen() {
  const router = useRouter();
  const toast = useToast();
  const session = useSession();

  // Read once. Nothing here changes while the flow is open, and re-reading on
  // every keystroke would be work for no answer.
  const diagnostics = useMemo(() => readBugDiagnostics(), []);
  const lines = useMemo(() => describeDiagnostics(diagnostics), [diagnostics]);
  const flow = useMemo(() => buildBugReportFlow(lines), [lines]);

  const initialAnswers = useMemo<Partial<BugReportAnswers>>(
    () => ({
      message: '',
      expected: '',
      // Pre-filled from the last tab visited — a tab NAME, never a route.
      // Reading it here rather than in an effect means the picker is never
      // briefly empty and then filled, which reads as the app changing its mind.
      area: readLastArea(),
      severity: null,
      frequency: null,
      shots: [],
    }),
    [],
  );

  /**
   * ⚠️ THE BODY OF THIS IS UNCHANGED FROM THE SINGLE-SCREEN FORM. Only where it
   * is called from moved. The wizard controller runs it on the review screen's
   * final CTA, shows a spinner while it runs, and — critically — STAYS PUT with
   * the thrown message when it fails, which is the property the old screen had
   * to arrange by hand: losing what someone just wrote about a bug is its own
   * bug.
   */
  const handleComplete = async (answers: Partial<BugReportAnswers>) => {
    const message = answers.message?.trim() ?? '';

    // Advisory only — the RPC still enforces. Asked BEFORE uploading so a
    // rate-limited reporter is not made to wait for three images first.
    const remaining = await readBugReportQuota();
    if (remaining === 0) {
      throw new BugReportError(
        'You’ve sent a few reports already. Please try again in an hour.',
        'RATE_LIMITED',
      );
    }

    // ⚠️ NO SILENT DROP. Written first as
    // `shots.length > 0 && userId ? upload(...) : []`, which on a missing
    // session sent the report with NO screenshots while the panel still listed
    // them — the screen claiming MORE than the payload carried, which is the
    // same failure as claiming less and just as bad. A report is signed-in only
    // anyway; if the session is gone, say so.
    const userId = session.status === 'signedIn' ? session.userId : null;
    if (!userId) {
      throw new BugReportError('Please sign in to send a report.', 'NOT_AUTHENTICATED');
    }
    const screenshotPaths = await uploadBugScreenshots(userId, answers.shots ?? []);

    await submitBugReport(message, diagnostics, {
      area: answers.area ?? null,
      severity: answers.severity ?? null,
      frequency: answers.frequency ?? null,
      expected: answers.expected?.trim() ? answers.expected : null,
      breadcrumbs: readBreadcrumbs(),
      screenshotPaths,
    });

    toast.show('Thanks — we’ll take a look.');
    if (router.canGoBack()) {
      router.back();
    } else {
      router.replace('/(tabs)/profile');
    }
  };

  return (
    <WizardScreen
      flow={flow}
      initialAnswers={initialAnswers}
      onExit={() => {
        if (router.canGoBack()) {
          router.back();
        } else {
          router.replace('/(tabs)/profile');
        }
      }}
      onComplete={handleComplete}
    />
  );
}

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
import { createLogger } from '@/shared/lib/logger';
import { useToast } from '@/shared/ui';
import { WizardScreen } from '@/shared/wizard';

import {
  BUG_REPORT_FALLBACK_MESSAGE,
  BugReportError,
  readBugReportQuota,
  submitBugReport,
} from '../api/bugReportApi';
import { uploadBugScreenshots } from '../api/bugScreenshotUpload';
import { readBreadcrumbs } from '../lib/bugBreadcrumbs';
import { describeDiagnostics, readBugDiagnostics } from '../lib/bugDiagnostics';
import type { BugReportAnswers } from '../lib/bugReportAnswers';
import { buildBugReportFlow } from '../lib/bugReportFlow';
import { readLastArea } from '../lib/lastArea';

const log = createLogger('profile');

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
   * Everything that can refuse, in order. Kept separate from the success path
   * below so `handleComplete` can promise ONE thing about what it throws.
   *
   * ⚠️ THE ORDER IS THE DESIGN. Quota first, so a rate-limited reporter is not
   * made to upload three images before being told no; session next, so the
   * upload is never attempted without a folder to write to.
   */
  const sendReport = async (answers: Partial<BugReportAnswers>) => {
    // Advisory only — the RPC still enforces.
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

    await submitBugReport(answers.message?.trim() ?? '', diagnostics, {
      area: answers.area ?? null,
      severity: answers.severity ?? null,
      frequency: answers.frequency ?? null,
      expected: answers.expected?.trim() ? answers.expected : null,
      breadcrumbs: readBreadcrumbs(),
      screenshotPaths,
    });
  };

  /**
   * The wizard controller runs this on the review screen's final CTA, shows a
   * spinner while it runs, and — critically — STAYS PUT with the thrown message
   * when it fails, which is the property the old screen had to arrange by hand:
   * losing what someone just wrote about a bug is its own bug.
   *
   * ⚠️ ONLY A BugReportError MAY ESCAPE THE SEND, and moving the submit here is
   * exactly
   * what put that at risk. The old single screen owned the catch and rendered
   * `err instanceof BugReportError ? err.message : <generic>`; the controller
   * renders `err.message` for ANY Error. But `uploadBugScreenshots` is
   * documented to throw the RAW Supabase StorageError and `toJpegBytes` throws
   * raw too — so without this wrapper an RLS refusal reached the footer
   * verbatim as `new row violates row-level security policy for table
   * "objects"`. That is server error text in front of a user, which is the one
   * thing bugReportApi's own doctrine forbids (its `.message` is safe to show
   * BECAUSE it is a BugReportError, built for display).
   *
   * ⚠️ AND THE SUCCESS PATH NEEDS ITS OWN CATCH, which is the narrower version
   * of the same hole. Leaving the toast and the router bare did not protect
   * them — it exposed them: `advance` catches whatever escapes here, sets
   * `error` and holds the review screen, so a router that threw would tell
   * someone their report FAILED, in raw text, after the server had accepted it.
   * Once the RPC returns, the send is a fact and nothing downstream of it may
   * say otherwise.
   */
  const handleComplete = async (answers: Partial<BugReportAnswers>) => {
    try {
      await sendReport(answers);
    } catch (err) {
      if (err instanceof BugReportError) throw err;
      // ⚠️ LOGGED, OR THIS PATH IS INVISIBLE. Everything else that can refuse
      // records why: submitBugReport logs `bug_report_failed` with its reason
      // token, and uploadBugScreenshots logs `bug_screenshot_upload_failed`.
      // What reaches HERE is what neither of them caught — chiefly a network
      // call that THREW rather than returning an error — and it used to reach
      // the user as a sentence with no trace on the device at all, which made
      // "it just says try again" undiagnosable.
      //
      // The reason token only. Never err.message: the whole point of this catch
      // is that the text may be a raw Supabase error, and the logger's own rule
      // for this feature is a fixed token or nothing.
      log.error('bug_report_failed', { reason: 'SEND_THREW' });
      throw new BugReportError(BUG_REPORT_FALLBACK_MESSAGE, 'SEND_THREW');
    }

    try {
      toast.show('Thanks — we’ll take a look.');
      if (router.canGoBack()) {
        router.back();
      } else {
        router.replace('/(tabs)/profile');
      }
    } catch {
      // Swallowed on purpose: routing cannot un-send a sent report, and the
      // only thing throwing here could achieve is a false failure message.
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

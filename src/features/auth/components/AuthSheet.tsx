/**
 * WHAT:  AuthSheet — the app's ONE auth surface. A modal bottom sheet that
 *        opens when a gated action stores a pending intent, walks email →
 *        OTP → (new users) first name as internal steps, then resolves the
 *        intent so the original action continues without re-tapping.
 * WHY:   Deferred auth (Airbnb's pattern): the title says why it appeared
 *        ("Log in to report a sighting" — an invitation, never a wall), and
 *        dismissing is a graceful cancel that drops the intent with no nag.
 *        The intent resolves only when session AND profile row are confirmed
 *        (standing 'member'), so a continued action can rely on post-auth data
 *        like the profiles row. Mounted once in the root layout; driven
 *        entirely by the gateIntent store + auth standing — no props.
 * LINKS: gate/gateIntent.ts + gate/useRequireAuth.ts (what opens this);
 *        hooks/useAuthStanding.ts (the resolution signal); authApi;
 *        src/shared/ui/BottomSheet.tsx (host primitive); docs/LOGGING.md
 *        (gate_completed / gate_dismissed funnel events).
 */

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import {
  AccessibilityInfo,
  Animated,
  Easing,
  Keyboard,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useReducedMotion } from 'react-native-reanimated';

import { createLogger, isValidEmail } from '@/shared/lib';
import { motion, spacing, typography, useThemedStyles, type Palette } from '@/shared/theme';
import { BottomSheet, Button, TextField, type BottomSheetRef } from '@/shared/ui';

import {
  AuthActionError,
  createProfile,
  requestEmailOtp,
  isAppleWebSignInConfigured,
  isGoogleSignInConfigured,
  signInWithApple,
  signInWithAppleWeb,
  signInWithGoogle,
  verifyEmailOtp,
  type SocialResult,
} from '../api/authApi';
import {
  consumePendingIntent,
  GATE_TITLES,
  useLastGateContext,
  usePendingIntent,
} from '../gate/gateIntent';
import { invalidateProfileCheck, useAuthStanding } from '../hooks/useAuthStanding';
import { useCaptcha } from '../hooks/useCaptcha';
import { useResendCountdown } from '../hooks/useResendCountdown';
import { useSession } from '../hooks/useSession';
import { AppleComingSoonSheet } from './AppleComingSoonSheet';
import { AuthLegalNotice } from './AuthLegalNotice';
import { OtpInput } from './OtpInput';
import { SocialSignInButtons } from './SocialSignInButtons';

const log = createLogger('auth');

const GENERIC_ERROR = 'Something went wrong. Please try again.';
// GOV.UK's wording for a malformed address — with an example of a good one.
const INVALID_EMAIL = 'Enter an email address like name@example.com';
const RESEND_SECONDS = 60;
// Must match Supabase's `otp_length` (supabase/config.toml + the hosted
// dashboard). 6 digits since 2026-10-16 (was 8): NIST asks for at least 6, and
// no source recommends 8 (best-practice pass). The 15-minute expiry
// (`otp_expiry = 900`) is stated only in the email now — the sheet's
// spam/expiry hint was cut on 2026-10-16 (owner).
const CODE_LENGTH = 6;
// The shortest code Verify accepts — so a change of length on the server
// never strands anyone (the 8 → 6 switch, 2026-10-15).
const MIN_CODE_LENGTH = 6;
/** Said when a step comes in — a sheet that changes under a screen reader
 *  otherwise changes in silence. */
const STEP_ANNOUNCEMENTS: Partial<Record<Step, string>> = {
  otp: 'Enter the code we emailed you.',
  profile: 'What should we call you?',
};
/** The sheet's title once they're signed in — "Log in to …" would be stale. */
const WELCOME_TITLE = 'Welcome to Trackitdown';
/** Longest a completed gate waits for the sheet to report it has closed
 *  before running its action anyway. */
const CLOSE_FALLBACK_MS = 600;

type Step = 'email' | 'otp' | 'profile';
const STEP_ORDER: Record<Step, number> = { email: 0, otp: 1, profile: 2 };

export function AuthSheet() {
  const intent = usePendingIntent();
  const lastContext = useLastGateContext();
  const standing = useAuthStanding();
  const sheetRef = useRef<BottomSheetRef>(null);

  // Local step covers the guest flow (email ↔ otp). The profile step is
  // DERIVED, not set: whenever the signed-in user lacks a profiles row the
  // sheet shows it — which also lands an orphaned session there on open.
  const [step, setStep] = useState<Step>('email');
  const [email, setEmail] = useState('');
  // A new user who came through Google: their given name, so "What should
  // we call you?" starts filled in (2026-10-15) — still theirs to change.
  const [suggestedName, setSuggestedName] = useState('');
  const [appleComingSoon, setAppleComingSoon] = useState(false);
  const renderStep: Step = intent && standing === 'incomplete' ? 'profile' : step;

  const openRef = useRef(false); // sheet currently presented (or presenting)
  // The completed gate's action, held until the sheet has finished closing.
  const pendingActionRef = useRef<(() => void) | null>(null);
  const fallbackRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const runPendingAction = useCallback(() => {
    clearTimeout(fallbackRef.current);
    const action = pendingActionRef.current;
    pendingActionRef.current = null;
    action?.();
  }, []);
  // Only an unmount cancels a waiting fallback.
  useEffect(() => () => clearTimeout(fallbackRef.current), []);
  const stepRef = useRef<Step>('email'); // for the dismissal log's closure
  const sawProfileStepRef = useRef(false); // newUser flag for gate_completed

  useEffect(() => {
    stepRef.current = renderStep;
    if (renderStep === 'profile') sawProfileStepRef.current = true;
    // Tell a screen reader the sheet moved on (2026-10-15, UI best-practice
    // pass): focus otherwise stays where it was, on a control that's gone.
    const announcement = STEP_ANNOUNCEMENTS[renderStep];
    if (announcement) AccessibilityInfo.announceForAccessibility(announcement);
  }, [renderStep]);

  useEffect(() => {
    if (!intent) return;

    if (standing === 'member') {
      // Auth (and the profiles row) confirmed — finish what the user started.
      const done = consumePendingIntent(); // BEFORE close(): onDismiss must see no intent
      const wasOpen = openRef.current;
      openRef.current = false;
      if (done) {
        log.info('gate_completed', {
          context: done.context,
          newUser: sawProfileStepRef.current,
        });
      }
      if (!wasOpen) {
        // Never presented (the session resolved before it opened): nothing
        // to wait for.
        done?.run?.();
        return;
      }
      // ⚠️ RUN AFTER THE SHEET HAS CLOSED, not alongside (2026-10-07). The
      // action is usually a navigation — the report form sliding up — and
      // starting it in the same tick put three animations on screen at once:
      // the sheet closing, the OTP keyboard dropping, and the new screen
      // sliding in. handleDismiss runs it; a timer covers a close that never
      // reports back, and runPendingAction guarantees it runs once.
      pendingActionRef.current = done?.run ?? null;
      Keyboard.dismiss();
      sheetRef.current?.close();
      // A ref, not this effect's cleanup: consuming the intent re-runs this
      // effect at once, and a cleanup would cancel the fallback it just set.
      clearTimeout(fallbackRef.current);
      fallbackRef.current = setTimeout(runPendingAction, CLOSE_FALLBACK_MS);
      return;
    }
    if (standing === 'loading') return; // session restoring / profile check in flight

    if (!openRef.current) {
      openRef.current = true;
      sheetRef.current?.open();
    }
  }, [intent, standing, runPendingAction]);

  const handleDismiss = () => {
    openRef.current = false;
    // The signed-in path closed the sheet with an action waiting: now it runs.
    runPendingAction();
    // Reset for the next gate (an event handler, so plain setState is fine).
    setStep('email');
    setEmail('');
    setSuggestedName('');
    sawProfileStepRef.current = false;
    // Dismissal = cancel: drop the intent gracefully (no nagging). When the
    // close came from the resolve path the intent was already consumed and
    // this is a no-op.
    const dropped = consumePendingIntent();
    if (dropped) {
      log.info('gate_dismissed', { context: dropped.context, step: stepRef.current });
    }
  };

  return (
    <>
      <BottomSheet
        ref={sheetRef}
        title={
          renderStep === 'profile' ? WELCOME_TITLE : lastContext ? GATE_TITLES[lastContext] : ''
        }
        onDismiss={handleDismiss}
      >
        <StepSlide stepKey={renderStep} direction={STEP_ORDER[renderStep]}>
          {renderStep === 'email' ? (
            <EmailStep
              email={email}
              onChangeEmail={setEmail}
              onCodeSent={() => setStep('otp')}
              onSocialName={setSuggestedName}
              onAppleComingSoon={() => {
                Keyboard.dismiss();
                setAppleComingSoon(true);
              }}
            />
          ) : renderStep === 'otp' ? (
            <OtpStep email={email} onUseDifferentEmail={() => setStep('email')} />
          ) : (
            <ProfileStep initialFirstName={suggestedName} />
          )}
        </StepSlide>
      </BottomSheet>
      {/* Android's Apple button, before Apple is switched on (2026-10-15):
          a sheet over this one saying it's coming. Mounted only while open. */}
      {appleComingSoon ? (
        <AppleComingSoonSheet
          onClose={() => setAppleComingSoon(false)}
          googleAvailable={isGoogleSignInConfigured()}
        />
      ) : null}
    </>
  );
}

/** Slides each step in horizontally (forward from the right, back from the
 *  left); the sheet's dynamic sizing animates the height alongside. */
function StepSlide({
  stepKey,
  direction,
  children,
}: {
  stepKey: string;
  direction: number;
  children: ReactNode;
}) {
  const [translateX] = useState(() => new Animated.Value(0));
  const [opacity] = useState(() => new Animated.Value(1));
  const prevDirectionRef = useRef(direction);
  // Reduce Motion: a fade, no slide (2026-10-15).
  const reduceMotion = useReducedMotion();

  useEffect(() => {
    const forward = direction >= prevDirectionRef.current;
    prevDirectionRef.current = direction;
    translateX.setValue(reduceMotion ? 0 : forward ? spacing.xxl : -spacing.xxl);
    opacity.setValue(0);
    Animated.parallel([
      Animated.timing(translateX, {
        toValue: 0,
        duration: motion.fast,
        easing: Easing.out(Easing.quad),
        useNativeDriver: true,
      }),
      Animated.timing(opacity, {
        toValue: 1,
        duration: motion.fast,
        easing: Easing.out(Easing.quad),
        useNativeDriver: true,
      }),
    ]).start();
  }, [stepKey, direction, translateX, opacity, reduceMotion]);

  return (
    <Animated.View style={{ opacity, transform: [{ translateX }] }}>{children}</Animated.View>
  );
}

// --- Step 1: email ------------------------------------------------------------

function EmailStep({
  email,
  onChangeEmail,
  onCodeSent,
  onSocialName,
  onAppleComingSoon,
}: {
  email: string;
  onChangeEmail: (value: string) => void;
  onCodeSent: () => void;
  /** The provider's given name, for a new user's name step. */
  onSocialName: (name: string) => void;
  /** Android's Apple button before Apple sign-in is switched on. */
  onAppleComingSoon: () => void;
}) {
  const styles = useThemedStyles(makeStyles);
  const [busy, setBusy] = useState(false);
  // Two error slots on purpose: an email-path failure belongs ON the email
  // field; a social failure has nothing to do with that field, so it gets a
  // step-level line under the social buttons (a Google error painting the
  // email field red reads as "your email is wrong" — it isn't).
  const [emailError, setEmailError] = useState<string | null>(null);
  const [socialError, setSocialError] = useState<string | null>(null);
  // Audit lead 5: a fresh Turnstile token per code request (none while off).
  const captcha = useCaptcha();

  const handleContinue = async () => {
    setBusy(true);
    setEmailError(null);
    setSocialError(null);
    try {
      await requestEmailOtp(email, await captcha.getToken());
      onCodeSent();
    } catch (err) {
      setEmailError(err instanceof AuthActionError ? err.message : GENERIC_ERROR);
    } finally {
      setBusy(false);
    }
  };

  const handleSocial = async (signIn: () => Promise<SocialResult>) => {
    setBusy(true);
    setEmailError(null);
    setSocialError(null);
    try {
      // On success the session flips and AuthSheet resolves the intent; a
      // cancel is a no-op. Nothing to advance here.
      const result = await signIn();
      if (!result.cancelled && result.firstName?.trim()) {
        onSocialName(result.firstName.trim());
      }
    } catch (err) {
      setSocialError(err instanceof AuthActionError ? err.message : GENERIC_ERROR);
    } finally {
      setBusy(false);
    }
  };

  // ⚠️ SAY WHY, DON'T JUST GREY OUT (2026-10-15, GOV.UK). Continue used to
  // sit disabled until the address was valid, which told nobody what was
  // wrong. Now it is pressable once anything is typed, and a malformed
  // address says so — on leaving the field or on Continue, never mid-word.
  const checkEmail = (): boolean => {
    if (isValidEmail(email)) return true;
    setEmailError(INVALID_EMAIL);
    return false;
  };
  const submitEmail = () => {
    if (busy || !checkEmail()) return;
    void handleContinue();
  };
  const canContinue = email.trim().length > 0 && !busy;

  return (
    <View style={styles.step}>
      {/* THE NO-TYPING WAYS FIRST (owner, 2026-10-15): Apple and Google,
          then "or", then email. Each brand's rules ask its button to be at
          least as prominent as any other way in. */}
      <SocialSignInButtons
        dividerPosition="after"
        // iOS: Apple's native sheet. Android: Apple's web flow once it's
        // switched on — until then, the "coming soon" sheet (owner, 2026-10-15).
        onApple={() => {
          if (Platform.OS !== 'android') return void handleSocial(signInWithApple);
          if (isAppleWebSignInConfigured()) return void handleSocial(signInWithAppleWeb);
          onAppleComingSoon();
        }}
        onGoogle={() => handleSocial(signInWithGoogle)}
        disabled={busy}
        showGoogle={isGoogleSignInConfigured()}
        // Always on Android now: it signs in, or says it's coming.
        showAppleWeb={Platform.OS === 'android'}
      />
      {socialError ? (
        <Text style={styles.error} accessibilityLiveRegion="polite">
          {socialError}
        </Text>
      ) : null}
      <TextField
        label="Email"
        variant="email"
        textContentType="emailAddress"
        value={email}
        onChangeText={(value) => {
          onChangeEmail(value);
          if (emailError) setEmailError(null);
        }}
        onBlur={() => {
          if (email.trim()) checkEmail();
        }}
        onSubmitEditing={submitEmail}
        returnKeyType="go"
        error={emailError ?? undefined}
        disabled={busy}
      />
      {captcha.widget}
      <Button label="Continue" onPress={submitEmail} disabled={!canContinue} loading={busy} />
      {/* Below all actions: "By continuing…" covers the social buttons too. */}
      <AuthLegalNotice />
    </View>
  );
}

// --- Step 2: OTP ---------------------------------------------------------------

function OtpStep({
  email,
  onUseDifferentEmail,
}: {
  email: string;
  onUseDifferentEmail: () => void;
}) {
  const styles = useThemedStyles(makeStyles);
  const [code, setCode] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [errorNonce, setErrorNonce] = useState(0);
  const [errorText, setErrorText] = useState<string | null>(null);
  const [resending, setResending] = useState(false);
  // "New code sent to …" after a resend — the countdown restarting alone
  // said nothing (2026-10-15).
  const [resent, setResent] = useState(false);
  const { secondsLeft, canResend, restart } = useResendCountdown(RESEND_SECONDS);
  const captcha = useCaptcha();

  /** An error, said — the live region covers Android; iOS needs telling. */
  const showError = (message: string) => {
    setErrorText(message);
    if (Platform.OS === 'ios') AccessibilityInfo.announceForAccessibility(message);
  };

  const handleComplete = async (fullCode: string) => {
    if (submitting) return;
    setSubmitting(true);
    setErrorText(null);
    try {
      await verifyEmailOtp(email, fullCode);
      // Success: the session flips and AuthSheet advances (profile step or
      // resolve). Leave submitting on so the boxes stay busy until the move.
    } catch (err) {
      setCode('');
      setErrorNonce((n) => n + 1);
      showError(err instanceof AuthActionError ? err.message : GENERIC_ERROR);
      setSubmitting(false);
    }
  };

  const handleResend = async () => {
    // Guard the async window: canResend stays true during the request, so a
    // double-tap would fire two sends against the tight 2/hour budget.
    if (resending) return;
    setResending(true);
    setErrorText(null);
    setResent(false);
    try {
      await requestEmailOtp(email, await captcha.getToken());
      restart();
      setResent(true);
      AccessibilityInfo.announceForAccessibility(`New code sent to ${email.trim()}`);
    } catch (err) {
      showError(err instanceof AuthActionError ? err.message : GENERIC_ERROR);
    } finally {
      setResending(false);
    }
  };

  return (
    <View style={styles.step}>
      <Text style={styles.body}>
        Enter the code we emailed to <Text style={styles.emphasis}>{email.trim()}</Text>
      </Text>
      <Pressable onPress={onUseDifferentEmail} accessibilityRole="button" hitSlop={14}>
        <Text style={styles.link}>Use a different email</Text>
      </Pressable>

      <OtpInput
        value={code}
        // An error stays only until they start again (2026-10-15).
        onChangeText={(next) => {
          setCode(next);
          if (errorText) setErrorText(null);
        }}
        onComplete={(full) => void handleComplete(full)}
        length={CODE_LENGTH}
        submitting={submitting}
        errorNonce={errorNonce}
      />

      {errorText ? (
        <Text style={styles.error} accessibilityLiveRegion="polite">
          {errorText}
        </Text>
      ) : null}

      {/* ⚠️ A BUTTON AS WELL AS AUTO-SUBMIT (2026-10-15). Auto-submit with no
          button is WCAG failure F36, and a code SHORTER than the boxes (the
          8 → 6 switch on the server) would otherwise never submit at all. */}
      <Button
        label="Verify"
        onPress={() => void handleComplete(code)}
        disabled={code.length < MIN_CODE_LENGTH || submitting}
        loading={submitting}
      />

      {captcha.widget}
      <Pressable
        onPress={handleResend}
        disabled={!canResend || resending}
        accessibilityRole="button"
        accessibilityState={{ disabled: !canResend || resending }}
        hitSlop={14}
      >
        <Text style={[styles.link, (!canResend || resending) && styles.linkDisabled]}>
          {canResend ? 'Resend code' : `Resend code in ${secondsLeft}s`}
        </Text>
      </Pressable>
      {resent ? (
        <Text style={styles.hint} testID="otp-resent">
          New code sent to {email.trim()}.
        </Text>
      ) : null}
    </View>
  );
}

// --- Step 3: first name (new users) --------------------------------------------

function ProfileStep({ initialFirstName = '' }: { initialFirstName?: string }) {
  const styles = useThemedStyles(makeStyles);
  const session = useSession();
  const [firstName, setFirstName] = useState(initialFirstName);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async () => {
    if (session.status !== 'signedIn') return;
    setBusy(true);
    setError(null);
    try {
      await createProfile(session.userId, { firstName });
      // Standing re-checks, flips to 'member', and AuthSheet resolves the
      // pending intent. Leave busy on — the sheet closes from under us.
      invalidateProfileCheck();
    } catch (err) {
      setError(err instanceof AuthActionError ? err.message : GENERIC_ERROR);
      setBusy(false);
    }
  };

  const canSubmit = firstName.trim().length > 0 && !busy && session.status === 'signedIn';

  return (
    <View style={styles.step}>
      <Text style={styles.heading} accessibilityRole="header">
        What should we call you?
      </Text>
      <Text style={styles.body}>
        Your first name is what other people see. That’s all we need to get you started.
      </Text>
      <TextField
        label="First name"
        autoComplete="given-name"
        textContentType="givenName"
        // A name: a capital, the keyboard up, Done finishes (2026-10-15).
        autoCapitalize="words"
        autoFocus
        returnKeyType="done"
        onSubmitEditing={canSubmit ? handleSubmit : undefined}
        value={firstName}
        onChangeText={setFirstName}
        error={error ?? undefined}
      />
      <Button label="Get started" onPress={handleSubmit} disabled={!canSubmit} loading={busy} />
    </View>
  );
}

const makeStyles = (c: Palette) => StyleSheet.create({
  step: {
    gap: spacing.lg,
  },
  heading: {
    ...typography.heading,
    color: c.textPrimary,
  },
  body: {
    ...typography.body,
    color: c.textSecondary,
  },
  // Underlined so it reads as a tappable control in the monochrome scheme
  // (near-black link text no longer stands out by colour alone).
  link: {
    ...typography.label,
    color: c.primary,
    textDecorationLine: 'underline',
  },
  linkDisabled: {
    color: c.textSecondary,
  },
  error: {
    ...typography.caption,
    color: c.danger,
  },
  hint: {
    ...typography.caption,
    color: c.textSecondary,
  },
  // The address the code went to — what they'll look for in their inbox.
  emphasis: {
    fontFamily: typography.cardTitle.fontFamily,
    color: c.textPrimary,
  },
});

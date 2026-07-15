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

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Animated, Easing, Pressable, StyleSheet, Text, View } from 'react-native';

import { createLogger, isValidEmail } from '@/shared/lib';
import { colors, motion, spacing, typography } from '@/shared/theme';
import { BottomSheet, Button, TextField, type BottomSheetRef } from '@/shared/ui';

import {
  AuthActionError,
  createProfile,
  requestEmailOtp,
  signInWithApple,
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
import { useResendCountdown } from '../hooks/useResendCountdown';
import { useSession } from '../hooks/useSession';
import { AuthLegalNotice } from './AuthLegalNotice';
import { OtpInput } from './OtpInput';
import { SocialSignInButtons } from './SocialSignInButtons';

const log = createLogger('auth');

const GENERIC_ERROR = 'Something went wrong. Please try again.';
const RESEND_SECONDS = 60;

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
  const renderStep: Step = intent && standing === 'incomplete' ? 'profile' : step;

  const openRef = useRef(false); // sheet currently presented (or presenting)
  const stepRef = useRef<Step>('email'); // for the dismissal log's closure
  const sawProfileStepRef = useRef(false); // newUser flag for gate_completed

  useEffect(() => {
    stepRef.current = renderStep;
    if (renderStep === 'profile') sawProfileStepRef.current = true;
  }, [renderStep]);

  useEffect(() => {
    if (!intent) return;

    if (standing === 'member') {
      // Auth (and the profiles row) confirmed — finish what the user started.
      const done = consumePendingIntent(); // BEFORE close(): onDismiss must see no intent
      openRef.current = false;
      sheetRef.current?.close();
      if (done) {
        log.info('gate_completed', {
          context: done.context,
          newUser: sawProfileStepRef.current,
        });
        done.run?.();
      }
      return;
    }
    if (standing === 'loading') return; // session restoring / profile check in flight

    if (!openRef.current) {
      openRef.current = true;
      sheetRef.current?.open();
    }
  }, [intent, standing]);

  const handleDismiss = () => {
    openRef.current = false;
    // Reset for the next gate (an event handler, so plain setState is fine).
    setStep('email');
    setEmail('');
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
    <BottomSheet
      ref={sheetRef}
      title={lastContext ? GATE_TITLES[lastContext] : ''}
      onDismiss={handleDismiss}
    >
      <StepSlide stepKey={renderStep} direction={STEP_ORDER[renderStep]}>
        {renderStep === 'email' ? (
          <EmailStep
            email={email}
            onChangeEmail={setEmail}
            onCodeSent={() => setStep('otp')}
          />
        ) : renderStep === 'otp' ? (
          <OtpStep email={email} onUseDifferentEmail={() => setStep('email')} />
        ) : (
          <ProfileStep />
        )}
      </StepSlide>
    </BottomSheet>
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

  useEffect(() => {
    const forward = direction >= prevDirectionRef.current;
    prevDirectionRef.current = direction;
    translateX.setValue(forward ? spacing.xxl : -spacing.xxl);
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
  }, [stepKey, direction, translateX, opacity]);

  return (
    <Animated.View style={{ opacity, transform: [{ translateX }] }}>{children}</Animated.View>
  );
}

// --- Step 1: email ------------------------------------------------------------

function EmailStep({
  email,
  onChangeEmail,
  onCodeSent,
}: {
  email: string;
  onChangeEmail: (value: string) => void;
  onCodeSent: () => void;
}) {
  const [busy, setBusy] = useState(false);
  // Two error slots on purpose: an email-path failure belongs ON the email
  // field; a social failure has nothing to do with that field, so it gets a
  // step-level line under the social buttons (a Google error painting the
  // email field red reads as "your email is wrong" — it isn't).
  const [emailError, setEmailError] = useState<string | null>(null);
  const [socialError, setSocialError] = useState<string | null>(null);

  const handleContinue = async () => {
    setBusy(true);
    setEmailError(null);
    setSocialError(null);
    try {
      await requestEmailOtp(email);
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
      await signIn();
    } catch (err) {
      setSocialError(err instanceof AuthActionError ? err.message : GENERIC_ERROR);
    } finally {
      setBusy(false);
    }
  };

  const canContinue = isValidEmail(email) && !busy;

  return (
    <View style={styles.step}>
      <Text style={styles.body}>
        Sign up and log in are the same — we’ll email you an 8-digit code. No password needed.
      </Text>
      <TextField
        label="Email"
        variant="email"
        textContentType="emailAddress"
        value={email}
        onChangeText={onChangeEmail}
        onSubmitEditing={canContinue ? handleContinue : undefined}
        error={emailError ?? undefined}
      />
      <Button label="Continue" onPress={handleContinue} disabled={!canContinue} loading={busy} />
      <SocialSignInButtons
        onApple={() => handleSocial(signInWithApple)}
        onGoogle={() => handleSocial(signInWithGoogle)}
        disabled={busy}
      />
      {socialError ? (
        <Text style={styles.error} accessibilityLiveRegion="polite">
          {socialError}
        </Text>
      ) : null}
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
  const [code, setCode] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [errorNonce, setErrorNonce] = useState(0);
  const [errorText, setErrorText] = useState<string | null>(null);
  const [resending, setResending] = useState(false);
  const { secondsLeft, canResend, restart } = useResendCountdown(RESEND_SECONDS);

  const handleComplete = async (fullCode: string) => {
    setSubmitting(true);
    setErrorText(null);
    try {
      await verifyEmailOtp(email, fullCode);
      // Success: the session flips and AuthSheet advances (profile step or
      // resolve). Leave submitting on so the boxes stay busy until the move.
    } catch (err) {
      setCode('');
      setErrorNonce((n) => n + 1);
      setErrorText(err instanceof AuthActionError ? err.message : GENERIC_ERROR);
      setSubmitting(false);
    }
  };

  const handleResend = async () => {
    // Guard the async window: canResend stays true during the request, so a
    // double-tap would fire two sends against the tight 2/hour budget.
    if (resending) return;
    setResending(true);
    setErrorText(null);
    try {
      await requestEmailOtp(email);
      restart();
    } catch (err) {
      setErrorText(err instanceof AuthActionError ? err.message : GENERIC_ERROR);
    } finally {
      setResending(false);
    }
  };

  return (
    <View style={styles.step}>
      <Text style={styles.body}>Enter the code we emailed to {email}</Text>
      <Pressable onPress={onUseDifferentEmail} accessibilityRole="button" hitSlop={14}>
        <Text style={styles.link}>Use a different email</Text>
      </Pressable>

      <OtpInput
        value={code}
        onChangeText={setCode}
        onComplete={handleComplete}
        submitting={submitting}
        errorNonce={errorNonce}
      />

      {errorText ? (
        <Text style={styles.error} accessibilityLiveRegion="polite">
          {errorText}
        </Text>
      ) : null}

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
    </View>
  );
}

// --- Step 3: first name (new users) --------------------------------------------

function ProfileStep() {
  const session = useSession();
  const [firstName, setFirstName] = useState('');
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
      <Text style={styles.heading}>What should we call you?</Text>
      <Text style={styles.body}>
        Your first name is what other people see. That’s all we need to get you started.
      </Text>
      <TextField
        label="First name"
        autoComplete="given-name"
        value={firstName}
        onChangeText={setFirstName}
        error={error ?? undefined}
      />
      <Button label="Get started" onPress={handleSubmit} disabled={!canSubmit} loading={busy} />
    </View>
  );
}

const styles = StyleSheet.create({
  step: {
    gap: spacing.lg,
  },
  heading: {
    ...typography.heading,
    color: colors.textPrimary,
  },
  body: {
    ...typography.body,
    color: colors.textSecondary,
  },
  link: {
    ...typography.label,
    color: colors.primary,
  },
  linkDisabled: {
    color: colors.textSecondary,
  },
  error: {
    ...typography.caption,
    color: colors.danger,
  },
});

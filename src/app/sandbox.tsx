/**
 * WHAT:  Dev-only component sandbox — a live playground that renders the shared
 *        UI components (TextField, BottomSheet) in every variant and state.
 * WHY:   Lets us eyeball and interact with components in the real app (focus,
 *        error, disabled, plate uppercasing, sheet open/dismiss/keyboard)
 *        without wiring them into a feature yet. Add a new <Section> here
 *        whenever a shared component lands. Not a shipped screen — remove or
 *        gate before launch.
 * LINKS: src/shared/ui, src/shared/theme, docs/DESIGN_SYSTEM.md.
 */

import { type ReactNode, useRef, useState } from 'react';
import {
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { colors, radii, sizes, spacing, typography } from '@/shared/theme';
import { BottomSheet, TextField, type BottomSheetRef } from '@/shared/ui';

export default function SandboxScreen() {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [plate, setPlate] = useState('');
  const [notes, setNotes] = useState('');
  const [badEmail, setBadEmail] = useState('not an email');
  const [sheetName, setSheetName] = useState('');
  const [dismissCount, setDismissCount] = useState(0);

  const basicSheetRef = useRef<BottomSheetRef>(null);
  const tallSheetRef = useRef<BottomSheetRef>(null);
  const formSheetRef = useRef<BottomSheetRef>(null);

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
      >
        <Text style={styles.title}>Component sandbox</Text>
        <Text style={styles.subtitle}>A dev playground for shared UI components.</Text>

        <Section title="TextField · text">
          <TextField
            label="Full name"
            placeholder="Jane Smith"
            value={name}
            onChangeText={setName}
            helperText="As it appears on your documents"
          />
        </Section>

        <Section title="TextField · email">
          <TextField
            label="Email"
            variant="email"
            placeholder="you@example.com"
            value={email}
            onChangeText={setEmail}
          />
        </Section>

        <Section title="TextField · plate (auto-uppercases)">
          <TextField
            label="Number plate"
            variant="plate"
            placeholder="AB12 CDE"
            value={plate}
            onChangeText={setPlate}
            helperText={`Stored value: ${plate || '—'}`}
          />
        </Section>

        <Section title="TextField · multiline">
          <TextField
            label="Notes"
            variant="multiline"
            placeholder="Anything else we should know?"
            value={notes}
            onChangeText={setNotes}
          />
        </Section>

        <Section title="TextField · error state">
          <TextField
            label="Email"
            variant="email"
            value={badEmail}
            onChangeText={setBadEmail}
            error="Enter a valid email address"
          />
        </Section>

        <Section title="TextField · disabled">
          <TextField label="Reference" value="TID-000123" onChangeText={() => {}} disabled />
        </Section>

        <Section title="BottomSheet · basic">
          <SandboxButton label="Open basic sheet" onPress={() => basicSheetRef.current?.open()} />
          <Text style={styles.sectionNote}>
            Dismissed {dismissCount} {dismissCount === 1 ? 'time' : 'times'} (swipe down or tap
            the scrim)
          </Text>
        </Section>

        <Section title="BottomSheet · tall content (scrolls)">
          <SandboxButton label="Open tall sheet" onPress={() => tallSheetRef.current?.open()} />
        </Section>

        <Section title="BottomSheet · with TextField (keyboard)">
          <SandboxButton label="Open form sheet" onPress={() => formSheetRef.current?.open()} />
        </Section>
      </ScrollView>

      <BottomSheet
        ref={basicSheetRef}
        title="Basic sheet"
        onDismiss={() => setDismissCount((count) => count + 1)}
      >
        <Text style={styles.sheetBody}>
          A content-fit modal sheet. It sizes to this text, dims the screen behind it, and closes
          on swipe-down, scrim tap, or the button below.
        </Text>
        <SandboxButton label="Close" onPress={() => basicSheetRef.current?.close()} />
      </BottomSheet>

      <BottomSheet ref={tallSheetRef} title="Tall sheet">
        {Array.from({ length: 20 }, (_, index) => (
          <Text key={index} style={styles.sheetBody}>
            Paragraph {index + 1} — enough content to pass the height cap, so the sheet stops
            short of full screen and this body scrolls instead.
          </Text>
        ))}
      </BottomSheet>

      <BottomSheet ref={formSheetRef} title="Form sheet">
        <Text style={styles.sheetBody}>
          Tap the field — the sheet should rise with the keyboard so the input stays visible.
        </Text>
        <TextField
          label="Full name"
          placeholder="Jane Smith"
          value={sheetName}
          onChangeText={setSheetName}
        />
      </BottomSheet>
    </SafeAreaView>
  );
}

function SandboxButton({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={({ pressed }) => [styles.button, pressed && styles.buttonPressed]}
    >
      <Text style={styles.buttonLabel}>{label}</Text>
    </Pressable>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: colors.background,
  },
  content: {
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.xl,
    gap: spacing.xl,
  },
  title: {
    ...typography.title,
    color: colors.textPrimary,
  },
  subtitle: {
    ...typography.caption,
    color: colors.textSecondary,
    marginTop: -spacing.md,
  },
  section: {
    gap: spacing.sm,
  },
  sectionTitle: {
    ...typography.label,
    color: colors.textSecondary,
  },
  sectionNote: {
    ...typography.caption,
    color: colors.textSecondary,
  },
  sheetBody: {
    ...typography.body,
    color: colors.textPrimary,
    marginBottom: spacing.lg,
  },
  button: {
    height: sizes.control,
    borderRadius: radii.md,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonPressed: {
    backgroundColor: colors.primaryPressed,
  },
  buttonLabel: {
    ...typography.label,
    color: colors.surface,
  },
});

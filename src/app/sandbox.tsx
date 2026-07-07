/**
 * WHAT:  Dev-only component sandbox — a live playground that renders the shared
 *        UI components (currently TextField) in every variant and state.
 * WHY:   Lets us eyeball and interact with components in the real app (focus,
 *        error, disabled, plate uppercasing, multiline) without wiring them
 *        into a feature yet. Add a new <Section> here whenever a shared
 *        component lands. Not a shipped screen — remove or gate before launch.
 * LINKS: src/shared/ui, src/shared/theme, docs/DESIGN_SYSTEM.md.
 */

import { type ReactNode, useState } from 'react';
import { SafeAreaView, ScrollView, StyleSheet, Text, View } from 'react-native';

import { colors, spacing, typography } from '@/shared/theme';
import { TextField } from '@/shared/ui';

export default function SandboxScreen() {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [plate, setPlate] = useState('');
  const [notes, setNotes] = useState('');
  const [badEmail, setBadEmail] = useState('not an email');

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
      </ScrollView>
    </SafeAreaView>
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
});

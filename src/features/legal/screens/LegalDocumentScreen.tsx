/**
 * WHAT:  LegalDocumentScreen — renders one of the three legal documents
 *        (safety / terms / privacy) from legalContent.ts.
 * WHY:   These links previously opened `trackitdown.example` URLs, a reserved
 *        placeholder TLD that resolves to nothing — so every "Terms" and
 *        "Privacy policy" tap in the app, including the one on the sign-in
 *        consent line, opened a browser error. Rendering in-app makes them
 *        work with no domain, no hosting, and no version skew between the app
 *        and the terms it claims you agreed to.
 *
 *        A public URL is still needed for the store listings (both stores
 *        demand one) — that is the same content published to the web when a
 *        domain exists, not a different document.
 *
 *        Follows PostAboutScreen's shape: headers are hidden app-wide, so a
 *        pushed page carries its own back control.
 * LINKS: src/app/legal/[doc].tsx (route); ../lib/legalContent.ts (the text);
 *        src/shared/lib/legal.ts (the link targets);
 *        src/features/profile/screens/ProfileScreen.tsx + auth's
 *        AuthLegalNotice.tsx (the two consumers).
 */

import { useRouter } from 'expo-router';
import { ChevronLeft } from 'lucide-react-native';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import {
  sizes,
  spacing,
  typography,
  usePalette,
  useThemedStyles,
  type Palette,
} from '@/shared/theme';
import { EmptyState, Screen } from '@/shared/ui';

import { legalDocument } from '../lib/legalContent';

export interface LegalDocumentScreenProps {
  /** Route param; unknown values render the not-found state rather than crash. */
  slug: string;
}

export function LegalDocumentScreen({ slug }: LegalDocumentScreenProps) {
  const styles = useThemedStyles(makeStyles);
  const doc = legalDocument(slug);

  return (
    <Screen scroll contentContainerStyle={styles.scroll}>
      <View style={styles.headerRow}>
        <BackButton />
        <Text style={styles.title} accessibilityRole="header">
          {doc?.title ?? 'Not found'}
        </Text>
      </View>

      {!doc ? (
        <EmptyState
          title="We couldn't find that page"
          body="The link may be out of date."
        />
      ) : (
        <>
          <Text style={styles.updated}>Last updated {doc.lastUpdated}</Text>

          {doc.intro.map((paragraph) => (
            <Text key={paragraph} style={styles.lede}>
              {paragraph}
            </Text>
          ))}

          {doc.sections.map((section) => (
            <View key={section.heading} style={styles.section}>
              <Text style={styles.subhead} accessibilityRole="header">
                {section.heading}
              </Text>
              {section.body.map((paragraph) => (
                <Text
                  key={paragraph}
                  // A leading "• " is authored into the copy; indent those so a
                  // wrapped bullet lines up under its own text, not the dot.
                  style={paragraph.startsWith('• ') ? styles.bullet : styles.prose}
                >
                  {paragraph}
                </Text>
              ))}
            </View>
          ))}
        </>
      )}
    </Screen>
  );
}

function BackButton() {
  const styles = useThemedStyles(makeStyles);
  const palette = usePalette();
  const router = useRouter();
  return (
    <Pressable
      onPress={() => router.back()}
      accessibilityRole="button"
      accessibilityLabel="Back"
      style={styles.back}
      testID="legal-back"
    >
      <ChevronLeft size={sizes.icon} color={palette.textPrimary} />
    </Pressable>
  );
}

const makeStyles = (c: Palette) => StyleSheet.create({
  scroll: {
    padding: spacing.xl,
    gap: spacing.lg,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  back: {
    width: sizes.touchTarget,
    height: sizes.touchTarget,
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: -(sizes.touchTarget - sizes.icon) / 2,
  },
  title: {
    ...typography.title,
    color: c.textPrimary,
    flexShrink: 1,
  },
  updated: {
    ...typography.caption,
    color: c.textSecondary,
    marginTop: -spacing.sm,
  },
  lede: {
    ...typography.body,
    color: c.textPrimary,
  },
  section: {
    gap: spacing.sm,
  },
  subhead: {
    ...typography.heading,
    color: c.textPrimary,
  },
  prose: {
    ...typography.body,
    color: c.textPrimary,
  },
  bullet: {
    ...typography.body,
    color: c.textPrimary,
    paddingLeft: spacing.md,
  },
});

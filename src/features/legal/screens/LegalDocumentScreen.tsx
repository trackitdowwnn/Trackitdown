/**
 * WHAT:  LegalDocumentScreen — renders one of the three legal documents
 *        (safety / terms / privacy) from legalContent.ts, with a contents
 *        index, a sticky current-section label and a reading-progress bar.
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
 *        AIRBNB PASS 2026-08-26. The direct analogue is weak and was called
 *        weak: their Terms and Privacy pages are conventional web policy
 *        documents, among the least designed surfaces they own. What was
 *        borrowed is their HELP-CENTRE ARTICLE treatment — generous measure,
 *        section hierarchy that is unmistakably stronger than paragraph
 *        hierarchy, and a way to navigate a long document — plus the general
 *        design language (4pt grid, one elevation tier, white-on-white
 *        separation rather than borders). The typeface did NOT change: Satoshi
 *        stays, and the reading problem was leading and rhythm, not family.
 *
 *        ⚠️ OWN ScrollView, NOT `Screen scroll`. Three things here need the
 *        scroll: the progress bar reads its offset, the sticky label reads it
 *        to know which section is in view, and the index writes it to jump.
 *        `Screen` exposes neither a ref nor onScroll, and widening a component
 *        shared by every screen in the app for one page's benefit is the wrong
 *        trade — so this renders a plain `Screen` and owns the scroller.
 * LINKS: src/app/legal/[doc].tsx (route); ../lib/legalContent.ts (the text);
 *        ../components/DocumentIndex.tsx; src/shared/lib/legal.ts (link
 *        targets); ProfileScreen + auth's AuthLegalNotice (the two consumers).
 */

import { useRouter } from 'expo-router';
import { ChevronLeft } from 'lucide-react-native';
import { useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import Animated, {
  useAnimatedScrollHandler,
  useAnimatedStyle,
  useSharedValue,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import {
  sizes,
  spacing,
  typography,
  usePalette,
  useThemedStyles,
  type Palette,
} from '@/shared/theme';
import { EmptyState, Screen } from '@/shared/ui';

import { DocumentIndex } from '../components/DocumentIndex';
import { legalDocument } from '../lib/legalContent';

/** How far the progress bar sits from nothing — a hairline is invisible. */
const PROGRESS_HEIGHT = 3;

export interface LegalDocumentScreenProps {
  /** Route param; unknown values render the not-found state rather than crash. */
  slug: string;
}

export function LegalDocumentScreen({ slug }: LegalDocumentScreenProps) {
  const styles = useThemedStyles(makeStyles);
  const insets = useSafeAreaInsets();
  const doc = legalDocument(slug);

  const scrollRef = useRef<ScrollView>(null);
  // Section tops, keyed by index, filled by each section's onLayout. A plain
  // ref rather than state: writing it must not re-render, and it is only ever
  // read inside a press handler.
  const sectionTops = useRef<Record<number, number>>({});

  const scrollY = useSharedValue(0);
  const progress = useSharedValue(0);
  // ⚠️ THE CURRENT SECTION IS REACT STATE, NOT A SHARED VALUE, because it
  // drives TEXT. A shared value can drive a style on the UI thread without a
  // render, but the label's content has to come from JS either way, so the
  // saving would be imaginary — and the setter is guarded to fire only when
  // the index actually changes, so it is one render per section boundary
  // crossed, not one per frame.
  const [currentSection, setCurrentSection] = useState<number | null>(null);

  const onScroll = useAnimatedScrollHandler({
    onScroll: (event) => {
      scrollY.value = event.contentOffset.y;
      const scrollable = event.contentSize.height - event.layoutMeasurement.height;
      // Guard the divide: a document shorter than the screen has nothing to
      // progress through, and 0/0 renders the bar full on a page you have not
      // read.
      progress.value = scrollable > 0 ? Math.min(1, Math.max(0, event.contentOffset.y / scrollable)) : 0;
    },
  });

  const progressStyle = useAnimatedStyle(() => ({
    transform: [{ scaleX: progress.value }],
  }));

  // Which section the reader is in, from the tops recorded at layout. Called
  // from onScroll's JS side rather than the worklet: it touches a ref and
  // setState, neither of which belongs on the UI thread.
  const updateCurrentSection = (offsetY: number) => {
    const tops = sectionTops.current;
    let next: number | null = null;
    for (const [key, top] of Object.entries(tops)) {
      // +1 so a section counts as reached the moment its heading touches the
      // top of the viewport rather than a pixel after.
      if (offsetY + 1 >= top) next = Number(key);
    }
    setCurrentSection((was) => (was === next ? was : next));
  };

  const scrollToSection = (index: number) => {
    const top = sectionTops.current[index];
    if (top === undefined) return;
    scrollRef.current?.scrollTo({ y: top, animated: true });
  };

  const heading = doc && currentSection !== null ? doc.sections[currentSection]?.heading : undefined;

  return (
    <Screen>
      <View style={styles.header}>
        <View style={styles.headerRow}>
          <BackButton />
          <View style={styles.headerText}>
            <Text style={styles.title} accessibilityRole="header" numberOfLines={1}>
              {doc?.title ?? 'Not found'}
            </Text>
            {/* ⚠️ HIDDEN FROM ASSISTIVE TECH. It is a position indicator for
                the eye — a screen reader is already inside the section and has
                just read its heading, so announcing it again on every boundary
                is noise interrupting the prose. */}
            {heading ? (
              <Text
                style={styles.currentSection}
                numberOfLines={1}
                accessibilityElementsHidden
                importantForAccessibility="no-hide-descendants"
                testID="legal-current-section"
              >
                {heading}
              </Text>
            ) : null}
          </View>
        </View>
        {/* Sits on the header's bottom edge, scaling from the left. Purely
            decorative, so it carries no accessibility identity at all. */}
        <View style={styles.progressTrack} accessibilityElementsHidden>
          <Animated.View style={[styles.progressFill, progressStyle]} />
        </View>
      </View>

      {!doc ? (
        <View style={styles.notFound}>
          <EmptyState title="We couldn't find that page" body="The link may be out of date." />
        </View>
      ) : (
        <Animated.ScrollView
          ref={scrollRef as never}
          onScroll={onScroll}
          // ⚠️ 16, NOT 64, AND THE REASONING FOR 64 WAS WRONG. It was "four
          // times a second is plenty to notice a section boundary, at a quarter
          // of the JS traffic" — but this handler is a Reanimated WORKLET
          // running on the UI thread, so it costs no JS traffic to throttle in
          // the first place. All 64 bought was a progress bar updating four
          // times a second, which reads as stepping rather than filling. The
          // section label is driven by onScrollEndDrag/onMomentumScrollEnd
          // instead, which are JS and fire once per gesture regardless of this.
          scrollEventThrottle={16}
          onScrollEndDrag={(e) => updateCurrentSection(e.nativeEvent.contentOffset.y)}
          onMomentumScrollEnd={(e) => updateCurrentSection(e.nativeEvent.contentOffset.y)}
          contentContainerStyle={[
            styles.scroll,
            // The pushed-screen bottom inset, as on SettingsScreen: `Screen`
            // pads only the top by default, so without this the final clause
            // of a legal document sits under the Android navigation buttons.
            { paddingBottom: insets.bottom + spacing.xxl },
          ]}
          testID="legal-scroll"
        >
          <Text style={styles.updated}>Last updated {doc.lastUpdated}</Text>

          {doc.intro.map((paragraph) => (
            <Text key={paragraph} style={styles.lede}>
              {paragraph}
            </Text>
          ))}

          <DocumentIndex
            headings={doc.sections.map((section) => section.heading)}
            onSelect={scrollToSection}
            testID="legal-index"
          />

          {doc.sections.map((section, index) => (
            <View
              key={section.heading}
              style={styles.section}
              onLayout={(e) => {
                sectionTops.current[index] = e.nativeEvent.layout.y;
              }}
            >
              <Text style={styles.subhead} accessibilityRole="header">
                {section.heading}
              </Text>
              {section.body.map((paragraph) =>
                paragraph.startsWith('• ') ? (
                  // ⚠️ A REAL HANGING INDENT, which the previous `paddingLeft`
                  // could not produce however its comment read. Padding insets
                  // EVERY line equally, so a wrapped bullet aligned under the
                  // dot — exactly what that comment said it was avoiding. Two
                  // Texts in a row put the dot in its own column and let the
                  // prose wrap within its own, which is the only way to get a
                  // hanging indent in React Native.
                  <View key={paragraph} style={styles.bulletRow}>
                    <Text style={styles.bulletDot}>•</Text>
                    <Text style={styles.bulletText}>{paragraph.slice(2)}</Text>
                  </View>
                ) : (
                  <Text key={paragraph} style={styles.prose}>
                    {paragraph}
                  </Text>
                ),
              )}
            </View>
          ))}
        </Animated.ScrollView>
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

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    // Fixed above the scroll rather than scrolling with it: it carries the
    // progress bar and the current-section label, both of which describe where
    // you are and would be useless once they had scrolled away.
    header: {
      backgroundColor: c.background,
    },
    headerRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.xs,
      paddingHorizontal: spacing.xl,
      paddingBottom: spacing.sm,
    },
    headerText: {
      flex: 1,
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
    },
    currentSection: {
      ...typography.caption,
      color: c.textSecondary,
    },
    progressTrack: {
      height: PROGRESS_HEIGHT,
      backgroundColor: c.surfaceSubtle,
    },
    progressFill: {
      height: PROGRESS_HEIGHT,
      backgroundColor: c.primary,
      // Scaled from the left edge, so scaleX reads as a bar filling rather than
      // one growing from its middle.
      transformOrigin: 'left',
      width: '100%',
    },
    notFound: {
      flex: 1,
      padding: spacing.xl,
    },
    scroll: {
      padding: spacing.xl,
      // ⚠️ PARAGRAPH RHYTHM, NOT SECTION RHYTHM. This gap now separates
      // PARAGRAPHS; sections carry their own spacing.xxl top margin below. The
      // previous single spacing.lg gap did both jobs, so a new section was no
      // more of a break than the next sentence and twenty of them read as one
      // undifferentiated stream.
      gap: spacing.md,
    },
    updated: {
      ...typography.caption,
      color: c.textSecondary,
    },
    lede: {
      ...typography.prose,
      color: c.textPrimary,
    },
    section: {
      gap: spacing.md,
      // The hierarchy: twice the paragraph gap plus the paragraph gap already
      // between children, so a section break reads as unmistakably larger than
      // a paragraph break.
      marginTop: spacing.xl,
    },
    subhead: {
      ...typography.heading,
      color: c.textPrimary,
    },
    prose: {
      ...typography.prose,
      color: c.textPrimary,
    },
    bulletRow: {
      flexDirection: 'row',
      gap: spacing.sm,
      paddingLeft: spacing.xs,
    },
    bulletDot: {
      ...typography.prose,
      color: c.textSecondary,
    },
    bulletText: {
      ...typography.prose,
      color: c.textPrimary,
      // Takes the rest of the row and wraps inside it, which is what puts the
      // second line under the first WORD instead of under the dot.
      flex: 1,
    },
  });

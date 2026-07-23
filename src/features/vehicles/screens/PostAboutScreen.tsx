/**
 * WHAT:  PostAboutScreen — the pushed "About this car" page the detail page's
 *        "Show more" opens: the owner's full prose under bold subheads ("How
 *        to spot it", "How it drives", "Owner's note"), unclamped, with an
 *        on-screen back affordance and the house skeleton while loading.
 * WHY:   The reference clamps the in-page description and moves the full text
 *        to its own surface ("About this space" sheet with subsection heads) —
 *        long prose gets room to breathe without stretching the main page.
 *        Our guided-description fields map 1:1 onto its host-input subheads.
 *        Read-only; renders only what the post has (absent fields = no head).
 * LINKS: src/app/post-about.tsx (route); components/PostDetailBody.tsx (the
 *        clamped preview + Show more); hooks/usePostDetail.ts;
 *        docs/design-refs/post-detail/REFERENCE_SPEC.md §8.
 */

import { useRouter } from 'expo-router';
import { ChevronLeft } from 'lucide-react-native';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { colors, radii, sizes, spacing, typography } from '@/shared/theme';
import { EmptyState, Screen } from '@/shared/ui';

import { usePostDetail } from '../hooks/usePostDetail';
import type { PostDetail } from '../types';

export interface PostAboutScreenProps {
  postId: string;
}

export function PostAboutScreen({ postId }: PostAboutScreenProps) {
  const { status, result, retry } = usePostDetail(postId);
  const post = status === 'ready' && result?.kind === 'visible' ? result.post : null;

  return (
    <Screen scroll contentContainerStyle={styles.scroll}>
      {/* Pushed page, headers hidden app-wide → an on-screen back control. */}
      <View style={styles.headerRow}>
        <BackButton />
        <Text style={styles.title} accessibilityRole="header">
          About this car
        </Text>
      </View>

      {status === 'loading' ? <AboutSkeleton /> : null}

      {status === 'error' ? (
        <EmptyState
          title="Couldn't load this"
          body="Check your connection and try again."
          actionLabel="Try again"
          onAction={retry}
        />
      ) : null}

      {/* Ready but not visible (closed/removed while this page was open) —
          a fact, not a fault: no retry to loop on. */}
      {status === 'ready' && !post ? (
        <EmptyState
          title="This post is no longer available"
          body="It may have been closed or removed by the owner."
        />
      ) : null}

      {post ? <AboutContent post={post} /> : null}
    </Screen>
  );
}

/** The subhead → field mapping (the reference's structured description). */
function AboutContent({ post }: { post: PostDetail }) {
  const sections = [
    { title: 'How to spot it', text: post.descRecognise },
    { title: 'How it drives', text: post.descDrives },
    { title: "Owner's note", text: post.ownerNote },
  ].filter((section): section is { title: string; text: string } => Boolean(section.text));

  return (
    <>
      {sections.map((section) => (
        <View key={section.title} style={styles.section}>
          <Text style={styles.subhead}>{section.title}</Text>
          <Text style={styles.prose}>{section.text}</Text>
        </View>
      ))}
    </>
  );
}

function BackButton() {
  const router = useRouter();
  return (
    <Pressable
      onPress={() => router.back()}
      accessibilityRole="button"
      accessibilityLabel="Back"
      style={styles.back}
      testID="about-back"
    >
      <ChevronLeft size={sizes.icon} color={colors.textPrimary} />
    </Pressable>
  );
}

function AboutSkeleton() {
  return (
    <View style={styles.skeleton} testID="about-skeleton">
      <View style={[styles.skeletonLine, styles.skeletonShort]} />
      <View style={styles.skeletonLine} />
      <View style={styles.skeletonLine} />
      <View style={[styles.skeletonLine, styles.skeletonShort]} />
    </View>
  );
}

const styles = StyleSheet.create({
  scroll: {
    padding: spacing.xl,
    gap: spacing.xl,
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
    color: colors.textPrimary,
    flexShrink: 1,
  },
  section: {
    gap: spacing.sm,
  },
  subhead: {
    ...typography.heading,
    color: colors.textPrimary,
  },
  prose: {
    ...typography.body,
    color: colors.textPrimary,
  },
  skeleton: {
    gap: spacing.md,
  },
  skeletonLine: {
    height: sizes.skeletonLine,
    borderRadius: radii.sm,
    backgroundColor: colors.surfaceSubtle,
  },
  skeletonShort: {
    width: '60%',
  },
});

/**
 * WHAT:  PhotoPager — a row of photos you swipe through one page at a time,
 *        with a quiet "n / m" counter over the photo's lower right (hidden for
 *        a single photo) and a calm placeholder frame when there are none.
 *        Display-only: nothing in it is tappable.
 * WHY:   Extracted 2026-10-08 from the post detail hero when the garage's
 *        "Your car" sheet needed the same thing — one pager, so the two can't
 *        drift. It measures its own width (onLayout) and stays on the same
 *        photo when that width changes (rotation), the way VehicleCard's
 *        carousel learned to; `estimatedWidth` lets a caller that already
 *        knows its width lay out on the first frame.
 *
 *        ⚠️ DISPLAY-ONLY. Under a confirmation (the "Your car" sheet), a
 *        tappable photo is a tap-to-affirm trap — see MediaIdentityCard.
 *        Swiping is a gesture, not a tap, so it stays.
 *
 *        ⚠️ The counter is chrome ON THE PHOTOGRAPHY: `surfaceOverMedia` /
 *        `textOnMedia`, never the page tokens, which flip with the theme
 *        while a photo does not. It is a SIGHTED aid only: each photo
 *        carries its own place ("Blue BMW, photo 2 of 5") for screen
 *        readers, where a counter that updates on scroll-end could be stale.
 * LINKS: src/features/vehicles/components/PostHero.tsx (the detail hero);
 *        src/features/garage/components/VehicleSummaryStep.tsx;
 *        src/shared/ui/MediaIdentityCard.tsx (the display-only rule, and the
 *          placeholder's size).
 */

import { Image as ImageIcon, type LucideIcon } from 'lucide-react-native';
import { useEffect, useRef, useState } from 'react';
import {
  ScrollView,
  StyleSheet,
  Text,
  View,
  type LayoutChangeEvent,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

import {
  displayFontScaleCap,
  radii,
  sizes,
  spacing,
  typography,
  usePalette,
  useThemedStyles,
  type Palette,
} from '../theme';
import { AppImage } from './AppImage';

export interface PhotoPagerProps {
  photos: { uri: string }[];
  /** Width ÷ height of each page. Ignored when `height` is given. */
  aspectRatio?: number;
  /** A fixed page height (the detail hero sizes itself to the screen). */
  height?: number;
  /** The width it will most likely have, for its FIRST frame — before this,
   *  it can't size its pages and would show an empty frame. */
  estimatedWidth?: number;
  /** What the photos show (e.g. "Blue BMW 320d"); each page adds its place. */
  alt?: string;
  /** The mark in the empty frame when there are no photos. */
  placeholderIcon?: LucideIcon;
  /** What a screen reader hears for the empty frame. */
  placeholderLabel?: string;
  /** Extra lift for the counter when something overlaps the photo's foot. */
  counterBottomInset?: number;
  /** The frame's own style — corner radius, margins. NOT border or padding:
   *  pages are sized to the frame's measured width. */
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

export function PhotoPager({
  photos,
  aspectRatio = 4 / 3,
  height: fixedHeight,
  estimatedWidth = 0,
  alt,
  placeholderIcon: PlaceholderIcon = ImageIcon,
  placeholderLabel = 'No photos added yet',
  counterBottomInset = 0,
  style,
  testID,
}: PhotoPagerProps) {
  const styles = useThemedStyles(makeStyles);
  const palette = usePalette();
  const [width, setWidth] = useState(estimatedWidth);
  const [index, setIndex] = useState(0);
  const scrollRef = useRef<ScrollView>(null);
  const height = fixedHeight ?? (width > 0 ? width / aspectRatio : 0);

  // A shorter list must not leave the page past the end — and the clamp is
  // written BACK, so a list that grows again later doesn't jump the counter
  // to a page the scroll isn't on (the detail screen's editor changes photos
  // without unmounting this).
  const last = Math.max(photos.length - 1, 0);
  if (index > last) {
    setIndex(last);
  }
  const current = Math.min(index, last);

  const onLayout = (event: LayoutChangeEvent) => {
    const measured = event.nativeEvent.layout.width;
    if (measured > 0 && measured !== width) setWidth(measured);
  };

  // Stay on the same photo when the width changes (rotation): the old offset
  // would land between two pages. Not on the first width — there is nothing
  // to re-align yet.
  const indexRef = useRef(current);
  useEffect(() => {
    indexRef.current = current;
  }, [current]);
  const alignedWidth = useRef(width);
  useEffect(() => {
    if (width === alignedWidth.current) return;
    alignedWidth.current = width;
    if (width > 0) scrollRef.current?.scrollTo({ x: indexRef.current * width, animated: false });
  }, [width]);

  const frame = [
    styles.frame,
    fixedHeight === undefined ? { aspectRatio } : { height: fixedHeight },
    style,
  ];

  if (photos.length === 0) {
    return (
      <View
        style={[frame, styles.placeholder]}
        onLayout={onLayout}
        accessible
        accessibilityRole="image"
        accessibilityLabel={placeholderLabel}
        testID={testID}
      >
        {/* avatarLg, not an icon size: in a frame this big a 24pt glyph
            reads as broken, not calm (MediaIdentityCard learned this).
            borderStrong, so it is a frame mark rather than content. */}
        <PlaceholderIcon size={sizes.avatarLg} color={palette.borderStrong} />
      </View>
    );
  }

  return (
    <View style={frame} onLayout={onLayout} testID={testID}>
      {width > 0 ? (
        <ScrollView
          ref={scrollRef}
          horizontal
          pagingEnabled
          showsHorizontalScrollIndicator={false}
          onMomentumScrollEnd={(event) => {
            // Clamped: overscroll can round past either end.
            setIndex(
              Math.min(last, Math.max(0, Math.round(event.nativeEvent.contentOffset.x / width))),
            );
          }}
          testID={testID ? `${testID}-scroll` : undefined}
        >
          {photos.map((photo, i) => (
            <AppImage
              key={`${photo.uri}-${i}`}
              uri={photo.uri}
              accessibilityLabel={
                photos.length > 1 ? `${alt ?? 'Photo'}, photo ${i + 1} of ${photos.length}` : alt
              }
              style={{ width, height }}
            />
          ))}
        </ScrollView>
      ) : null}
      {photos.length > 1 ? (
        <View
          style={[styles.counter, { bottom: spacing.md + counterBottomInset }]}
          pointerEvents="none"
          // Sighted only — each photo already says where it is (see header).
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          testID={testID ? `${testID}-counter` : undefined}
        >
          <Text style={styles.counterText} maxFontSizeMultiplier={displayFontScaleCap}>
            {current + 1} / {photos.length}
          </Text>
        </View>
      ) : null}
    </View>
  );
}

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    // surfaceSubtle behind the photos: the frame is never a page-coloured
    // hole while a photo loads or before the first measurement.
    frame: {
      width: '100%',
      overflow: 'hidden',
      backgroundColor: c.surfaceSubtle,
    },
    placeholder: {
      alignItems: 'center',
      justifyContent: 'center',
    },
    counter: {
      position: 'absolute',
      right: spacing.md,
      // surfaceOverMedia, NOT surfaceInverse: this pill sits ON THE PHOTO.
      backgroundColor: c.surfaceOverMedia,
      borderRadius: radii.full,
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.xs,
    },
    counterText: {
      ...typography.caption,
      color: c.textOnMedia,
    },
  });

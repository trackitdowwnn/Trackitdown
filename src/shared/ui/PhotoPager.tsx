/**
 * WHAT:  PhotoPager — a row of photos you swipe through one page at a time,
 *        with a quiet "n / m" counter over the photo's lower right (hidden for
 *        a single photo) and a calm placeholder frame when there are none.
 *        Display-only: nothing in it is tappable.
 * WHY:   Extracted 2026-10-08 from the post detail hero when the garage's
 *        "Your car" sheet needed the same thing — one pager, so the two can't
 *        drift. It measures its own width (onLayout) and re-aligns to the
 *        current photo when that width changes (rotation), the way
 *        VehicleCard's carousel learned to; `estimatedWidth` lets a caller
 *        that already knows its width lay out on the first frame.
 *
 *        ⚠️ DISPLAY-ONLY. Under a confirmation (the "Your car" sheet), a
 *        tappable photo is a tap-to-affirm trap — see MediaIdentityCard.
 *        Swiping is a gesture, not a tap, so it stays.
 *
 *        ⚠️ The counter is chrome ON THE PHOTOGRAPHY: `surfaceOverMedia` /
 *        `textOnMedia`, never the page tokens, which flip with the theme
 *        while a photo does not.
 * LINKS: src/features/vehicles/components/PostHero.tsx (the detail hero);
 *        src/features/garage/components/VehicleSummaryStep.tsx;
 *        src/shared/ui/MediaIdentityCard.tsx (the display-only rule).
 */

import { useEffect, useRef, useState, type ReactNode } from 'react';
import {
  ScrollView,
  StyleSheet,
  Text,
  View,
  type LayoutChangeEvent,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

import { radii, spacing, typography, useThemedStyles, type Palette } from '../theme';
import { AppImage } from './AppImage';

export interface PhotoPagerProps {
  photos: { uri: string }[];
  /** Width ÷ height of each page. Ignored when `height` is given. */
  aspectRatio?: number;
  /** A fixed page height (the detail hero sizes itself to the screen). */
  height?: number;
  /** The width it will most likely have, for its FIRST frame — before this,
   *  it can't size its pages and would render empty for a frame. */
  estimatedWidth?: number;
  /** Screen-reader description of the photos (e.g. "Blue BMW 320d"). */
  alt?: string;
  /** Shown in the frame when there are no photos. */
  placeholder?: ReactNode;
  /** Extra lift for the counter when something overlaps the photo's foot. */
  counterBottomInset?: number;
  /** The frame's own style (corner radius, margins). */
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

export function PhotoPager({
  photos,
  aspectRatio = 4 / 3,
  height: fixedHeight,
  estimatedWidth = 0,
  alt,
  placeholder,
  counterBottomInset = 0,
  style,
  testID,
}: PhotoPagerProps) {
  const styles = useThemedStyles(makeStyles);
  const [width, setWidth] = useState(estimatedWidth);
  const [index, setIndex] = useState(0);
  const scrollRef = useRef<ScrollView>(null);
  const height = fixedHeight ?? (width > 0 ? width / aspectRatio : 0);
  // A shorter list (or a width change) must never leave the counter past the end.
  const current = Math.min(index, Math.max(photos.length - 1, 0));

  const onLayout = (event: LayoutChangeEvent) => {
    const measured = event.nativeEvent.layout.width;
    if (measured > 0 && measured !== width) setWidth(measured);
  };

  // Stay on the same photo when the width changes (rotation): the old offset
  // would land between two pages.
  useEffect(() => {
    if (width > 0) scrollRef.current?.scrollTo({ x: current * width, animated: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only on a width change
  }, [width]);

  const frame = [
    styles.frame,
    fixedHeight === undefined ? { aspectRatio } : { height: fixedHeight },
    style,
  ];

  if (photos.length === 0) {
    return (
      <View style={[frame, styles.placeholder]} onLayout={onLayout} testID={testID}>
        {placeholder}
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
            const next = Math.min(
              photos.length - 1,
              Math.max(0, Math.round(event.nativeEvent.contentOffset.x / width)),
            );
            setIndex(next);
          }}
          testID={testID ? `${testID}-scroll` : undefined}
        >
          {photos.map((photo, i) => (
            <AppImage
              key={`${photo.uri}-${i}`}
              uri={photo.uri}
              accessibilityLabel={alt}
              style={{ width, height }}
            />
          ))}
        </ScrollView>
      ) : null}
      {photos.length > 1 ? (
        <View
          style={[styles.counter, { bottom: spacing.md + counterBottomInset }]}
          pointerEvents="none"
          accessible
          accessibilityRole="text"
          accessibilityLabel={`Photo ${current + 1} of ${photos.length}`}
          testID={testID ? `${testID}-counter` : undefined}
        >
          <Text style={styles.counterText}>
            {current + 1} / {photos.length}
          </Text>
        </View>
      ) : null}
    </View>
  );
}

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    frame: {
      width: '100%',
      overflow: 'hidden',
    },
    // PAGE chrome, not chrome over a photo (there is no photo), so it stays
    // on the themed surface token.
    placeholder: {
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: c.surfaceSubtle,
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

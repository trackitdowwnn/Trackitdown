/**
 * WHAT:  DocumentIndex — the collapsible list of section headings at the top of
 *        a legal document, each tapping through to its section.
 * WHY:   These documents run to twenty-odd sections. Someone opening the
 *        Privacy policy almost never wants to read it: they want one answer —
 *        what happens to my location, how long is it kept, how do I delete my
 *        account — and without an index the only way to find it is to scroll
 *        past everything that is not it. That is also the difference between a
 *        document somebody consults and one they abandon, which for a consent
 *        surface matters more than for most screens.
 *
 *        ⚠️ COLLAPSED BY DEFAULT, and that is the opposite of what an index
 *        usually does. Expanded, twenty headings push the document's own first
 *        sentence off the screen, so the page opens on its table of contents
 *        rather than on what it says. The reader who wants to read gets the
 *        document; the reader who wants to look something up is one tap away.
 *
 *        ⚠️ NOT IN shared/ui. One consumer, and ARCHITECTURE.md's bar for
 *        shared/ is two features needing the same thing. If the help centre
 *        ever grows articles this is the first thing it would want.
 * LINKS: ../screens/LegalDocumentScreen.tsx (the only consumer);
 *        ../lib/legalContent.ts (LegalSection — the headings come from there).
 */

import { ChevronDown } from 'lucide-react-native';
import { useState } from 'react';
import { LayoutAnimation, Platform, Pressable, StyleSheet, Text, UIManager, View } from 'react-native';

import {
  motion,
  radii,
  sizes,
  spacing,
  typography,
  usePalette,
  useThemedStyles,
  type Palette,
} from '@/shared/theme';

// Android needs this opted into explicitly; without it the expand is a jump
// cut. Guarded because the API is a no-op on the New Architecture in some
// versions and calling it on iOS throws.
if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

export interface DocumentIndexProps {
  headings: string[];
  /** Scroll the document to the section at this index. */
  onSelect: (index: number) => void;
  testID?: string;
}

export function DocumentIndex({ headings, onSelect, testID }: DocumentIndexProps) {
  const styles = useThemedStyles(makeStyles);
  const palette = usePalette();
  const [open, setOpen] = useState(false);

  // Nothing to index. A one-section document with a "Contents" control that
  // reveals a single line is worse than no control.
  if (headings.length < 2) return null;

  const toggle = () => {
    LayoutAnimation.configureNext({
      duration: motion.standard,
      update: { type: LayoutAnimation.Types.easeInEaseOut },
      // No `create`/`delete` opacity: the rows sliding in is the whole effect,
      // and fading them as well reads as two animations disagreeing.
    });
    setOpen((was) => !was);
  };

  return (
    <View style={styles.wrap} testID={testID}>
      <Pressable
        onPress={toggle}
        accessibilityRole="button"
        // The label carries the state because the chevron cannot: "Contents,
        // button" alone leaves a screen-reader user tapping to find out.
        accessibilityLabel={open ? 'Hide contents' : 'Show contents'}
        accessibilityState={{ expanded: open }}
        style={({ pressed }) => [styles.toggle, pressed && styles.togglePressed]}
        testID="legal-index-toggle"
      >
        <Text style={styles.toggleLabel}>Contents</Text>
        <ChevronDown
          size={sizes.icon}
          color={palette.textSecondary}
          // A rotated chevron rather than a swapped glyph: same object moving,
          // which is what the disclosure actually is.
          style={open ? styles.chevronOpen : undefined}
        />
      </Pressable>

      {open ? (
        <View style={styles.list}>
          {headings.map((heading, index) => (
            <Pressable
              key={heading}
              onPress={() => onSelect(index)}
              accessibilityRole="link"
              style={({ pressed }) => [styles.item, pressed && styles.itemPressed]}
              testID={`legal-index-${index}`}
            >
              <Text style={styles.itemLabel}>{heading}</Text>
            </Pressable>
          ))}
        </View>
      ) : null}
    </View>
  );
}

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    // A surface card on the page background — the reference's white-on-white
    // separation rather than a border. It is the one object on the page that
    // is not prose, so it may look like an object.
    wrap: {
      backgroundColor: c.surface,
      borderRadius: radii.lg,
      overflow: 'hidden',
    },
    toggle: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      minHeight: sizes.control,
      paddingHorizontal: spacing.lg,
      paddingVertical: spacing.md,
    },
    togglePressed: {
      backgroundColor: c.surfaceSubtle,
    },
    toggleLabel: {
      ...typography.label,
      color: c.textPrimary,
    },
    chevronOpen: {
      transform: [{ rotate: '180deg' }],
    },
    list: {
      paddingBottom: spacing.sm,
    },
    item: {
      // No minHeight: these are text links in a list, not controls, and at
      // twenty of them a 52pt row makes the index longer than the section it
      // saves you scrolling past. paddingVertical still clears the 44pt target
      // once the label's own line height is counted.
      paddingHorizontal: spacing.lg,
      paddingVertical: spacing.md,
    },
    itemPressed: {
      backgroundColor: c.surfaceSubtle,
    },
    itemLabel: {
      ...typography.body,
      color: c.textPrimary,
    },
  });

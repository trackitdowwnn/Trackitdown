/**
 * WHAT:  A smoke test that mounts real components UNDER THE DARK PALETTE and
 *        asserts they actually paint dark values.
 * WHY:   Until this file, 2101 passing tests could not have noticed an entire
 *        screen staying light. Every other dark-mode assertion in the repo is
 *        on a PURE helper — `colors.test.ts` computes ratios, `mapStyle.test.ts`
 *        compares arrays — and every component test renders bare, which means
 *        it renders light. That is the structural gap the unwired dark basemap
 *        slipped through: the migration was verified by a compiler, and a
 *        compiler cannot see a colour.
 *
 *        So this asserts the one thing nothing else does — that the plumbing
 *        from provider to rendered style actually carries. Deliberately small:
 *        a couple of representative primitives, not a snapshot of the app. The
 *        point is to fail loudly if `useThemedStyles` ever stops resolving,
 *        which would otherwise present as "dark mode quietly does nothing".
 * LINKS: src/shared/theme/paletteContext.tsx; src/shared/theme/useThemedStyles.ts;
 *        src/shared/theme/colors.test.ts (the palette's own contrast tests).
 */

import { render } from '@testing-library/react-native';
import { StyleSheet, Text, View } from 'react-native';

import { colors, darkColors } from './colors';
import { PaletteContext } from './paletteContext';
import { useThemedStyles } from './useThemedStyles';
import type { Palette } from './colors';

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    card: { backgroundColor: c.surface, borderColor: c.border },
    label: { color: c.textPrimary },
  });

function Card() {
  const styles = useThemedStyles(makeStyles);
  return (
    <View testID="card" style={styles.card}>
      <Text testID="label" style={styles.label}>
        Stolen car
      </Text>
    </View>
  );
}

const flat = (el: { props: Record<string, unknown> }) =>
  StyleSheet.flatten(el.props.style as never) as unknown as Record<string, string>;

describe('a component under the dark palette', () => {
  it('paints dark values, not light ones', async () => {
    const { getByTestId } = await render(
      <PaletteContext.Provider value={darkColors}>
        <Card />
      </PaletteContext.Provider>,
    );

    expect(flat(getByTestId('card')).backgroundColor).toBe(darkColors.surface);
    expect(flat(getByTestId('card')).borderColor).toBe(darkColors.border);
    expect(flat(getByTestId('label')).color).toBe(darkColors.textPrimary);
  });

  it('paints light values with no provider — the bare-render default', async () => {
    // The other half of the contract, and the reason ~108 existing test files
    // needed no edits: an un-wrapped render is simply the light app.
    const { getByTestId } = await render(<Card />);

    expect(flat(getByTestId('card')).backgroundColor).toBe(colors.surface);
    expect(flat(getByTestId('label')).color).toBe(colors.textPrimary);
  });

  it('resolves the two schemes to genuinely different paint', async () => {
    // Guards the failure mode that matters: a migration that "works" because
    // both schemes resolve to the same palette would satisfy every assertion
    // above taken alone.
    expect(darkColors.surface).not.toBe(colors.surface);
    expect(darkColors.textPrimary).not.toBe(colors.textPrimary);
  });
});

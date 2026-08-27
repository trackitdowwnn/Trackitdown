/**
 * WHAT:  AppSwitch — React Native's Switch with the app's palette applied.
 * WHY:   The same four colour props were copy-pasted at three call sites across
 *        three features (the Settings screen's five category toggles, the
 *        alerts list's per-alert pause, the location picker's option row). Two
 *        features needing the same thing is ARCHITECTURE.md's bar for shared/,
 *        and this is three.
 *
 *        ⚠️ IT OWNS THE COLOURS ONLY, NEVER THE ACCESSIBILITY — and that split
 *        is the whole design. The three sites deliberately differ:
 *          * LocationPicker hides its switch from assistive tech, because the
 *            row wrapping it owns the role.
 *          * AlertCard's is hidden too, since 2026-08-27: the switch is ~31pt
 *            on iOS, under the touch floor, so a Pressable box wraps it and
 *            carries the role, the label and the checked state. The switch
 *            underneath stays interactive purely so dragging still works.
 *          * SettingsScreen's rides in ListRow's `trailing`, which does the
 *            hiding for it.
 *        Baking any a11y default in here would silence one of them or
 *        double-announce the other two. Everything unrecognised is spread
 *        through, so each caller keeps exactly what it had.
 *
 *        ⚠️ THE OFF STATE IS THE ONE WITH A CONTRAST PROBLEM. On it is
 *        `primary` — near-black, unmissable. Off is `borderStrong` behind a
 *        `surface` thumb, and both of those boundaries have to clear 3:1
 *        (WCAG 1.4.11): the thumb against its track, and the track against the
 *        page behind it. The second one failed at 2.832 until borderStrong was
 *        raised to #8F8F8F on 2026-08-25. `colors.test.ts` asserts both, which
 *        is where that question gets answered once rather than at three call
 *        sites.
 * LINKS: src/shared/theme (the palette); src/shared/ui/ListRow.tsx (`toggled`
 *        supplies the semantics, this supplies the pixels);
 *        src/shared/theme/colors.test.ts (the two contrast assertions).
 */

import { Switch, type SwitchProps } from 'react-native';

import { usePalette } from '@/shared/theme';

export type AppSwitchProps = SwitchProps;

export function AppSwitch(props: AppSwitchProps) {
  const palette = usePalette();

  return (
    <Switch
      trackColor={{ true: palette.primary, false: palette.borderStrong }}
      thumbColor={palette.surface}
      ios_backgroundColor={palette.borderStrong}
      // ⚠️ AFTER the colours, so a caller can still override one — and before
      // nothing, so a caller can never accidentally lose `value`/`onValueChange`.
      {...props}
    />
  );
}

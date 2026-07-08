/**
 * WHAT:  Context carrying the concrete TextInput component TextField renders,
 *        plus HostTextInput, the stable component that reads it.
 * WHY:   Inputs inside a BottomSheet must be @gorhom/bottom-sheet's
 *        BottomSheetTextInput — it is what tells the sheet the keyboard is up
 *        so the sheet slides clear instead of being covered. BottomSheet
 *        provides it here; TextField renders HostTextInput, which resolves
 *        the context; everywhere else falls back to the plain React Native
 *        TextInput. HostTextInput exists so consumers render a module-level
 *        component (react-hooks/static-components) instead of a context value
 *        picked during their own render. Kept in its own module so TextField
 *        never imports the bottom-sheet library.
 * LINKS: src/shared/ui/BottomSheet.tsx (provider),
 *        src/shared/ui/TextField.tsx (consumer).
 */

import { createContext, createElement, useContext, type ComponentType } from 'react';
import { TextInput, type TextInputProps } from 'react-native';

export const TextInputHostContext =
  createContext<ComponentType<TextInputProps>>(TextInput);

/** Renders the host-provided TextInput (sheet-aware inside a BottomSheet). */
export function HostTextInput(props: TextInputProps) {
  const Input = useContext(TextInputHostContext);
  return createElement(Input, props);
}

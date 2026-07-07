/**
 * WHAT:  Root layout for the app — sets up the Expo Router navigation stack
 *        and applies the light/dark navigation theme.
 * WHY:   Every screen renders inside this layout; it is the single entry
 *        point Expo Router mounts.
 * LINKS: Uses expo-router Stack + ThemeProvider. Feature screens are added
 *        as routes under src/app/ (see docs/ARCHITECTURE.md).
 */

import { DarkTheme, DefaultTheme, Stack, ThemeProvider } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useColorScheme } from 'react-native';

export default function RootLayout() {
  const colorScheme = useColorScheme();

  return (
    <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
      <Stack screenOptions={{ headerShown: false }} />
      <StatusBar style="auto" />
    </ThemeProvider>
  );
}

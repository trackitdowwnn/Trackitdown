/**
 * WHAT:  Root layout for the app — sets up the Expo Router navigation stack,
 *        applies the light/dark navigation theme, and mounts the app-wide
 *        gesture, bottom-sheet, and toast providers.
 * WHY:   Every screen renders inside this layout; it is the single entry
 *        point Expo Router mounts. GestureHandlerRootView is required once at
 *        the root for react-native-gesture-handler,
 *        BottomSheetModalProvider hosts every <BottomSheet> presented from
 *        any screen (see src/shared/ui/BottomSheet.tsx), AuthGate wraps the
 *        navigator (splash → onboarding / app — guests browse freely), and
 *        AuthSheet is the single app-wide deferred-auth surface, opened by
 *        gated actions via useRequireAuth.
 * LINKS: Uses expo-router Stack + ThemeProvider; src/features/auth (AuthGate,
 *        AuthSheet). Feature screens are routes under src/app/ (docs/ARCHITECTURE.md).
 */

import { BottomSheetModalProvider } from '@gorhom/bottom-sheet';
import { useFonts } from 'expo-font';
import { DarkTheme, DefaultTheme, Stack, ThemeProvider } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { Platform, StyleSheet, useColorScheme } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';

import { AuthGate, AuthSheet } from '@/features/auth';
import { ToastProvider } from '@/shared/ui';

// Platform-native screen transitions (motion audit): iOS gets the horizontal
// push + edge swipe-back users expect; Android gets Material's fade-through.
// Was unset — every push used the bare default and read "flat".
const pushAnimation = Platform.select({
  ios: 'slide_from_right',
  android: 'fade_from_bottom',
  default: 'default',
} as const);

export default function RootLayout() {
  const colorScheme = useColorScheme();

  // Satoshi (the app-wide family — typography tokens reference these exact
  // names). Runtime-loaded so the existing dev client needs no rebuild.
  const [fontsLoaded, fontError] = useFonts({
    'Satoshi-Regular': require('../assets/fonts/Satoshi-Regular.otf'),
    'Satoshi-Medium': require('../assets/fonts/Satoshi-Medium.otf'),
    'Satoshi-Bold': require('../assets/fonts/Satoshi-Bold.otf'),
    'Satoshi-Black': require('../assets/fonts/Satoshi-Black.otf'),
  });

  // Hold first paint the (few ms) the faces take — a load FAILURE renders
  // anyway on the system font rather than blanking the app.
  if (!fontsLoaded && !fontError) {
    return null;
  }

  return (
    <GestureHandlerRootView style={styles.root}>
      <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
        <BottomSheetModalProvider>
          {/* ToastProvider hosts the single app-wide toast above all screens. */}
          <ToastProvider>
            <AuthGate>
              <Stack
                screenOptions={{
                  headerShown: false,
                  animation: pushAnimation,
                  gestureEnabled: true, // iOS edge swipe-back (Android ignores)
                }}
              >
                {/* Full-screen TASK flows present from the bottom (modal grammar)
                    on both platforms, so they read as "a task over the app"
                    rather than a lateral push. */}
                <Stack.Screen name="report-sighting" options={{ animation: 'slide_from_bottom' }} />
                <Stack.Screen name="post-a-car" options={{ animation: 'slide_from_bottom' }} />
              </Stack>
              {/* The one auth surface: opens over any screen when a gated
                  action stores a pending intent (useRequireAuth). */}
              <AuthSheet />
            </AuthGate>
            <StatusBar style="auto" />
          </ToastProvider>
        </BottomSheetModalProvider>
      </ThemeProvider>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
});

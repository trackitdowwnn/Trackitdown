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
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useCallback } from 'react';
import { Platform, StyleSheet, useColorScheme } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';

import { AuthGate, AuthSheet } from '@/features/auth';
import { SaveYourCarSheet } from '@/features/garage';
// Direct path, not the feature barrel: this component pulls expo-notifications,
// the auth gate and the UI barrel, so keeping it out of '@/features/notifications'
// lets plain api modules import that barrel without inheriting all of it. Same
// call as AppMap vs the shared/ui barrel.
import { NotificationsHost } from '@/features/notifications/components/NotificationsHost';
import { CollectionPickerSheet } from '@/features/watchlist';
import { ToastProvider } from '@/shared/ui';

// Platform-native screen transitions (motion audit): iOS gets the horizontal
// push + edge swipe-back users expect; Android gets Material's fade-through.
// Was unset — every push used the bare default and read "flat".
const pushAnimation = Platform.select({
  ios: 'slide_from_right',
  android: 'fade_from_bottom',
  default: 'default',
} as const);

// Keep the OS splash up until we have something to replace it with. Without
// this it auto-hides the moment the root view mounts — which is BEFORE the
// fonts resolve, and this component returns null until they do, so the user
// saw the splash vanish onto a blank screen for a second or two.
// Module scope on purpose: it must run before the first render, not in an
// effect after it. A rejection is ignored — the only cause is the splash
// already being gone, which is precisely the state we wanted.
void SplashScreen.preventAutoHideAsync().catch(() => {});

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

  // Hand over from the OS splash only once this tree has actually painted, so
  // BrandSplash is already on screen underneath it. onLayout, not an effect:
  // an effect can fire a frame before the view is drawn, which is long enough
  // to flash the background between the two.
  const onLayoutRootView = useCallback(() => {
    if (fontsLoaded || fontError) {
      void SplashScreen.hideAsync().catch(() => {});
    }
  }, [fontsLoaded, fontError]);

  // Hold first paint the (few ms) the faces take — a load FAILURE renders
  // anyway on the system font rather than blanking the app. The OS splash is
  // still covering the screen here, so this null is never seen.
  if (!fontsLoaded && !fontError) {
    return null;
  }

  return (
    <GestureHandlerRootView style={styles.root} onLayout={onLayoutRootView}>
      <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
        {/* ToastProvider hosts the single app-wide toast above all screens, and
            MUST stay OUTSIDE BottomSheetModalProvider. @gorhom/bottom-sheet
            re-parents every presented sheet's content into the portal host that
            BottomSheetModalProvider mounts, so sheet content only sees context
            provided ABOVE that host — with the order reversed, anything inside a
            sheet calling useToast() threw "must be used inside a ToastProvider".
            The toast still paints on top: it renders after {children}, and the
            portal host is inside those children. */}
        <ToastProvider>
          <BottomSheetModalProvider>
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
                {/* Creating an alert is a self-contained task over the app,
                    like the two above. Editing one (/alerts/[alertId]) is a
                    lateral push from the list, so it keeps the default. */}
                <Stack.Screen name="alerts/new" options={{ animation: 'slide_from_bottom' }} />
              </Stack>
              {/* The one auth surface: opens over any screen when a gated
                  action stores a pending intent (useRequireAuth). */}
              <AuthSheet />
              {/* Renders nothing. Registers this device's push token and routes
                  notification taps — including a COLD start, where the response
                  is ready before the navigator is, so it waits for both here at
                  the root rather than on a screen that may not exist yet. */}
              <NotificationsHost />
              {/* Offers the garage to someone who opened the report wizard and
                  left without posting. Mounted here for the same reason as
                  AuthSheet: the wizard route unmounts on exit, so the sheet
                  cannot live on the screen that triggers it. Inert until an
                  intent is raised. */}
              <SaveYourCarSheet />
              {/* "Change" on the save toast lands here. Root-mounted for the
                  same reason again: the toast outlives the feed cell whose
                  bookmark raised it. Inert until an intent is raised. */}
              <CollectionPickerSheet />
            </AuthGate>
            <StatusBar style="auto" />
          </BottomSheetModalProvider>
        </ToastProvider>
      </ThemeProvider>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
});

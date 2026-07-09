/**
 * WHAT:  Dynamic Expo config. Extends the static app.json to inject the
 *        react-native-maps and expo-location config plugins, with the Google
 *        Maps API keys read from the environment.
 * WHY:   API keys must not be committed, and app.json is static JSON that can't
 *        read env vars — so the plugin config lives here. Expo Go ignores
 *        native config plugins AND can NOT render Google Maps on Android: it
 *        runs as host.exp.exponent with Expo's bundled Maps key, which Google
 *        rejects (grey tiles + "Authorization failure" in logcat; see
 *        expo/expo#39301). Android maps therefore require a dev build
 *        (`npx expo run:android`), which embeds our key. iOS Expo Go still
 *        shows Apple Maps. Before building, set GOOGLE_MAPS_ANDROID_API_KEY
 *        and GOOGLE_MAPS_IOS_API_KEY (enable "Maps SDK for Android" / "Maps
 *        SDK for iOS" in Google Cloud). See .env.example.
 * LINKS: app.json (static base config), src/shared/ui/AppMap.tsx,
 *        https://docs.expo.dev/versions/v57.0.0/sdk/map-view/.
 */

import type { ConfigContext, ExpoConfig } from 'expo/config';

export default ({ config }: ConfigContext): ExpoConfig => ({
  ...config,
  // name/slug are required by ExpoConfig; app.json supplies them.
  name: config.name ?? 'trackitdown',
  slug: config.slug ?? 'trackitdown',
  plugins: [
    ...(config.plugins ?? []),
    [
      'react-native-maps',
      {
        androidGoogleMapsApiKey: process.env.GOOGLE_MAPS_ANDROID_API_KEY ?? '',
        iosGoogleMapsApiKey: process.env.GOOGLE_MAPS_IOS_API_KEY ?? '',
      },
    ],
    [
      'expo-location',
      {
        locationWhenInUsePermission:
          'Allow Trackitdown to use your location to set where a car was last seen.',
      },
    ],
  ],
});

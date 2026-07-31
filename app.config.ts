/**
 * WHAT:  Dynamic Expo config. Extends the static app.json to inject the
 *        react-native-maps, expo-location, and auth (secure-store, Apple, and
 *        Google sign-in) config plugins, with the Google Maps + Google OAuth
 *        keys read from the environment.
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

export default ({ config }: ConfigContext): ExpoConfig => {
  const plugins: NonNullable<ExpoConfig['plugins']> = [
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
    // Sightings evidence camera (in-app capture only — DOMAIN.md sighting
    // rules). No microphone: photos only in v1.
    [
      'expo-camera',
      {
        cameraPermission:
          'Allow Trackitdown to use the camera to photograph a car you have sighted.',
        microphonePermission: false,
        recordAudioAndroid: false,
      },
    ],
    // Photo library picking (posts, avatar) — explicit iOS usage string
    // instead of the autolinked plugin default.
    [
      'expo-image-picker',
      {
        photosPermission:
          'Allow Trackitdown to access your photos to add pictures of your car.',
      },
    ],
    // Push notifications (features/notifications): the startup permission
    // prompt AND real push delivery. `defaultChannel` must match
    // ALERTS_CHANNEL_ID in src/features/notifications/lib/pushDevice.ts and the
    // channelId the Edge Functions send — Android silently DROPS a notification
    // whose channel doesn't exist on the device.
    // NOTE: no custom `icon` yet. Android tints the notification icon, so it
    // must be a 96x96 WHITE-on-transparent PNG; a coloured one renders as a
    // white blob. Until that asset exists the Expo default is used, which is
    // correct-looking rather than wrong.
    ['expo-notifications', { defaultChannel: 'alerts', color: '#1A1A1A' }],
    // --- Auth (features/auth) -------------------------------------------------
    // Session tokens live in the OS keychain, not AsyncStorage.
    'expo-secure-store',
    // Enables the iOS "Sign in with Apple" capability + entitlement.
    'expo-apple-authentication',
    // Stripe bounty escrow (features/payments) — PaymentSheet native module.
    // Requires a new dev build; the publishable key is public (safe to embed),
    // it only opens the PaymentSheet. The secret + webhook keys are Edge
    // Function secrets, never bundled. See supabase/functions/README.md.
    // The plugin MUST be configured with props (a bare string makes withStripeIos
    // throw on props.merchantIdentifier). merchantIdentifier matches
    // BountyPaymentProvider's APPLE_PAY_MERCHANT_ID; both stay inert until Apple
    // Pay / Google Pay are actually set up.
    [
      '@stripe/stripe-react-native',
      {
        merchantIdentifier: 'merchant.com.olliet97.trackitdown',
        enableGooglePay: false,
      },
    ],
  ];

  // Native Google Sign-In. iosUrlScheme is the REVERSED iOS OAuth client id
  // (com.googleusercontent.apps.<id>) from Google Cloud. The plugin REJECTS an
  // empty value, so it's only added once GOOGLE_IOS_URL_SCHEME is set (+ a new
  // dev build). Until then the module still autolinks; only the iOS redirect
  // scheme waits (see .env.example + features/auth/README.md).
  if (process.env.GOOGLE_IOS_URL_SCHEME) {
    plugins.push([
      '@react-native-google-signin/google-signin',
      { iosUrlScheme: process.env.GOOGLE_IOS_URL_SCHEME },
    ]);
  }

  return {
    ...config,
    // name/slug are required by ExpoConfig; app.json supplies them.
    name: config.name ?? 'trackitdown',
    slug: config.slug ?? 'trackitdown',
    // Android push (FCM V1) needs google-services.json. Read from an env var so
    // the file can be an EAS file secret rather than committed — it identifies
    // the Firebase project. Omitted entirely when unset, so a local build with
    // no FCM configured still works (push tokens simply don't mint; see
    // features/notifications/lib/pushDevice.ts).
    android: process.env.GOOGLE_SERVICES_JSON
      ? { ...config.android, googleServicesFile: process.env.GOOGLE_SERVICES_JSON }
      : config.android,
    plugins,
  };
};

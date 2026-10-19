import type { ExpoConfig } from 'expo/config';

/**
 * Converted from the previous static app.json (module: Android release
 * prep audit) for exactly one reason: app.json had a literal placeholder
 * string ("YOUR-GOOGLE-MAPS-KEY") hardcoded into
 * android.config.googleMaps.apiKey — the native Google Maps SDK key
 * Expo bakes into AndroidManifest.xml at build time. That key is a
 * DIFFERENT consumer from the EXPO_PUBLIC_GOOGLE_MAPS_API_KEY the JS
 * runtime already reads via process.env (see src/lib/useGoogleMaps.ts-
 * equivalent or wherever the JS-side Maps calls read it) — a static
 * app.json has no way to read an environment variable, so the native
 * key could never be anything but that placeholder. This file reuses
 * the SAME env var (no new variable invented) so one value configures
 * both consumers, and native Maps actually works in a real build
 * instead of silently failing with an invalid-key error.
 *
 * Every other field below is carried over unchanged from app.json —
 * this is a format change, not a configuration change, except where a
 * comment says otherwise.
 */
const googleMapsApiKey = process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY;

export default (): ExpoConfig => ({
  name: 'SafeSpace',
  slug: 'safeher-mobile',
  extra: {
  eas: {
    projectId: 'f4472d66-c4e9-4444-9939-038b72d4c896',
  },
},
  scheme: 'safeher',
  version: '1.0.0',
  orientation: 'portrait',
  userInterfaceStyle: 'automatic',
  assetBundlePatterns: ['**/*'],
  // The official SafeSpace logo (added to the repo directly, not drawn by
  // this assistant) — src/assets/branding/safesapce_logo.png (filename
  // exactly as it exists on disk; "sapce" is a pre-existing typo in the
  // asset's own filename, not introduced here). 1254x1254, square,
  // opaque white background — meets Expo's icon schema requirement
  // (square source image) without any reformatting needed, unlike the
  // old safeher-icon-square.png this replaces (which had to be padded
  // onto a square canvas since the old 482x381 source wasn't square).
  icon: './src/assets/branding/safesapce_logo.png',
  ios: {
    supportsTablet: false,
    bundleIdentifier: 'ph.pswdo.safeher',
  },
  android: {
    package: 'ph.pswdo.safeher',
    permissions: ['ACCESS_FINE_LOCATION', 'ACCESS_COARSE_LOCATION', 'CAMERA', 'READ_EXTERNAL_STORAGE'],
    // Previously unset (defaults to true — Android's own default when
    // omitted). SafeSpace handles abuse case details, survivor identity,
    // and location data; allowing a full-device/ADB backup to extract
    // the app's private storage (including its session token, even
    // though that's now in SecureStore — see secureSessionStorage.ts)
    // is a real exposure path a security-sensitive app like this
    // shouldn't leave open without a specific reason to.
    allowBackup: false,
    adaptiveIcon: {
      // Same safesapce_logo.png as `icon` above. Note this asset has an
      // OPAQUE white background (no alpha channel), not the transparent
      // cutout Android's adaptive-icon foreground layer is normally
      // designed for — the old safeher-adaptive-foreground.png was a
      // purpose-made transparent version of the mark specifically so
      // backgroundColor below would show through the masked shape. No
      // transparent symbol-only variant of the new official logo exists,
      // and the brief is explicit not to redraw/recolor/modify the
      // provided artwork, so this renders as "mark on its own white
      // square, masked into Android's icon shape" rather than "mark on
      // brand-blue" — a different but still correct, unbroken result.
      // backgroundColor is kept below regardless (harmless, and some
      // launchers reveal a sliver of it at the mask edges).
      foregroundImage: './src/assets/branding/safesapce_logo.png',
      // Real brand primary (src/theme/theme.ts colors.primary) — not an
      // invented color.
      backgroundColor: '#1456A0',
    },
    config: {
      googleMaps: {
        // Falls back to undefined (omits the key entirely) rather than a
        // fake placeholder if the env var isn't set at build time — an
        // explicit missing-key build failure is more honest than a
        // silently-broken Maps integration shipped to users.
        apiKey: googleMapsApiKey,
      },
    },
  },
  plugins: [
    [
      'expo-location',
      {
        locationWhenInUsePermission:
          'SafeSpace uses your location to help authorized responders identify where emergency assistance may be needed, and to find shelters near you.',
      },
    ],
    [
      'expo-image-picker',
      {
        photosPermission: 'SafeSpace uses your photos to attach evidence to an incident report.',
      },
    ],
    [
      'expo-camera',
      {
        cameraPermission: 'SafeSpace uses your camera to scan a Client Case Access QR code.',
        barcodeScannerEnabled: true,
      },
    ],
    [
      'expo-local-authentication',
      {
        faceIDPermission: 'SafeSpace uses Face ID to keep your app locked and your information private.',
      },
    ],
    [
      'expo-notifications',
      {
        color: '#ffffff',
      },
    ],
    'expo-font',
    'expo-secure-store',
    [
      // Previously a bare plugin entry with no config, which is why the
      // top-level `splash` key from the old app.json was never actually
      // doing anything — that key was deprecated in favor of this
      // plugin's own config several Expo SDKs ago (confirmed: SDK 57's
      // config schema has no top-level `splash` property at all). Using
      // the app's own real background color (theme.ts colors.background)
      // rather than inventing a new one, so the splash screen and the
      // app's own first-paint background (App.tsx's pre-fonts-ready
      // fallback View) match exactly, with no color flash on startup.
      //
      // Image is the full mark+wordmark lockup (safespace_nobackground.png,
      // genuinely transparent — verified by decoding its pixels), not the
      // symbol-only mark: this native splash hands off directly to the JS
      // SplashScreen in SplashOnboardingWelcome.tsx, which now shows the
      // same asset at the same ~180px width on the same light background,
      // so there's no visible logo swap/resize at the handoff.
      'expo-splash-screen',
      {
        image: './src/assets/branding/safespace_nobackground.png',
        imageWidth: 180,
        resizeMode: 'contain',
        backgroundColor: '#F5F7FA',
      },
    ],
  ],
});

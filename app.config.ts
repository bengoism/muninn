import type { ExpoConfig } from 'expo/config';

const defaultUrl = process.env.EXPO_PUBLIC_DEFAULT_URL ?? 'https://example.com';

const config: ExpoConfig = {
  name: 'Muninn',
  slug: 'muninn',
  version: '1.0.0',
  scheme: 'muninn',
  orientation: 'portrait',
  userInterfaceStyle: 'light',
  icon: './assets/icon.png',
  splash: {
    image: './assets/splash-icon.png',
    resizeMode: 'contain',
    backgroundColor: '#0b1117',
  },
  ios: {
    supportsTablet: true,
    bundleIdentifier: 'com.bengo.muninn',
  },
  android: {
    package: 'com.bengo.muninn',
    adaptiveIcon: {
      foregroundImage: './assets/android-icon-foreground.png',
      backgroundImage: './assets/android-icon-background.png',
      monochromeImage: './assets/android-icon-monochrome.png',
    },
  },
  web: {
    favicon: './assets/favicon.png',
  },
  plugins: ['expo-router'],
  extra: {
    defaultUrl,
  },
};

export default config;

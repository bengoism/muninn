# Muninn

Muninn is an iOS-first Expo browser shell for an on-device agentic browser. This bootstrap establishes the app scaffold, a mounted `WebView`, the typed JavaScript/native inference boundary, and CI that can compile the generated iOS project without committing `ios/`.

## Stack

- Expo SDK 54 with Expo Router
- React Native + TypeScript
- Zustand for bootstrap state scaffolding
- `react-native-webview` for the browser surface
- App-local Expo native module in `modules/agent-runtime`

## Prerequisites

- Node.js 20+
- npm 10+
- Xcode 16.4+ with CocoaPods available on `PATH`

## Setup

```bash
npm install
cp .env.example .env
```

Set `EXPO_PUBLIC_DEFAULT_URL` in `.env` if you want the browser to open somewhere other than `https://example.com`.

## Local Development

Start Metro:

```bash
npm run dev
```

Run the iOS app with Expo CNG:

```bash
npm run ios
```

This repo uses Expo CNG. The generated `ios/` and `android/` folders are intentionally not committed.

Native changes in `modules/agent-runtime` require a rebuild. Fast Refresh will not reload Swift or Kotlin changes.

## Validation

```bash
npx expo install --check
npm run typecheck
npm run lint
npm run doctor
npm run ci:ios-smoke
```

`npm run ci:ios-smoke` regenerates `ios/` locally with `expo prebuild`, runs `pod install`, and performs an unsigned simulator build via `xcodebuild`.

## Bootstrap Scope

Issue `#1` intentionally stops at:

- a mounted `WebView`
- shared TypeScript contracts for the future agent loop
- Zustand scaffolding for browser and agent session state
- a stubbed `runInference` native method returning a typed `finish` action

The real observation pipeline, DOM instrumentation, and on-device model runtime start in later issues.

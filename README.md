# Muninn

Muninn is an iOS-first browser for on-device agentic web automation. The end goal is a private mobile browser where a user can describe a task in natural language, the app understands the rendered page visually, reasons locally, and performs the next browser action inside the iOS sandbox without shipping page screenshots or DOM data to the cloud.

## Product Overview

Most browser agents today depend on server-side automation and brittle DOM selectors. Muninn is aimed at a different model: on-device visual grounding. Instead of assuming a page can be reliably controlled through XPath, CSS selectors, or a remote browser session, the app is designed to observe the page the way a human does, combine that with a semantic snapshot of interactive elements, and choose actions locally.

That direction matters for three reasons:

- privacy, because reasoning and page understanding stay on the device
- reliability, because modern sites often use SPAs, canvas surfaces, Shadow DOM, and other UI patterns that defeat selector-heavy automation
- responsiveness, because the browser, perception loop, and action execution all live in the app rather than across a remote control plane

## End Goal

The product target is a zero-friction AI browser agent for iPhone:

- the user states a goal such as searching, navigating, filling a form, or completing a multi-step flow
- the browser captures the visible page and a lightweight semantic map of what can be interacted with
- an on-device model decides the next action using the current UI and a short recent action history
- the app executes that action directly in the browser, validates the result, and continues until the task is done or needs user help

The long-term value proposition is not just "chat inside a browser." It is a browser that can actually operate hostile real-world web interfaces while keeping sensitive browsing context on-device.

## Intended Architecture

Muninn is being built around a three-layer agent loop. This is the target architecture for the project, not a statement that the full stack is already complete today.

1. **Browser layer:** `WKWebView` via `react-native-webview` renders pages, captures the viewport, and serves as the execution surface for browser actions.
2. **Bridge layer:** Expo + React Native orchestrate browser state, observation timing, action execution, and file-based handoff between JavaScript and native code. Zustand holds browser and agent session state.
3. **Intelligence layer:** native Swift modules are intended to host the on-device inference runtime, with Google AI Edge / MediaPipe and Gemma-class vision-language models as the current target direction for local spatial reasoning and action selection.

## How The Agent Works

At a high level, the intended loop is:

1. Wait for the page to settle after navigation or an action.
2. Capture the current viewport and collect an accessibility-backed snapshot of interactive elements.
3. Assemble a compact reasoning payload with the user goal and recent action history.
4. Run local inference to choose the next action.
5. Execute that action in the browser.
6. Re-observe the page, validate that the UI changed, and either continue, recover, or yield back to the user.

The planned action vocabulary is:

- `click`
- `tap_coordinates`
- `type`
- `scroll`
- `go_back`
- `wait`
- `yield_to_user`
- `finish`

## Current Implementation Status

The repo is currently a working bootstrap for that architecture, not the finished product. Today it includes:

- an Expo app shell with browser chrome and a mounted `WebView`
- app-local native modules for the browser host and agent runtime boundary
- typed TypeScript contracts for observations, actions, and inference requests/responses
- observation plumbing for viewport capture, browser telemetry, and accessibility snapshot stitching across frames
- Zustand scaffolding for browser state and agent session state
- a stubbed `runInference` native call that returns typed actions without a production on-device model runtime

What is not complete yet:

- a production on-device VLM runtime
- the full autonomous perception-reasoning-action loop
- hardened action validation, retry behavior, and recovery for hostile web UIs
- the full privacy, performance, and memory envelope described by the product vision

The current codebase should be read as infrastructure for the eventual on-device browser agent rather than a finished AI browser.

## Stack

- Expo SDK 54 with Expo Router
- React Native + TypeScript
- Zustand for bootstrap state scaffolding
- `react-native-webview` for the browser surface
- App-local Expo native modules in `modules/agent-runtime` and `modules/browser-host`

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

Native changes in `modules/agent-runtime` or `modules/browser-host` require a rebuild. Fast Refresh will not reload Swift or Kotlin changes.

## Validation

```bash
npx expo install --check
npm run typecheck
npm run lint
npm run doctor
npm run ci:ios-smoke
```

`npm run ci:ios-smoke` regenerates `ios/` locally with `expo prebuild`, runs `pod install`, and performs an unsigned simulator build via `xcodebuild`.

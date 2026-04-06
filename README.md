# Muninn

Muninn is an iOS browser for on-device agentic web automation. It is a private mobile browser where a user describes a task in natural language, the app understands the rendered page visually, reasons locally, and performs browser actions inside the iOS sandbox — without shipping page screenshots or DOM data to the cloud.

## Why

Most browser agents depend on server-side automation and brittle DOM selectors. Muninn takes a different approach: on-device visual grounding. Instead of controlling pages through XPath, CSS selectors, or a remote browser session, the app observes the page the way a human does — combining a viewport screenshot with a semantic snapshot of interactive elements — and chooses actions locally.

This matters for three reasons:

- **Privacy** — reasoning and page understanding stay on the device
- **Reliability** — modern sites use SPAs, canvas surfaces, Shadow DOM, and other patterns that defeat selector-heavy automation
- **Responsiveness** — browser, perception loop, and action execution all live in the app

<p align="center">
  <img width="295"  alt="IMG_2226" src="https://github.com/user-attachments/assets/268c437c-a606-4122-bb32-dcdb8904670a" />
  <img width="295" alt="IMG_2224" src="https://github.com/user-attachments/assets/d76f532e-8c8e-48b2-a684-83ab07a4bd32" />
</p>


## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                        User Goal                            │
└────────────────────────────┬────────────────────────────────┘
                             │
┌────────────────────────────▼────────────────────────────────┐
│                       Agent Loop                            │
│   observe ─► reason ─► act ─► validate ─► retry/recover     │
│       ▲                                       │             │
│       └───────────────────────────────────────┘             │
└───────┬────────────────┬──────────────────┬─────────────────┘
        │                │                  │
┌───────▼──────┐  ┌──────▼───────┐  ┌──────▼──────────────────┐
│ Observation  │  │   Native     │  │    Tool Executor        │
│ Pipeline     │  │  Inference   │  │                         │
│              │  │              │  │  click    tap_coords    │
│ AX tree      │  │  LiteRT-LM   │  │  type     fill         │
│ screenshot   │  │  / replay    │  │  select   gettext      │
│ frame stitch │  │              │  │  hover    focus         │
│ short refs   │  │              │  │  eval     scroll       │
│              │  │              │  │  go_back  wait         │
│              │  │              │  │  yield_to_user  finish  │
└───────┬──────┘  └──────┬───────┘  └──────┬──────────────────┘
        │                │                 │
┌───────▼────────────────▼─────────────────▼──────────────────┐
│                    Browser Bridge                           │
│         bootstrap.ts · protocol.ts · bridge messages        │
└────────────────────────────┬────────────────────────────────┘
                             │
┌────────────────────────────▼────────────────────────────────┐
│               WKWebView  (BrowserHostModule)                │
│          react-native-webview · viewport capture            │
└─────────────────────────────────────────────────────────────┘
```

**Three layers:**

1. **Browser layer** — `WKWebView` via `react-native-webview` renders pages, captures the viewport, and serves as the execution surface for browser actions.
2. **Bridge layer** — Expo + React Native orchestrate browser state, observation timing, action execution, and message passing between JavaScript and native code. Zustand holds browser and agent session state.
3. **Intelligence layer** — native Swift modules host the on-device inference runtime. Current targets are LiteRT-LM and replay-based backends for local action selection.

## How The Agent Works

The agent loop runs in `use-agent-loop.ts` and cycles through these phases per step:

1. **Observe** — wait for page quiescence, capture a viewport screenshot and an accessibility-backed snapshot of interactive elements (stitched across iframes).
2. **Reason** — send the observation, goal, and recent action history to the native inference module. Get back an action + parameters.
3. **Act** — execute the chosen tool in the browser via injected JavaScript. Elements are located using short refs (`e1`, `e2`, …) with multi-level fallback (data attribute → selector+label match → role+text match).
4. **Validate** — capture a post-action snapshot and classify the outcome: `success`, `no_op`, `partial_success`, `blocked`, `stale_ref`, or `unrecoverable`.
5. **Retry** — on failure, attempt a single fallback (e.g. `click` → `tap_coordinates`, `scroll` with reduced amount).
6. **Stuck recovery** — detect repeated failures, consecutive no-ops (threshold: 3), or identical repeated actions, and recover by reobserving, navigating back, or stopping.

The loop runs until the task is complete, the user cancels, the step budget (default 30) is exhausted, or an unrecoverable error occurs.

## Action Vocabulary

The agent can perform 14 actions:

| Action | Description |
|--------|-------------|
| `click` | Click an element by ref ID |
| `tap_coordinates` | Tap at (x, y) viewport coordinates |
| `type` | Type text into the focused element |
| `fill` | Clear a field and type new text |
| `select` | Choose an option from a dropdown |
| `gettext` | Read text content from an element |
| `hover` | Hover over an element |
| `focus` | Focus an element |
| `eval` | Execute arbitrary JavaScript |
| `scroll` | Scroll in a direction (up/down/left/right) by amount (small/half/page) |
| `go_back` | Browser back navigation |
| `wait` | Wait for a condition or timeout |
| `yield_to_user` | Pause and return control to the user |
| `finish` | Mark the task as complete |

## Current Status

**Working today:**

- Full browser shell with URL navigation, back/forward, reload, and progress indicator
- Agent loop with observation → reasoning → action → validation → retry cycle
- All 14 tools with execution, validation, and fallback chains
- Observation pipeline: viewport screenshot + accessibility tree + multi-frame stitching
- Short ref system (`e1`, `e2`, …) with resilient element lookup that survives React re-renders
- Action outcome classification and stuck state detection/recovery
- Chat UI showing agent steps and outcomes in a draggable bottom panel
- Native module interfaces for inference and browser hosting
- Model management: download, status check, smoke test

**Not complete yet:**

- Production on-device VLM runtime (inference module currently uses replay/stub backends)
- Full privacy and performance envelope described by the product vision

## Stack

- Expo SDK 54 with Expo Router
- React Native + TypeScript
- Zustand for state management
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

# Vendored LiteRT-LM iOS Artifacts

This directory contains the pinned LiteRT-LM iOS runtime artifacts consumed by
`AgentRuntime.podspec`.

Current pin:

- LiteRT-LM upstream tag: `v0.10.1`
- Primary model target: `litert-community/gemma-4-E2B-it-litert-lm`
- Native bridge target: `//c:engine_cpu`

Contents:

- `LiteRTLMEngine.xcframework`
- `include/engine.h`

The xcframework is built from source because the upstream `v0.10.1` GitHub
release does not currently publish a consumable iOS SDK artifact. Rebuild it
with:

```bash
scripts/build-litert-lm-ios-xcframework.sh /path/to/LiteRT-LM-checkout
```

The checkout must be at tag `v0.10.1` with Git LFS assets present.

Packaging notes:

- The Apple Silicon simulator slice is rebuilt from the `//c:engine_cpu_link_test`
  static-runtime link closure, not copied directly from Bazel's raw
  `libengine_cpu.a`. The raw archive still expects LiteRT's dynamic-runtime
  dispatch path and does not link cleanly inside this Expo/CocoaPods app build.
- The app currently carries a simulator-only stub in
  `modules/agent-runtime/ios/LiteRTLMConstraintProviderStub.mm` for Gemma
  constrained-decoding provider symbols. The current LiteRT-LM text smoke test
  does not enable constrained decoding, so that stub is sufficient for
  simulator bring-up.

Current limitation: the vendored xcframework includes `ios-arm64` and
`ios-arm64-simulator`. Upstream `v0.10.1` currently fails for `ios_x86_64`
during Bazel Rust toolchain resolution, so Intel simulator support is not part
of this slice.

`AgentRuntime.podspec` automatically links any `.xcframework` in this directory.
The current smoke-test integration uses the C API from `include/engine.h`; the
structured browser-action path is still intentionally disabled in this slice.

#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SOURCE_DIR="${1:-}"
EXPECTED_TAG="${LITERT_LM_TAG:-v0.10.1}"
TARGET_DIR="$ROOT_DIR/modules/agent-runtime/ios/Vendor/LiteRTLM"
TARGET_XCFRAMEWORK="$TARGET_DIR/LiteRTLMEngine.xcframework"
TARGET_HEADERS_DIR="$TARGET_DIR/include"
STATIC_RUNTIME_DEFINES=(
  "--define=litert_runtime_link_mode=static"
  "--define=litert_link_capi_so=false"
  "--define=framework_shared_object=false"
)

build_monolith() {
  local execution_root="$1"
  local output_path="$2"
  local bazel_config_dir="$3"   # e.g. ios_arm64-opt or ios_sim_arm64-opt
  local clang_target="$4"       # e.g. arm64-apple-ios15.1 or arm64-apple-ios15.1-simulator
  local sdk_name="$5"           # e.g. iphoneos or iphonesimulator
  local params_path="$execution_root/bazel-out/$bazel_config_dir/bin/c/engine_cpu_link_test-2.params"
  local args_path combined_object sdk_path

  if [[ ! -f "$params_path" ]]; then
    echo "Missing link params: $params_path" >&2
    exit 1
  fi

  args_path="$(mktemp)"
  combined_object="$(mktemp /tmp/litert-combined-XXXXXX.o)"

  python3 - "$execution_root" "$params_path" "$args_path" "$bazel_config_dir" <<'PY'
from pathlib import Path
import sys

base = Path(sys.argv[1])
params_path = Path(sys.argv[2])
args_path = Path(sys.argv[3])
config_dir = sys.argv[4]

lines = [line.strip() for line in params_path.read_text().splitlines() if line.strip()]
result = []
i = 0
while i < len(lines):
    line = lines[i]
    if line == "-o":
        i += 2
        continue
    if line == "-Xlinker":
        i += 2
        continue
    if line == "-rpath":
        i += 1
        continue
    if line.startswith("@loader_path"):
        i += 1
        continue
    if line.endswith("/engine_cpu_link_test.o"):
        i += 1
        continue
    if line.startswith("-Wl,-oso_prefix") or line.startswith("-Wl,-rpath"):
        i += 1
        continue
    if line.startswith(f"bazel-out/{config_dir}/bin/c/libengine_cpu.a"):
        result.append("-Wl,-force_load," + str(base / line))
        i += 1
        continue
    if line == "-lc++":
        result.append(line)
        i += 1
        continue
    if line.startswith("-Lbazel-out/"):
        result.append("-L" + str(base / line[2:]))
        i += 1
        continue
    if line.startswith("-l") or line.startswith("-Wl,"):
        result.append(line)
        i += 1
        continue
    if line.startswith("bazel-out/"):
        result.append(str(base / line))
        i += 1
        continue
    i += 1

args_path.write_text("\n".join(result) + "\n")
PY

  sdk_path="$(xcrun --sdk "$sdk_name" --show-sdk-path)"
  (
    cd "$execution_root"
    xcrun clang++ \
      -target "$clang_target" \
      -isysroot "$sdk_path" \
      -stdlib=libc++ \
      -r \
      -o "$combined_object" \
      @"$args_path"
  )
  libtool -static -o "$output_path" "$combined_object"

  rm -f "$args_path" "$combined_object"
}

if [[ -z "$SOURCE_DIR" ]]; then
  echo "Usage: $0 <LiteRT-LM-checkout>" >&2
  echo "Build the pinned LiteRT-LM iOS C API target and vendor it into this repo." >&2
  echo "This currently produces arm64 device and arm64 simulator slices only." >&2
  exit 1
fi

if [[ ! -d "$SOURCE_DIR/.git" ]]; then
  echo "Not a git checkout: $SOURCE_DIR" >&2
  exit 1
fi

for tool in bazelisk git xcodebuild libtool python3 xcrun; do
  if ! command -v "$tool" >/dev/null 2>&1; then
    echo "Missing required tool: $tool" >&2
    exit 1
  fi
done

if ! git -C "$SOURCE_DIR" rev-parse "$EXPECTED_TAG^{}" >/dev/null 2>&1; then
  echo "Expected LiteRT-LM tag not found in checkout: $EXPECTED_TAG" >&2
  exit 1
fi

CURRENT_REF="$(git -C "$SOURCE_DIR" describe --tags --exact-match 2>/dev/null || true)"
if [[ "$CURRENT_REF" != "$EXPECTED_TAG" ]]; then
  echo "Checkout is not at the expected pinned tag." >&2
  echo "Expected: $EXPECTED_TAG" >&2
  echo "Actual:   ${CURRENT_REF:-<detached-or-unmatched>}" >&2
  echo "Check out the pinned tag before running this script." >&2
  exit 1
fi

git -C "$SOURCE_DIR" lfs pull

pushd "$SOURCE_DIR" >/dev/null

bazelisk build \
  --config=ios_arm64 \
  //c:engine_cpu_link_test \
  "${STATIC_RUNTIME_DEFINES[@]}" \
  --symlink_prefix="$SOURCE_DIR/bazel-ios-arm64-"
bazelisk build \
  --config=ios_sim_arm64 \
  //c:engine_cpu_link_test \
  "${STATIC_RUNTIME_DEFINES[@]}" \
  --symlink_prefix="$SOURCE_DIR/bazel-ios-sim-"

EXECUTION_ROOT="$(bazelisk info execution_root)"
IOS_ARM64_LIB="/tmp/libengine_cpu.a"
IOS_SIM_ARM64_LIB="/tmp/libengine_cpu_sim.a"

build_monolith "$EXECUTION_ROOT" "$IOS_ARM64_LIB" "ios_arm64-opt" "arm64-apple-ios15.1" "iphoneos"
build_monolith "$EXECUTION_ROOT" "$IOS_SIM_ARM64_LIB" "ios_sim_arm64-opt" "arm64-apple-ios15.1-simulator" "iphonesimulator"

popd >/dev/null

if [[ ! -f "$IOS_ARM64_LIB" || ! -f "$IOS_SIM_ARM64_LIB" ]]; then
  echo "Expected Bazel output archives were not found." >&2
  echo "ios_arm64: $IOS_ARM64_LIB" >&2
  echo "ios_sim_arm64: $IOS_SIM_ARM64_LIB" >&2
  exit 1
fi

TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"; rm -f "$IOS_ARM64_LIB" "$IOS_SIM_ARM64_LIB"' EXIT

mkdir -p "$TMP_DIR/include"
cp "$SOURCE_DIR/c/engine.h" "$TMP_DIR/include/engine.h"

mkdir -p "$TARGET_DIR" "$TARGET_HEADERS_DIR"
rm -rf "$TARGET_XCFRAMEWORK"

xcodebuild -create-xcframework \
  -library "$IOS_ARM64_LIB" \
  -headers "$TMP_DIR/include" \
  -library "$IOS_SIM_ARM64_LIB" \
  -headers "$TMP_DIR/include" \
  -output "$TARGET_XCFRAMEWORK"

cp "$SOURCE_DIR/c/engine.h" "$TARGET_HEADERS_DIR/engine.h"

echo "Vendored LiteRT-LM xcframework:"
echo "  $TARGET_XCFRAMEWORK"
echo "Vendored headers:"
echo "  $TARGET_HEADERS_DIR/engine.h"
echo
echo "Note: upstream v0.10.1 currently does not build ios_x86_64 cleanly,"
echo "so this xcframework is Apple Silicon simulator only."
echo "The simulator slice is rebuilt from the static-runtime link closure so"
echo "it links cleanly inside the Expo/CocoaPods simulator app build."

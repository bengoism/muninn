#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SOURCE_DIR="${1:-}"
EXPECTED_TAG="${LITERT_LM_TAG:-v0.11.0}"
ENGINE_TARGET="${LITERT_LM_ENGINE_TARGET:-//c:engine}"
TARGET_DIR="$ROOT_DIR/modules/agent-runtime/ios/Vendor/LiteRTLM"
TARGET_XCFRAMEWORK="$TARGET_DIR/LiteRTLMEngine.xcframework"
TARGET_HEADERS_DIR="$TARGET_DIR/include"
STATIC_RUNTIME_DEFINES=(
  "--define=litert_runtime_link_mode=static"
  "--define=litert_link_capi_so=false"
  "--define=framework_shared_object=false"
)
SHIM_PACKAGE="muninn_litert_lm_link_$$"
SHIM_BINARY="engine_link"

create_link_shim() {
  local shim_dir="$SOURCE_DIR/$SHIM_PACKAGE"
  mkdir -p "$shim_dir"
  cat >"$shim_dir/BUILD" <<EOF
cc_binary(
    name = "$SHIM_BINARY",
    srcs = ["$SHIM_BINARY.cc"],
    linkstatic = True,
    deps = ["$ENGINE_TARGET"],
)
EOF
  cat >"$shim_dir/$SHIM_BINARY.cc" <<'EOF'
#include "c/engine.h"

int main(int argc, char** argv) {
  (void)argc;
  (void)argv;
  (void)&litert_lm_engine_create;
  (void)&litert_lm_engine_settings_create;
  return 0;
}
EOF
}

build_monolith() {
  local execution_root="$1"
  local output_path="$2"
  local bazel_config_dir="$3"   # e.g. ios_arm64-opt or ios_sim_arm64-opt
  local clang_target="$4"       # e.g. arm64-apple-ios15.1 or arm64-apple-ios15.1-simulator
  local sdk_name="$5"           # e.g. iphoneos or iphonesimulator
  local shim_package="$6"
  local shim_binary="$7"
  local params_path
  local args_path combined_object sdk_path

  params_path="$(find "$execution_root/bazel-out/$bazel_config_dir/bin/$shim_package" \
    -name "$shim_binary-*.params" -print -quit 2>/dev/null || true)"

  if [[ -z "$params_path" || ! -f "$params_path" ]]; then
    echo "Missing link params for //$shim_package:$shim_binary under bazel-out/$bazel_config_dir." >&2
    exit 1
  fi

  args_path="$(mktemp)"
  combined_object="$(mktemp /tmp/litert-combined-XXXXXX.o)"

  python3 - "$execution_root" "$params_path" "$args_path" "$bazel_config_dir" "$shim_binary" <<'PY'
from pathlib import Path
import sys

base = Path(sys.argv[1])
params_path = Path(sys.argv[2])
args_path = Path(sys.argv[3])
config_dir = sys.argv[4]
shim_binary = sys.argv[5]

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
    if line in ("-framework", "-weak_framework"):
        i += 2
        continue
    if line.startswith("@loader_path"):
        i += 1
        continue
    if line.endswith(f"/{shim_binary}.o") or f"/_objs/{shim_binary}/" in line:
        i += 1
        continue
    if line.startswith("-Wl,-oso_prefix") or line.startswith("-Wl,-rpath"):
        i += 1
        continue
    if line.startswith(f"bazel-out/{config_dir}/bin/c/libengine") and line.endswith(".a"):
        result.append("-Wl,-force_load," + str(base / line))
        i += 1
        continue
    if line.startswith("bazel-out/") and (line.endswith(".dylib") or line.endswith(".so")):
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
  echo "Build the pinned LiteRT-LM iOS C API target ($EXPECTED_TAG, $ENGINE_TARGET) and vendor it into this repo." >&2
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

if [[ "${LITERT_LM_SKIP_LFS_PULL:-0}" != "1" ]]; then
  git -C "$SOURCE_DIR" lfs pull
else
  git -C "$SOURCE_DIR" lfs pull \
    --include="prebuilt/ios_arm64/libGemmaModelConstraintProvider.dylib,prebuilt/ios_sim_arm64/libGemmaModelConstraintProvider.dylib" \
    --exclude=""
fi
create_link_shim
trap 'rm -rf "$SOURCE_DIR/$SHIM_PACKAGE"' EXIT

pushd "$SOURCE_DIR" >/dev/null

bazelisk build \
  --config=ios_arm64 \
  "//$SHIM_PACKAGE:$SHIM_BINARY" \
  "${STATIC_RUNTIME_DEFINES[@]}" \
  --symlink_prefix="$SOURCE_DIR/bazel-ios-arm64-"
bazelisk build \
  --config=ios_sim_arm64 \
  "//$SHIM_PACKAGE:$SHIM_BINARY" \
  "${STATIC_RUNTIME_DEFINES[@]}" \
  --symlink_prefix="$SOURCE_DIR/bazel-ios-sim-"

EXECUTION_ROOT="$(bazelisk info execution_root)"
IOS_ARM64_DIR="$(mktemp -d /tmp/litert-lm-device-XXXXXX)"
IOS_SIM_ARM64_DIR="$(mktemp -d /tmp/litert-lm-sim-XXXXXX)"
IOS_ARM64_LIB="$IOS_ARM64_DIR/libengine.a"
IOS_SIM_ARM64_LIB="$IOS_SIM_ARM64_DIR/libengine.a"

build_monolith "$EXECUTION_ROOT" "$IOS_ARM64_LIB" "ios_arm64-opt" "arm64-apple-ios15.1" "iphoneos" "$SHIM_PACKAGE" "$SHIM_BINARY"
build_monolith "$EXECUTION_ROOT" "$IOS_SIM_ARM64_LIB" "ios_sim_arm64-opt" "arm64-apple-ios15.1-simulator" "iphonesimulator" "$SHIM_PACKAGE" "$SHIM_BINARY"

popd >/dev/null

if [[ ! -f "$IOS_ARM64_LIB" || ! -f "$IOS_SIM_ARM64_LIB" ]]; then
  echo "Expected Bazel output archives were not found." >&2
  echo "ios_arm64: $IOS_ARM64_LIB" >&2
  echo "ios_sim_arm64: $IOS_SIM_ARM64_LIB" >&2
  exit 1
fi

TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR" "$IOS_ARM64_DIR" "$IOS_SIM_ARM64_DIR" "$SOURCE_DIR/$SHIM_PACKAGE"' EXIT

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
echo "Note: upstream v0.11.0 publishes an iOS simulator CLI binary,"
echo "but not a consumable iOS device C API xcframework."
echo "This xcframework is rebuilt from the static-runtime link closure and"
echo "contains arm64 device and Apple Silicon simulator slices only."

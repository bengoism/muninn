#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

cd "$ROOT_DIR"

npx expo prebuild -p ios --clean --no-install

pushd ios >/dev/null
pod install
popd >/dev/null

WORKSPACE="$(find ios -maxdepth 1 -name '*.xcworkspace' | head -n 1)"

if [[ -z "$WORKSPACE" ]]; then
  echo "Unable to locate an Xcode workspace under ios/" >&2
  exit 1
fi

SCHEME="$(basename "$WORKSPACE" .xcworkspace)"

xcodebuild \
  -workspace "$WORKSPACE" \
  -scheme "$SCHEME" \
  -configuration Debug \
  -sdk iphonesimulator \
  -destination 'generic/platform=iOS Simulator' \
  CODE_SIGNING_ALLOWED=NO \
  build

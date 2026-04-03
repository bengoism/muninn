#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SOURCE_DIR="${1:-}"
TARGET_DIR="$ROOT_DIR/modules/agent-runtime/ios/Vendor/LiteRTLM"

if [[ -z "$SOURCE_DIR" ]]; then
  echo "Usage: $0 <artifact-directory>" >&2
  echo "Copy one or more LiteRT-LM iOS .xcframework bundles into the vendored runtime directory." >&2
  exit 1
fi

if [[ ! -d "$SOURCE_DIR" ]]; then
  echo "Artifact directory does not exist: $SOURCE_DIR" >&2
  exit 1
fi

mkdir -p "$TARGET_DIR"
mkdir -p "$TARGET_DIR/include"

shopt -s nullglob
artifacts=("$SOURCE_DIR"/*.xcframework)
shopt -u nullglob

if [[ ${#artifacts[@]} -eq 0 ]]; then
  echo "No .xcframework bundles were found under: $SOURCE_DIR" >&2
  echo "This repo is pinned for LiteRT-LM v0.10.1, but upstream does not currently publish a consumable iOS SDK artifact in GitHub releases." >&2
  exit 1
fi

find "$TARGET_DIR" -mindepth 1 -maxdepth 1 -name '*.xcframework' -exec rm -rf {} +

for artifact in "${artifacts[@]}"; do
  cp -R "$artifact" "$TARGET_DIR/"
done

if [[ -f "$SOURCE_DIR/include/engine.h" ]]; then
  cp "$SOURCE_DIR/include/engine.h" "$TARGET_DIR/include/engine.h"
fi

echo "Vendored LiteRT-LM iOS artifacts:"
find "$TARGET_DIR" -maxdepth 1 -name '*.xcframework' -print | sort

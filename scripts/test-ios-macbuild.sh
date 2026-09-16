#!/usr/bin/env bash
set -euo pipefail

selector=${1:-RawkoonTests}
export PATH="/opt/homebrew/bin:$PATH"
repo_root=$(git rev-parse --show-toplevel)
expected_root="$HOME/Sites/projets_perso/rawkoon"

if [[ "$repo_root" != "$expected_root" ]]; then
  echo "Run this from $expected_root" >&2
  exit 2
fi

if ! command -v xcodegen >/dev/null; then
  brew install xcodegen
fi

cd "$repo_root/apps/ios"
xcodegen generate

if [[ "$selector" == "--build" ]]; then
  xcodebuild build \
    -project Rawkoon.xcodeproj -scheme Rawkoon \
    -destination 'generic/platform=iOS Simulator' \
    CODE_SIGNING_ALLOWED=NO
  exit 0
fi

udid=$(xcrun simctl list devices available --json | python3 -c '
import json, sys
devices = json.load(sys.stdin)["devices"]
candidates = [
    device["udid"]
    for runtime, runtime_devices in devices.items()
    if "iOS" in runtime
    for device in runtime_devices
    if "iPhone" in device["name"] and device["isAvailable"]
]
print(candidates[-1] if candidates else "")
')

if [[ -z "$udid" ]]; then
  echo "No available iPhone simulator found" >&2
  exit 1
fi

echo "Using simulator $udid"
xcodebuild test \
  -project Rawkoon.xcodeproj -scheme Rawkoon \
  -destination "id=$udid" \
  -only-testing:"$selector" \
  CODE_SIGNING_ALLOWED=NO

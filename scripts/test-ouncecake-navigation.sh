#!/bin/bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
NAVIGATION_TEST_DIR="$(mktemp -d "${TMPDIR:-/tmp}/mac2jb-navigation.XXXXXX")"
trap 'rm -rf "$NAVIGATION_TEST_DIR"' EXIT
xcrun clang++ -std=c++17 -Wall -Wextra -Werror "$ROOT/scripts/test-ouncecake-navigation.cpp" -o "$NAVIGATION_TEST_DIR/tests"
"$NAVIGATION_TEST_DIR/tests"

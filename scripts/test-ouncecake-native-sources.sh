#!/bin/bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
WORK="$(mktemp -d "${TMPDIR:-/tmp}/mac2jb-native-sources.XXXXXX")"
trap 'rm -rf "$WORK"' EXIT
xcrun clang -std=c11 -g -O1 -fsanitize=address,undefined -fno-sanitize-recover=undefined \
 -Dmemcpy=native_memcpy -Dmemset=native_memset -Dmemmove=native_memmove \
 "$ROOT/vendor/OunceCake/engine/oz-code/test/sources.c" \
 "$ROOT/vendor/OunceCake/engine/oz-code/vendor/picohttpparser/picohttpparser.c" -o "$WORK/test"
"$WORK/test"

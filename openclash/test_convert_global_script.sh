#!/usr/bin/env bash
set -euo pipefail

ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
CONVERTER="$ROOT/openclash/convert-global-script.sh"
INPUT="$ROOT/global_script.js"
OUTPUT=$(mktemp)
trap 'rm -f "$OUTPUT"' EXIT

bash "$CONVERTER" "$INPUT" "$OUTPUT" --ipv6

grep -q '^\[General\]$' "$OUTPUT"
grep -q '^IPV6_ENABLE = 1$' "$OUTPUT"
grep -q '^IPV6_DNS = 1$' "$OUTPUT"
grep -q '^\[YAML\]$' "$OUTPUT"
grep -q '^  ipv6: true$' "$OUTPUT"
grep -q 'RULE-SET,lipiston,DIRECT' "$OUTPUT"
grep -q 'DOMAIN-SUFFIX,warframe.com,DIRECT' "$OUTPUT"
grep -q 'DOMAIN-KEYWORD,postman,默认节点' "$OUTPUT"
grep -q 'DOMAIN-SUFFIX,openai.com,国外AI' "$OUTPUT"
! grep -q 'PROCESS-NAME,' "$OUTPUT"
! grep -q '^  - MATCH,' "$OUTPUT"

echo 'OpenClash bash converter tests passed'

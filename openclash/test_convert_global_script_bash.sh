#!/usr/bin/env bash
set -euo pipefail

ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
CONVERTER="$ROOT/openclash/convert-global-script-bash.sh"
INPUT="$ROOT/global_script.js"
OUTPUT=$(mktemp)
trap 'rm -f "$OUTPUT"' EXIT

bash "$CONVERTER" "$INPUT" "$OUTPUT" --ipv6 >/dev/null

grep -q '^\[General\]$' "$OUTPUT"
grep -q '^IPV6_ENABLE = 1$' "$OUTPUT"
grep -q '^IPV6_DNS = 1$' "$OUTPUT"
grep -q '^IPV6_MODE = 0$' "$OUTPUT"
grep -q '^FAKEIP_RANGE6 = fdfe:dcba:9876::1/64$' "$OUTPUT"
grep -q '^  ipv6: true$' "$OUTPUT"
grep -q '^  fake-ip-range6: fdfe:dcba:9876::1/64$' "$OUTPUT"
grep -q 'RULE-SET,lipiston,DIRECT' "$OUTPUT"
grep -q 'DOMAIN-SUFFIX,warframe.com,DIRECT' "$OUTPUT"
! grep -q 'DOMAIN-SUFFIX,mgstage.com,日本网站' "$OUTPUT"
grep -q 'DOMAIN-SUFFIX,openai.com,国外AI' "$OUTPUT"
! grep -q 'GEOSITE,ai,国外AI' "$OUTPUT"
! grep -q 'GEOSITE,tracker,跟踪分析' "$OUTPUT"
! grep -q 'GEOSITE,category-ads-all,广告过滤' "$OUTPUT"
grep -q 'GEOSITE,apple-cn,苹果服务' "$OUTPUT"
grep -q '^  - name: 国内网站$' "$OUTPUT"
grep -q '^  - name: 其他外网$' "$OUTPUT"
! grep -q 'PROCESS-NAME,' "$OUTPUT"
! grep -q '^  - MATCH,' "$OUTPUT"

NO6=$(mktemp)
trap 'rm -f "$OUTPUT" "$NO6"' EXIT
bash "$CONVERTER" "$INPUT" "$NO6" --no-ipv6 >/dev/null
grep -q '^IPV6_ENABLE = 0$' "$NO6"
grep -q '^IPV6_DNS = 0$' "$NO6"
grep -q '^  ipv6: false$' "$NO6"

node "$(cygpath -w "${ROOT}/openclash/test_converter.js")"
echo 'OpenClash bash converter tests passed'

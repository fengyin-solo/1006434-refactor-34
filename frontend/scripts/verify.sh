#!/bin/sh
# 交接班超时统一算法的纯 Node 校验（不依赖浏览器与原生构建链）。
# 用 tsc 把纯 TS 数据/领域/服务层转译到临时目录后跑断言。
set -e

ROOT=$(cd "$(dirname "$0")/.." && pwd)
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT
mkdir -p "$TMP/out" "$TMP/domain-check" "$TMP/service-check/scripts"

# ---- 领域算法 ----
D="$TMP/domain-check"
cp "$ROOT/src/data/types.ts" "$ROOT/src/data/shift-roster.ts" "$ROOT/src/domain/shift-handover.ts" "$D/"
cp "$ROOT/scripts/verify-shift-handover.ts" "$D/verify.ts"
sed -i.bak "s#@/data/#./#g; s#../src/data/#./#g; s#../src/domain/#./#g" "$D"/*.ts
"$ROOT/node_modules/.bin/tsc" --outDir "$TMP/out/domain" --module commonjs --target ES2020 \
  --moduleResolution node --esModuleInterop --strict --skipLibCheck "$D"/*.ts
node "$TMP/out/domain/verify.js"

# ---- 服务层 ----
S="$TMP/service-check"
cp -r "$ROOT/src" "$S/src"
cp "$ROOT/scripts/verify-shift-service.ts" "$S/scripts/verify.ts"
sed -i.bak "s#@/data/#./#g" "$S/src/data/"*.ts
sed -i.bak "s#@/data/#../data/#g" "$S/src/domain/"*.ts
sed -i.bak "s#@/data/#../data/#g; s#@/domain/#../domain/#g" "$S/src/api/"*.ts
# shellcheck disable=SC2046
"$ROOT/node_modules/.bin/tsc" --outDir "$TMP/out/service" --module commonjs --target ES2020 \
  --moduleResolution node --esModuleInterop --strict --skipLibCheck \
  $(find "$S/src/data" "$S/src/domain" "$S/src/api" -name '*.ts') "$S/scripts/verify.ts"
node "$TMP/out/service/scripts/verify.js"

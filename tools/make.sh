#!/usr/bin/env bash
# 현황판 만들기.bat 이 부름: 윈도우 경로 인자를 리눅스 경로로 바꿔 tools/make.js 실행
set -e
cd "$(dirname "$0")/.."
[ -x "$HOME/work/node/bin/node" ] && PATH="$HOME/work/node/bin:$PATH"  # 이 PC 의 Node 24 (없으면 PATH 의 node)
[ -d tools/node_modules/playwright ] || npm --prefix tools install --no-audit --no-fund
args=()
for a in "$@"; do
  [[ $a == [A-Za-z]:\\* || $a == \\\\* ]] && a=$(wslpath -u "$a")
  args+=("$a")
done
exec node tools/make.js "${args[@]}"
